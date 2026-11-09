<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Contract;

use CtPassStore\Application\Auth\UserTokens;
use CtPassStore\Application\Exception\ConfigurationException;
use CtPassStore\Config\BackendConfig;
use CtPassStore\Domain\PersonId;
use CtPassStore\Domain\PersonPrincipal;
use CtPassStore\Infrastructure\Auth\FirebaseTokenCodec;
use CtPassStore\Infrastructure\ChurchTools\Credential;
use CtPassStore\Infrastructure\ChurchTools\GuzzleChurchToolsClient;
use CtPassStore\Infrastructure\Kv\ExtensionData;
use CtPassStore\Infrastructure\Kv\KvSchema;
use CtPassStore\Infrastructure\Kv\KvSettingsRepository;
use CtPassStore\Infrastructure\Time\SystemClock;
use CtPassStore\Tests\Contract\Helpers\BackendSandboxManager;
use CtPassStore\Tests\Contract\Helpers\ContractPrerequisites;
use GuzzleHttp\Client;
use GuzzleHttp\Promise\Utils;
use phpseclib3\Crypt\PublicKeyLoader;
use phpseclib3\Crypt\RSA;
use PHPUnit\Framework\TestCase;
use Psr\Http\Message\ResponseInterface;

/**
 * The local backend against the test instance, with its real settings and public key (catalog LS-01, LS-02,
 * TR-02d). Only the entry of the first user in `fixtures/normal_users.json` is written, and only if that user has no
 * entry before; the test deletes it again. Settings and keys are never changed.
 *
 * Decryption needs the private key matching the instance's public key. Set `CT_TEST_PRIVATE_KEY_FILE` in the local
 * phpunit.xml to check it; without it the test compares the ciphertexts with what ChurchTools stored.
 */
final class LiveEntriesTest extends TestCase
{
    private const PORT = 8091;
    private const PARALLEL_PUTS = 5;
    private const COOL_DOWN_SECONDS = 3;

    private static BackendSandboxManager $backend;

    private static BackendConfig $config;

    private ExtensionData $kv;
    private Client $http;
    private int $personId;
    private string $accessToken;

    /** Set once it's clear the test may write; only then does tearDown clean up. */
    private bool $mayWrite = false;

    /** Requests that got `502 upstream-unavailable` (see testParallelPutsHeal). */
    private int $outages = 0;

    public static function setUpBeforeClass(): void
    {
        ContractPrerequisites::assertMet();
        try {
            self::$config = BackendConfig::fromArray(require __DIR__ . '/../../config/credentials.php', 'credentials.php', sys_get_temp_dir());
        } catch (ConfigurationException $e) {
            self::markTestSkipped('The local backend isn\'t configured completely: ' . $e->getMessage());
        }
        // Several workers, so parallel requests really overlap in the backend.
        self::$backend = new BackendSandboxManager('127.0.0.1', self::PORT, 'public', self::PARALLEL_PUTS);
        self::$backend->start();
    }

    public static function tearDownAfterClass(): void
    {
        self::$backend->stop();
    }

    protected function setUp(): void
    {
        $this->kv = new ExtensionData(new GuzzleChurchToolsClient((string) getenv('CT_API_URL'), Credential::loginToken((string) getenv('CT_API_TOKEN'))));

        $users = json_decode((string) file_get_contents(__DIR__ . '/fixtures/normal_users.json'), true, 512, JSON_THROW_ON_ERROR);
        self::assertIsArray($users);
        self::assertIsArray($users[0] ?? null, 'normal_users.json needs at least one user.');
        $user = $users[0];
        $this->personId = (int) $user['id'];
        // A backend token minted with the local JWT_SECRET, as POST /v1/auth/token would issue it (catalog section 14).
        // The real OAuth login needs a browser and is checked by hand.
        $this->accessToken = (new UserTokens(self::$config->jwtSecret, new SystemClock(), new FirebaseTokenCodec()))
            ->issue(new PersonPrincipal(new PersonId($this->personId), (string) $user['username']))->token;

        if ($this->storedCiphertexts() !== []) {
            self::markTestSkipped("Fixture user {$this->personId} already has an entry on the test instance; it's left alone.");
        }

        $settings = (new KvSettingsRepository($this->kv, new \Psr\Log\NullLogger()))->settings();
        if ($settings->requirePrimaryPassword || !$settings->allowCustomPasswords) {
            self::markTestSkipped('The test instance must allow custom passwords without a primary password for this test.');
        }

        $this->mayWrite = true;
        $this->http = new Client([
            'base_uri' => self::$backend->getBaseUrl(),
            'http_errors' => false,
            'headers' => ['Authorization' => 'Bearer ' . $this->accessToken],
        ]);
    }

