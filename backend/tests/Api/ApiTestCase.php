<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Api;

use CtPassStore\Application\Auth\UserTokens;
use CtPassStore\Config\BackendConfig;
use CtPassStore\Domain\PersonId;
use CtPassStore\Domain\PersonPrincipal;
use CtPassStore\Http\Problem\ProblemType;
use CtPassStore\Infrastructure\Auth\FirebaseTokenCodec;
use CtPassStore\Infrastructure\Kv\KvSchema;
use CtPassStore\Kernel;
use CtPassStore\Tests\Support\FakeChurchToolsClient;
use CtPassStore\Tests\Support\FrozenClock;
use Firebase\JWT\JWT;
use Monolog\Handler\TestHandler;
use Monolog\Logger;
use phpseclib3\Crypt\RSA;
use phpseclib3\Crypt\RSA\PrivateKey;
use PHPUnit\Framework\TestCase;
use Psr\Http\Message\ResponseInterface;
use Slim\Psr7\Factory\ServerRequestFactory;
use Slim\Psr7\Factory\StreamFactory;

/**
 * Base class for the API test layer (spec 6.6): the complete app in-process, with a fake ChurchTools.
 *
 * Every test starts with a fresh ChurchTools containing the ctpassstore module, valid settings, the test public key,
 * a frozen clock and these callers (spec 4.3). Persons send backend tokens signed with the test JWT_SECRET; machine
 * clients sign their own EdDSA tokens with test keys.
 *
 * | Caller        | ID          | Role in the settings                |
 * | ------------- | ----------- | ----------------------------------- |
 * | user          | 10          | –                                   |
 * | other         | 11          | –                                   |
 * | admin         | 100         | adminUsers                          |
 * | machine       | ct-radius   | machineClients, `entries:read`      |
 * | machine       | no-rights   | machineClients, no permission       |
 */
abstract class ApiTestCase extends TestCase
{
    protected const USER = 10;
    protected const OTHER = 11;
    protected const ADMIN = 100;
    protected const READER_CLIENT = 'ct-radius';
    protected const NO_RIGHTS_CLIENT = 'no-rights';
    protected const BACKEND_URL = 'https://backend.example.org/ctpassstore';

    protected const ORIGIN = 'https://example.church.tools';
    protected const OAUTH_CLIENT_ID = 'oauth-client-id';
    protected const OAUTH_CLIENT_SECRET = 'oauth-client-SECRET-4711';
    protected const JWT_SECRET = 'api-test-jwt-secret-with-at-least-32-bytes';
    protected const CLIENT_IP = '203.0.113.7';

    /** @var array<int, string> */
    private const NAMES = [
        self::USER => 'user',
        self::OTHER => 'other',
        self::ADMIN => 'admin',
    ];

    protected FakeChurchToolsClient $churchTools;

    protected FrozenClock $clock;

    /** @var array<string, string> Ed25519 secret keys of the machine clients */
    private array $machineKeys = [];

    protected TestHandler $log;

    /** @var array<string, int> */
    protected array $categoryIds;

    private string $credentialsPath;

    /** A fresh, empty cache folder per test. */
    protected string $cacheDir;

    protected function setUp(): void
    {
        $this->churchTools = new FakeChurchToolsClient();
        $this->clock = new FrozenClock();
        foreach ([self::READER_CLIENT, self::NO_RIGHTS_CLIENT] as $client) {
            $this->machineKeys[$client] = sodium_crypto_sign_secretkey(sodium_crypto_sign_keypair());
        }
        $this->categoryIds = $this->churchTools->addModule(KvSchema::EXTENSION_KEY, [
            KvSchema::SETTINGS_CATEGORY,
            KvSchema::ENCRYPTION_CATEGORY,
            KvSchema::PASSWORD_CATEGORY,
        ]);

        foreach (self::NAMES as $personId => $name) {
            $this->churchTools->addLogin($name, $this->primaryPasswordOf($personId), $personId);
        }

        $this->setSettings([]);
        $this->churchTools->seedValue(
            $this->categoryIds[KvSchema::ENCRYPTION_CATEGORY],
            json_encode([KvSchema::PUBLIC_KEY => file_get_contents(__DIR__ . '/../keys/publicKey1.pem')], JSON_THROW_ON_ERROR),
        );

        $this->credentialsPath = (string) tempnam(sys_get_temp_dir(), 'ctps-credentials-');
        chmod($this->credentialsPath, 0o600);
        $this->cacheDir = sys_get_temp_dir() . '/ctps-cache-' . bin2hex(random_bytes(6));

        $this->log = new TestHandler();
    }

