<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Api;

use CtPassStore\Application;
use CtPassStore\Config\BackendConfig;
use CtPassStore\Http\Problem\ProblemType;
use CtPassStore\Infrastructure\ChurchTools\Credential;
use CtPassStore\Infrastructure\Kv\KvSchema;
use CtPassStore\Tests\Support\FakeChurchToolsClient;
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
 * Every test starts with a fresh ChurchTools containing the ctpassstore module, valid settings, the test public key
 * and these people:
 *
 * | Name       | Person ID | Role in the settings | `view` permission |
 * | ---------- | --------- | -------------------- | ----------------- |
 * | user       | 10        | –                    | yes               |
 * | other      | 11        | –                    | yes               |
 * | admin      | 100       | adminUsers           | yes               |
 * | reader     | 200       | readAccessUsers      | yes               |
 * | noAccess   | 300       | –                    | no                |
 */
abstract class ApiTestCase extends TestCase
{
    protected const USER = 10;
    protected const OTHER = 11;
    protected const ADMIN = 100;
    protected const READER = 200;
    protected const NO_ACCESS = 300;

    protected const ORIGIN = 'https://example.church.tools';
    protected const CLIENT_IP = '203.0.113.7';

    /** @var array<int, string> */
    private const NAMES = [
        self::USER => 'user',
        self::OTHER => 'other',
        self::ADMIN => 'admin',
        self::READER => 'reader',
        self::NO_ACCESS => 'noaccess',
    ];

    protected FakeChurchToolsClient $churchTools;

    protected TestHandler $log;

    /** @var array<string, int> */
    protected array $categoryIds;

    private string $credentialsPath;

    protected function setUp(): void
    {
        $this->churchTools = new FakeChurchToolsClient();
        $this->categoryIds = $this->churchTools->addModule(KvSchema::EXTENSION_KEY, [
            KvSchema::SETTINGS_CATEGORY,
            KvSchema::ENCRYPTION_CATEGORY,
            KvSchema::PASSWORD_CATEGORY,
        ]);

        foreach (self::NAMES as $personId => $name) {
            $this->churchTools->addUser(
                Credential::loginToken($this->tokenOf($personId)),
                $personId,
                $name,
                [KvSchema::EXTENSION_KEY => ['view' => $personId !== self::NO_ACCESS]],
            );
            $this->churchTools->addLogin($name, $this->primaryPasswordOf($personId), $personId);
        }

        $this->setSettings([]);
        $this->churchTools->seedValue(
            $this->categoryIds[KvSchema::ENCRYPTION_CATEGORY],
            json_encode([KvSchema::PUBLIC_KEY => file_get_contents(__DIR__ . '/../keys/publicKey1.pem')], JSON_THROW_ON_ERROR),
        );

        $this->credentialsPath = (string) tempnam(sys_get_temp_dir(), 'ctps-credentials-');
        chmod($this->credentialsPath, 0o600);

        $this->log = new TestHandler();
    }

    protected function tearDown(): void
    {
        @unlink($this->credentialsPath);
    }

    /**
     * Replaces the settings value. Unset keys get these defaults: no primary password required, custom passwords
     * allowed, length 12, admin 100, reader 200.
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
            'readAccessUsers' => [self::READER],
        ], JSON_THROW_ON_ERROR));
    }

    protected function tokenOf(int $personId): string
    {
        return 'login-token-of-' . $personId;
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
     * @param int|null $asPerson whose login token to send; null sends no Authorization header
     * @param array<string, mixed>|null $json
     * @param array<string, string> $headers
     */
    protected function request(string $method, string $path, ?int $asPerson = null, ?array $json = null, array $headers = []): ResponseInterface
    {
        $request = (new ServerRequestFactory())->createServerRequest($method, 'https://backend.example.org' . $path, [
            'REMOTE_ADDR' => self::CLIENT_IP,
        ]);
        if ($asPerson !== null) {
            $request = $request->withHeader('Authorization', 'Login ' . $this->tokenOf($asPerson));
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
     * Sends a request with a raw body and headers, e.g. invalid JSON or another content type.
     *
     * @param array<string, string> $headers
     */
    protected function rawRequest(string $method, string $path, ?int $asPerson, string $body, array $headers = ['Content-Type' => 'application/json']): ResponseInterface
    {
        $request = (new ServerRequestFactory())->createServerRequest($method, 'https://backend.example.org' . $path, ['REMOTE_ADDR' => self::CLIENT_IP])
            ->withBody((new StreamFactory())->createStream($body));
        if ($asPerson !== null) {
            $request = $request->withHeader('Authorization', 'Login ' . $this->tokenOf($asPerson));
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

        return Application::create(
            new BackendConfig('https://example.church.tools/api', 'service-token', [self::ORIGIN], $this->credentialsPath),
            $this->churchTools,
            $logger,
        );
    }
}