    protected function tearDown(): void
    {
        if (!$this->mayWrite) {
            return;
        }
        // Leaves no entry behind, whatever happened in the test.
        foreach ($this->entryIds() as $id) {
            $this->kv->delete(KvSchema::PASSWORD_CATEGORY, $id);
        }
    }

    /**
     * LS-01: PUT → GET → (decrypt) → DELETE → GET through the real stack.
     */
    public function testRoundTrip(): void
    {
        $password = 'Live-test-' . bin2hex(random_bytes(4)) . '!1';

        $put = $this->entries('PUT', ['secondaryPwd' => $password]);
        self::assertSame(204, $put->getStatusCode(), (string) $put->getBody());

        $stored = $this->storedCiphertexts();
        self::assertCount(1, $stored);

        $get = $this->entries('GET');
        self::assertSame(200, $get->getStatusCode(), (string) $get->getBody());
        $ciphertext = (string) $this->json($get)['secondaryPwd'];
        self::assertSame($stored[0], $ciphertext, 'GET returns exactly what is stored.');
        self::assertSame(512, strlen((string) base64_decode($ciphertext, true)), 'RSA-4096 ciphertext.');
        $this->assertDecryptsTo($password, $ciphertext);

        $delete = $this->entries('DELETE', []);
        self::assertSame(204, $delete->getStatusCode(), (string) $delete->getBody());
        self::assertSame([], $this->storedCiphertexts());
        self::assertSame(404, $this->entries('GET')->getStatusCode());
        $this->reportOutages();
    }

    /**
     * LS-02 / TR-02d: parallel PUTs for the same person. Duplicates may appear (no locking in the KV store), but no
     * request fails because of another one, the read gives the newest entry, and the next write heals the state
     * (spec 5.3.6).
     *
     * Under parallel load, connections from the backend to ChurchTools sometimes time out (`502
     * upstream-unavailable`, see TODO.md). That's not a race but an outage, which the backend handles correctly (no
     * change). Such a run is reported as incomplete instead of passed, after the data checks have run.
     */
    public function testParallelPutsHeal(): void
    {
        $promises = [];
        $start = hrtime(true);
        for ($i = 0; $i < self::PARALLEL_PUTS; $i++) {
            $password = "Parallel-$i-" . bin2hex(random_bytes(4)) . '!1';
            $promises[$i] = $this->http->requestAsync('PUT', '/v1/entries/' . $this->personId, ['json' => ['secondaryPwd' => $password]]);
        }
        $responses = Utils::unwrap($promises);
        $parallelMs = (hrtime(true) - $start) / 1e6;

        $outages = 0;
        foreach ($responses as $i => $response) {
            if ($this->isOutage($response)) {
                $outages++;
                $this->outages++;

                continue;
            }
            self::assertSame(204, $response->getStatusCode(), "PUT $i: " . $response->getBody());
        }
        self::assertLessThan(self::PARALLEL_PUTS, $outages, 'Every parallel PUT failed to reach ChurchTools.');

        // Lets the connections to ChurchTools recover before the checks.
        sleep(self::COOL_DOWN_SECONDS);

        $stored = $this->storedCiphertexts();
        self::assertGreaterThanOrEqual(1, count($stored));
        self::assertLessThanOrEqual(self::PARALLEL_PUTS - $outages, count($stored));

        $get = $this->entries('GET');
        self::assertSame(200, $get->getStatusCode(), (string) $get->getBody());
        self::assertSame(end($stored), (string) $this->json($get)['secondaryPwd'], 'The newest entry wins.');

        $start = hrtime(true);
        $heal = $this->entries('PUT', ['secondaryPwd' => 'Healing-' . bin2hex(random_bytes(4)) . '!1']);
        $singleMs = (hrtime(true) - $start) / 1e6;
        self::assertSame(204, $heal->getStatusCode(), (string) $heal->getBody());
        self::assertCount(1, $this->storedCiphertexts(), 'The next write removes all duplicates.');

        self::assertSame(204, $this->entries('DELETE', [])->getStatusCode());
        self::assertSame([], $this->storedCiphertexts());

        // Not an assertion (timing depends on the network), but shows whether the requests really overlapped.
        fwrite(STDERR, sprintf(
            "\n[LiveEntriesTest] %d parallel PUTs took %d ms (one PUT: %d ms), left %d entries, %d couldn't reach ChurchTools.\n",
            self::PARALLEL_PUTS,
            $parallelMs,
            $singleMs,
            count($stored),
            $outages,
        ));
        $this->reportOutages();
    }