    protected function tearDown(): void
    {
        @unlink($this->credentialsPath);
        foreach (glob($this->cacheDir . '/*') ?: [] as $file) {
            @chmod($file, 0o600);
            @unlink($file);
        }
        @chmod($this->cacheDir, 0o700);
        @rmdir($this->cacheDir);
    }

    /**
     * Replaces the settings value. Unset keys get these defaults: no primary password required, custom passwords
     * allowed, length 12, admin 100, the backend URL and the two machine clients.
     *
     * @param array<string, mixed> $overrides
     */
    protected function setSettings(array $overrides): void
    {
        $categoryId = $this->categoryIds[KvSchema::SETTINGS_CATEGORY];
        $this->churchTools->clearValues($categoryId);
        $this->churchTools->seedValue($categoryId, json_encode($overrides + [
            KvSchema::SETTING_REQUIRE_PRIMARY_PASSWORD => false,
            KvSchema::SETTING_ALLOW_CUSTOM_PASSWORD => true,
            'passwordLength' => 12,
            'adminUsers' => [self::ADMIN],
            'backendUrl' => self::BACKEND_URL,
            'machineClients' => [
                ['id' => self::READER_CLIENT, 'name' => 'RADIUS', 'publicKeys' => [$this->machinePublicKey(self::READER_CLIENT)], 'permissions' => ['entries:read']],
                ['id' => self::NO_RIGHTS_CLIENT, 'name' => 'No rights', 'publicKeys' => [$this->machinePublicKey(self::NO_RIGHTS_CLIENT)], 'permissions' => []],
            ],
        ], JSON_THROW_ON_ERROR));
    }

    /**
     * A backend access token for the person, as POST /v1/auth/token would issue it now.
     */
    protected function tokenOf(int $personId): string
    {
        return (new UserTokens(self::JWT_SECRET, $this->clock, new FirebaseTokenCodec()))->issue(new PersonPrincipal(new PersonId($personId), self::NAMES[$personId] ?? "person$personId"))->token;
    }

    /**
     * A fresh, valid machine token of the client, with claim overrides (null removes a claim).
     *
     * @param array<string, mixed> $overrides
     * @param string|null $keyOf sign with this client's key instead of the client's own
     */
    protected function machineTokenOf(string $clientId, array $overrides = [], ?string $keyOf = null): string
    {
        $now = $this->clock->timestamp();
        $claims = array_filter(array_merge([
            'iss' => $clientId,
            'sub' => $clientId,
            'aud' => self::BACKEND_URL,
            'iat' => $now,
            'exp' => $now + 60,
            'jti' => bin2hex(random_bytes(16)),
        ], $overrides), static fn(mixed $v): bool => $v !== null);

        return JWT::encode($claims, base64_encode($this->machineKeys[$keyOf ?? $clientId]), 'EdDSA', $clientId);
    }

    protected function machinePublicKey(string $clientId): string
    {
        return base64_encode(sodium_crypto_sign_publickey_from_secretkey($this->machineKeys[$clientId]));
    }

    /**
     * The Authorization header for a caller: a person ID, a machine client ID, or null for none.
     */
    private function authorizationFor(int|string|null $as): ?string
    {
        return match (true) {
            $as === null => null,
            is_int($as) => 'Bearer ' . $this->tokenOf($as),
            default => 'Bearer ' . $this->machineTokenOf($as),
        };
    }

    protected function primaryPasswordOf(int $personId): string
    {
        return 'Primary-password-' . $personId;
    }

    /**
     * Stores an encrypted password entry for a person directly in the fake KV store.
     */
    protected function seedEntry(int $personId, string $ciphertext = 'c2VlZGVkLWNpcGhlcnRleHQ='): int
    {
        return $this->churchTools->seedValue(
            $this->categoryIds[KvSchema::PASSWORD_CATEGORY],
            json_encode([KvSchema::ENTRY_PERSON_ID => $personId, KvSchema::ENTRY_CIPHERTEXT => $ciphertext], JSON_THROW_ON_ERROR),
        );
    }

    /**
     * @return list<array<string, mixed>> the decoded password entries in the fake KV store
     */
    protected function storedEntries(): array
    {
        return array_map(
            static fn(array $value): array => json_decode((string) $value['value'], true, 512, JSON_THROW_ON_ERROR),
            $this->churchTools->storedValues($this->categoryIds[KvSchema::PASSWORD_CATEGORY]),
        );
    }

