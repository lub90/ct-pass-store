<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Api;

use CtPassStore\Infrastructure\ChurchTools\Credential;
use CtPassStore\Infrastructure\ChurchTools\Exception\UnavailableException;
use CtPassStore\Infrastructure\Kv\KvSchema;
use Firebase\JWT\JWT;
use Monolog\Logger;

/**
 * What the backend logs, end to end through the API (spec 6.3, 6.4; catalog LG-01 to LG-03, LG-07).
 */
final class LoggingApiTest extends ApiTestCase
{
    private const REDIRECT_URI = 'https://example.church.tools/ccm/ctpassstore/';
    private const CODE = 'authorization-code-SECRET-1';
    private const VERIFIER = 'pkce-verifier-SECRET-0123456789012345678901234';
    private const PERSON = 42;
    private const PRIMARY = 'Primary-password-42';
    private const CUSTOM = 'Custom-SECRET-pass12!';

    /** The backend token of person 42 and the ChurchTools token behind it. */
    private string $backendToken = '';

    private string $churchToolsToken = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setSettings([KvSchema::SETTING_REQUIRE_PRIMARY_PASSWORD => true]);
        $this->churchTools->addLogin('alice', self::PRIMARY, self::PERSON);
        $this->churchTools->setOAuthClient(self::OAUTH_CLIENT_ID, self::OAUTH_CLIENT_SECRET);
    }

    private function login(): void
    {
        $this->churchToolsToken = JWT::encode([
            'iss' => 'CtPassStore', 'aud' => self::OAUTH_CLIENT_ID, 'sub' => (string) self::PERSON, 'scopes' => ['api'],
            'iat' => time(), 'exp' => time() + 3600, 'jti' => bin2hex(random_bytes(8)),
        ], (string) file_get_contents(__DIR__ . '/../keys/privateKey1.pem'), 'RS256');
        $this->churchTools->addAuthorizationCode(self::CODE, self::VERIFIER, self::REDIRECT_URI, $this->churchToolsToken);
        $user = Credential::bearerToken($this->churchToolsToken);
        $this->churchTools->addUser($user, self::PERSON, 'alice', [KvSchema::EXTENSION_KEY => ['view' => true]]);
        $this->churchTools->setWhoami($user, ['id' => self::PERSON, 'cmsUserId' => 'alice']);

        $response = $this->request('POST', '/v1/auth/token', null, ['code' => self::CODE, 'codeVerifier' => self::VERIFIER, 'redirectUri' => self::REDIRECT_URI]);
        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
        $this->backendToken = (string) $this->json($response)['accessToken'];
    }

    /**
     * @param array<string, mixed>|null $json
     */
    private function asAlice(string $method, ?array $json = null): \Psr\Http\Message\ResponseInterface
    {
        return $this->request($method, '/v1/entries/' . self::PERSON, null, $json, ['Authorization' => 'Bearer ' . $this->backendToken]);
    }

    /**
     * LG-01: after real flows, none of the secrets is in any record (message and context).
     */
    public function testNoSecretReachesTheLog(): void
    {
        $this->login();
        $secrets = [
            self::PRIMARY, self::CUSTOM, 'Wrong-SECRET-primary', 'weakSECRET',
            $this->backendToken, $this->churchToolsToken, self::CODE, self::VERIFIER,
            self::OAUTH_CLIENT_SECRET, self::JWT_SECRET,
        ];
        $ciphertexts = [];

        // PUT with primary and custom password.
        self::assertSame(204, $this->asAlice('PUT', ['primaryPwd' => self::PRIMARY, 'secondaryPwd' => self::CUSTOM])->getStatusCode());
        $ciphertexts[] = $this->storedEntries()[0][KvSchema::ENTRY_CIPHERTEXT];
        // PUT with a generated password.
        $generated = $this->asAlice('PUT', ['primaryPwd' => self::PRIMARY]);
        self::assertSame(200, $generated->getStatusCode());
        $secrets[] = (string) $this->json($generated)['secondaryPwd'];
        $ciphertexts[] = $this->storedEntries()[0][KvSchema::ENTRY_CIPHERTEXT];
        // GET.
        $read = $this->asAlice('GET');
        self::assertSame(200, $read->getStatusCode());
        $ciphertexts[] = (string) $this->json($read)['secondaryPwd'];
        // Error responses: wrong primary password, policy violation, another person's entry, a bad token.
        self::assertSame(403, $this->asAlice('PUT', ['primaryPwd' => 'Wrong-SECRET-primary', 'secondaryPwd' => self::CUSTOM])->getStatusCode());
        self::assertSame(400, $this->asAlice('PUT', ['primaryPwd' => self::PRIMARY, 'secondaryPwd' => 'weakSECRET'])->getStatusCode());
        self::assertSame(403, $this->request('GET', '/v1/entries/' . self::USER, null, null, ['Authorization' => 'Bearer ' . $this->backendToken])->getStatusCode());
        self::assertSame(401, $this->request('GET', '/v1/entries/' . self::PERSON, null, null, ['Authorization' => 'Bearer ' . $this->backendToken . 'x'])->getStatusCode());
        // An upstream failure (logged at error level, with trace).
        $this->churchTools->failNext('getValues', new UnavailableException('down'));
        self::assertSame(502, $this->asAlice('GET')->getStatusCode());
        // DELETE.
        self::assertSame(204, $this->asAlice('DELETE', ['primaryPwd' => self::PRIMARY])->getStatusCode());

        self::assertNotSame([], $this->log->getRecords());
        // JSON would escape `/` in a leaked ciphertext, so the search runs on unescaped JSON; make sure that matters.
        self::assertSame(1, preg_match('#[/+]#', implode('', $ciphertexts)), 'The test ciphertexts contain a character JSON escapes.');
        foreach ([...$secrets, ...$ciphertexts] as $secret) {
            self::assertNotSame('', $secret);
            foreach ($this->log->getRecords() as $record) {
                $line = (string) json_encode([$record['message'], $record['context']], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
                self::assertStringNotContainsString($secret, $line, "A secret reached the log: {$record['message']}");
            }
        }
    }

    /** LG-02 */
    public function testDeniedAccessIsAWarningWithPersonAndAddress(): void
    {
        $this->request('GET', '/v1/entries/' . self::OTHER, self::USER);

        $denied = array_values(array_filter($this->log->getRecords(), static fn(array $r): bool => $r['level'] === Logger::WARNING));
        self::assertCount(1, $denied);
        self::assertStringContainsString('User ' . self::USER, $denied[0]['message']);
        self::assertSame(self::CLIENT_IP, $denied[0]['context']['ip']);
    }

    /** LG-02: a rejected token is a warning with the address (the person is unknown then). */
    public function testARejectedTokenIsAWarningWithAddress(): void
    {
        $this->request('GET', '/v1/entries/' . self::USER, null, null, ['Authorization' => 'Bearer garbage']);

        $warnings = array_values(array_filter($this->log->getRecords(), static fn(array $r): bool => $r['level'] === Logger::WARNING));
        self::assertCount(1, $warnings);
        self::assertSame(self::CLIENT_IP, $warnings[0]['context']['ip']);
    }

    /** LG-03 */
    public function testLoginsChangesAndDeletionsAreInfoEntries(): void
    {
        $this->login();
        $this->asAlice('PUT', ['primaryPwd' => self::PRIMARY, 'secondaryPwd' => self::CUSTOM]);
        $this->asAlice('DELETE', ['primaryPwd' => self::PRIMARY]);

        $info = array_map(static fn(array $r): string => $r['message'], array_filter($this->log->getRecords(), static fn(array $r): bool => $r['level'] === Logger::INFO));
        self::assertNotSame([], preg_grep('/^User 42 logged in\./', $info));
        self::assertNotSame([], preg_grep('/^Created password entry \d+ for person 42\./', $info));
        self::assertNotSame([], preg_grep('/^Deleted password entry \d+ of person 42\./', $info));
    }

    /** LG-07 end to end: the backend version is on error records only. */
    public function testErrorRecordsCarryTheVersion(): void
    {
        $this->request('GET', '/v1/entries/' . self::USER, self::OTHER);
        $this->churchTools->failNext('getValues', new UnavailableException('down'));
        $this->request('GET', '/v1/entries/' . self::USER, self::USER);

        $records = $this->log->getRecords();
        $errors = array_filter($records, static fn(array $r): bool => $r['level'] >= Logger::ERROR);
        self::assertNotSame([], $errors);
        foreach ($errors as $record) {
            self::assertSame('0.1.0+test', $record['context']['version']);
        }
        foreach (array_diff_key($records, $errors) as $record) {
            self::assertArrayNotHasKey('version', $record['context']);
        }
    }
}