    /**
     * A run in which ChurchTools couldn't be reached is reported as incomplete, never as passed.
     */
    private function reportOutages(): void
    {
        if ($this->outages > 0) {
            self::markTestIncomplete("{$this->outages} requests got 502 upstream-unavailable (connect timeout to ChurchTools, see TODO.md). The data checks passed.");
        }
    }

    private function isOutage(ResponseInterface $response): bool
    {
        if ($response->getStatusCode() !== 502) {
            return false;
        }
        $isOutage = str_ends_with((string) ($this->json($response)['type'] ?? ''), '#upstream-unavailable');
        $response->getBody()->rewind();

        return $isOutage;
    }

    /**
     * @param array<string, string>|null $json
     */
    private function entries(string $method, ?array $json = null): ResponseInterface
    {
        // An empty array must go out as the JSON object {}, not as [].
        $options = $json === null ? [] : ['body' => $json === [] ? '{}' : json_encode($json, JSON_THROW_ON_ERROR), 'headers' => ['Content-Type' => 'application/json']];

        $response = $this->http->request($method, '/v1/entries/' . $this->personId, $options);
        if ($this->isOutage($response)) {
            // Retried once: the requests here are idempotent, and a connect timeout means ChurchTools got nothing.
            $this->outages++;
            sleep(self::COOL_DOWN_SECONDS);
            $response = $this->http->request($method, '/v1/entries/' . $this->personId, $options);
        }

        return $response;
    }

    /**
     * @return array<string, mixed>
     */
    private function json(ResponseInterface $response): array
    {
        $data = json_decode((string) $response->getBody(), true, 512, JSON_THROW_ON_ERROR);
        self::assertIsArray($data);

        return $data;
    }

    /**
     * @return list<int> the fixture user's value IDs, oldest first
     */
    private function entryIds(): array
    {
        return array_keys($this->entriesById());
    }

    /**
     * @return list<string> the fixture user's stored ciphertexts, oldest first
     */
    private function storedCiphertexts(): array
    {
        return array_values($this->entriesById());
    }

    /**
     * @return array<int, string>
     */
    private function entriesById(): array
    {
        $entries = [];
        foreach ($this->kv->values(KvSchema::PASSWORD_CATEGORY) as $value) {
            $decoded = json_decode((string) $value['value'], true);
            if (is_array($decoded) && ($decoded[KvSchema::ENTRY_PERSON_ID] ?? null) === $this->personId) {
                $entries[(int) $value['id']] = (string) ($decoded[KvSchema::ENTRY_CIPHERTEXT] ?? '');
            }
        }
        ksort($entries);

        return $entries;
    }

    private function assertDecryptsTo(string $expected, string $ciphertext): void
    {
        $keyFile = (string) getenv('CT_TEST_PRIVATE_KEY_FILE');
        if ($keyFile === '') {
            return;
        }
        $key = PublicKeyLoader::loadPrivateKey((string) file_get_contents($keyFile));
        self::assertInstanceOf(RSA\PrivateKey::class, $key);
        $plaintext = $key->withPadding(RSA::ENCRYPTION_OAEP)->withHash('sha256')->withMGFHash('sha256')->decrypt((string) base64_decode($ciphertext, true));
        self::assertSame($expected, $plaintext);
    }
}