    /**
     * Sends a request through the complete app.
     *
     * @param int|string|null $as who sends it: a person ID, a machine client ID, or null for no Authorization header.
     *                             An `Authorization` entry in `$headers` replaces it.
     * @param array<string, mixed>|null $json
     * @param array<string, string> $headers
     */
    protected function request(string $method, string $path, int|string|null $as = null, ?array $json = null, array $headers = []): ResponseInterface
    {
        $request = (new ServerRequestFactory())->createServerRequest($method, 'https://backend.example.org' . $path, [
            'REMOTE_ADDR' => self::CLIENT_IP,
        ]);
        $authorization = $this->authorizationFor($as);
        if ($authorization !== null) {
            $request = $request->withHeader('Authorization', $authorization);
        }
        foreach ($headers as $name => $value) {
            $request = $request->withHeader($name, $value);
        }
        if ($json !== null) {
            $request = $request
                ->withHeader('Content-Type', 'application/json')
                ->withBody((new StreamFactory())->createStream($json === [] ? '{}' : json_encode($json, JSON_THROW_ON_ERROR)));
        }

        return $this->app()->handle($request);
    }

    /**
     * Sends a request built by the test itself through the complete app.
     */
    protected function send(\Psr\Http\Message\ServerRequestInterface $request): ResponseInterface
    {
        return $this->app()->handle($request);
    }

    /**
     * Sends a request with a raw body and headers, e.g. invalid JSON or another content type.
     *
     * @param array<string, string> $headers
     */
    protected function rawRequest(string $method, string $path, int|string|null $as, string $body, array $headers = ['Content-Type' => 'application/json']): ResponseInterface
    {
        $request = (new ServerRequestFactory())->createServerRequest($method, 'https://backend.example.org' . $path, ['REMOTE_ADDR' => self::CLIENT_IP])
            ->withBody((new StreamFactory())->createStream($body));
        $authorization = $this->authorizationFor($as);
        if ($authorization !== null) {
            $request = $request->withHeader('Authorization', $authorization);
        }
        foreach ($headers as $name => $value) {
            $request = $request->withHeader($name, $value);
        }

        return $this->app()->handle($request);
    }

    /**
     * @return array<string, mixed>
     */
    protected function json(ResponseInterface $response): array
    {
        $body = (string) $response->getBody();
        $decoded = json_decode($body, true);
        self::assertIsArray($decoded, "Response body isn't a JSON object: $body");

        return $decoded;
    }

    /**
     * Asserts a complete problem details response of the given type (spec 4.9).
     *
     * @return array<string, mixed> the body
     */
    protected function assertProblem(ProblemType $type, ResponseInterface $response): array
    {
        self::assertSame($type->status(), $response->getStatusCode(), (string) $response->getBody());
        self::assertSame('application/problem+json', $response->getHeaderLine('Content-Type'));
        $body = $this->json($response);
        self::assertSame($type->uri(), $body['type'] ?? null);
        self::assertSame($type->title(), $body['title'] ?? null);
        self::assertSame($type->status(), $body['status'] ?? null);
        self::assertIsString($body['detail'] ?? null);
        self::assertNotSame('', $body['detail']);

        return $body;
    }

    protected function decrypt(string $ciphertext): string
    {
        $key = RSA::loadPrivateKey((string) file_get_contents(__DIR__ . '/../keys/privateKey1.pem'));
        self::assertInstanceOf(PrivateKey::class, $key);

        $plaintext = $key->withPadding(RSA::ENCRYPTION_OAEP)->withHash('sha256')->withMGFHash('sha256')->decrypt((string) base64_decode($ciphertext, true));
        self::assertIsString($plaintext);

        return $plaintext;
    }

    /**
     * @return \Slim\App<null>
     */
    private function app(): \Slim\App
    {
        $logger = new Logger('test');
        $logger->pushHandler($this->log);
        // The production processor, so log assertions see what logs/app.log would contain.
        $logger->pushProcessor(new \CtPassStore\Infrastructure\Logging\EscapeControlCharacters());

        return Kernel::create(
            new BackendConfig('https://example.church.tools/api', 'service-token', [self::ORIGIN], $this->credentialsPath, $this->cacheDir, self::OAUTH_CLIENT_ID, self::OAUTH_CLIENT_SECRET, self::JWT_SECRET),
            $this->churchTools,
            $logger,
            $this->clock,
        );
    }
}
