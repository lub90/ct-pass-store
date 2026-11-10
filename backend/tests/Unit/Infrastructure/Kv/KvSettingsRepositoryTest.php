<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Infrastructure\Kv;

use CtPassStore\Application\Exception\ConfigurationException;
use CtPassStore\Infrastructure\Kv\ExtensionData;
use CtPassStore\Infrastructure\Kv\KvSchema;
use CtPassStore\Infrastructure\Kv\KvSettingsRepository;
use CtPassStore\Tests\Support\FakeChurchToolsClient;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Catalog SE-01 to SE-05, SE-07 to SE-09, EN-05, EN-06, EN-10.
 */
final class KvSettingsRepositoryTest extends TestCase
{
    private \Monolog\Handler\TestHandler $log;

    /** The repository last created by settings(), whose findings the tests check. */
    private KvSettingsRepository $repository;

    private const KEYS = __DIR__ . '/../../../keys/';

    private FakeChurchToolsClient $fake;

    /** @var array<string, int> */
    private array $categories;

    protected function setUp(): void
    {
        $this->fake = new FakeChurchToolsClient();
        $this->log = new \Monolog\Handler\TestHandler();
        $this->categories = $this->fake->addModule(KvSchema::EXTENSION_KEY, [
            KvSchema::SETTINGS_CATEGORY,
            KvSchema::ENCRYPTION_CATEGORY,
            KvSchema::PASSWORD_CATEGORY,
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private static function validSettings(): array
    {
        return [
            KvSchema::SETTING_REQUIRE_PRIMARY_PASSWORD => true,
            KvSchema::SETTING_ALLOW_CUSTOM_PASSWORD => false,
            'passwordLength' => 16,
            'adminUsers' => [7, 8],
            'readAccessUsers' => [9],
            'backendUrl' => 'https://backend.example.org/ctpassstore/',
        ];
    }

    /**
     * @param array<string, mixed>|string $settings a JSON object, or a raw value
     */
    private function settings(array|string $settings): KvSettingsRepository
    {
        $this->fake->seedValue($this->categories[KvSchema::SETTINGS_CATEGORY], is_string($settings) ? $settings : json_encode($settings, JSON_THROW_ON_ERROR));

        return $this->repository = new KvSettingsRepository(new ExtensionData($this->fake), new \Monolog\Logger('test', [$this->log]));
    }

    private function withPublicKey(string $pem): KvSettingsRepository
    {
        $this->fake->seedValue($this->categories[KvSchema::ENCRYPTION_CATEGORY], json_encode([KvSchema::PUBLIC_KEY => $pem], JSON_THROW_ON_ERROR));

        return $this->settings(self::validSettings());
    }

    // ---------------------------------------------------------------- SE-01, SE-02, SE-09

    /**
     * Q23: read-access users are gone. Old settings may still contain the list; it's ignored, even if it's invalid.
     */
    public function testALeftoverReadAccessListIsIgnored(): void
    {
        $settings = $this->settings(['readAccessUsers' => 'not even a list'] + self::validSettings())->settings();

        // No error, and the list grants nothing: only adminUsers carries rights.
        self::assertSame([7, 8], $settings->adminUsers);
    }

    public function testValidSettingsAreTyped(): void
    {
        $settings = $this->settings(self::validSettings());

        self::assertTrue($settings->settings()->requirePrimaryPassword);
        self::assertFalse($settings->settings()->allowCustomPasswords);
        self::assertSame(16, $settings->settings()->passwordLength);
        self::assertSame([7, 8], $settings->settings()->adminUsers);
        self::assertSame('https://backend.example.org/ctpassstore', $settings->settings()->backendUrl, 'A trailing slash is removed.');
    }

    public function testMissingOptionalListsAreEmpty(): void
    {
        $raw = self::validSettings();
        unset($raw['adminUsers'], $raw['readAccessUsers'], $raw['backendUrl']);
        $settings = $this->settings($raw);

        self::assertSame([], $settings->settings()->adminUsers);
        self::assertNull($settings->settings()->backendUrl);
    }

    public function testSettingsAreLoadedOnlyOnce(): void
    {
        $settings = $this->settings(self::validSettings());
        $settings->settings();
        $settings->settings();
        $settings->settings();

        self::assertSame(1, $this->fake->countCalls(['getValues']));
    }

    /**
     * @return iterable<string, array{int}>
     */
    public static function validLengths(): iterable
    {
        yield 'minimum' => [12];
        yield 'maximum' => [64];
    }

    #[DataProvider('validLengths')]
    public function testPasswordLengthBoundariesAreAccepted(int $length): void
    {
        self::assertSame($length, $this->settings(['passwordLength' => $length] + self::validSettings())->settings()->passwordLength);
    }

    // ---------------------------------------------------------------- SE-03, SE-04, SE-05, SE-09 invalid

    /**
     * @return iterable<string, array{string, mixed}>
     */
    public static function invalidValues(): iterable
    {
        yield 'passwordLength 11' => ['passwordLength', 11];
        yield 'passwordLength 65' => ['passwordLength', 65];
        yield 'passwordLength 0' => ['passwordLength', 0];
        yield 'passwordLength negative' => ['passwordLength', -12];
        yield 'passwordLength string' => ['passwordLength', '12'];
        yield 'passwordLength huge' => ['passwordLength', 1_000_000_000];
        yield 'passwordLength missing' => ['passwordLength', null];
        yield 'adminUsers with a string' => ['adminUsers', ['1; drop']];
        yield 'adminUsers with a numeric string' => ['adminUsers', ['7']];
        yield 'adminUsers with negative' => ['adminUsers', [-1]];
        yield 'adminUsers with 0' => ['adminUsers', [0]];
        yield 'adminUsers with float' => ['adminUsers', [1.5]];
        yield 'adminUsers with null' => ['adminUsers', [null]];
        yield 'adminUsers not a list' => ['adminUsers', ['a' => 1]];
        yield 'adminUsers a number' => ['adminUsers', 7];
        yield 'requirePassword as string' => [KvSchema::SETTING_REQUIRE_PRIMARY_PASSWORD, 'false'];
        yield 'requirePassword as 0' => [KvSchema::SETTING_REQUIRE_PRIMARY_PASSWORD, 0];
        yield 'requirePassword as 1' => [KvSchema::SETTING_REQUIRE_PRIMARY_PASSWORD, 1];
        yield 'requirePassword missing' => [KvSchema::SETTING_REQUIRE_PRIMARY_PASSWORD, null];
        yield 'allowCustom as "true"' => [KvSchema::SETTING_ALLOW_CUSTOM_PASSWORD, 'true'];
        yield 'allowCustom missing' => [KvSchema::SETTING_ALLOW_CUSTOM_PASSWORD, null];
    }

    #[DataProvider('invalidValues')]
    public function testInvalidValuesAreConfigurationErrorsNamingTheSetting(string $key, mixed $value): void
    {
        $raw = self::validSettings();
        if ($value === null) {
            unset($raw[$key]);
        } else {
            $raw[$key] = $value;
        }
        $settings = $this->settings($raw);

        try {
            $settings->settings();
            self::fail("Expected a ConfigurationException for $key.");
        } catch (ConfigurationException $e) {
            self::assertStringContainsString($key, $e->getMessage());
        }
    }

    public function testPasswordLengthAsAFloatIsAConfigurationError(): void
    {
        $settings = $this->settings('{"requirePasswordForPasswordChange": true, "allowCustomPassword": true, "passwordLength": 12.0}');

        $this->expectException(ConfigurationException::class);
        $settings->settings();
    }

    // ---------------------------------------------------------------- SE-07, SE-08

    public function testNoSettingsValueIsAConfigurationError(): void
    {
        $settings = new KvSettingsRepository(new ExtensionData($this->fake), new \Monolog\Logger('test', [$this->log]));

        $this->expectException(ConfigurationException::class);
        $settings->settings();
    }

    public function testSeveralSettingsValuesAreAConfigurationError(): void
    {
        $this->fake->seedValue($this->categories[KvSchema::SETTINGS_CATEGORY], json_encode(self::validSettings(), JSON_THROW_ON_ERROR));
        $settings = $this->settings(self::validSettings());

        $this->expectException(ConfigurationException::class);
        $settings->settings();
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function brokenValues(): iterable
    {
        yield 'not JSON' => ['{broken'];
        yield 'a JSON list' => ['[1, 2]'];
        yield 'a JSON string' => ['"x"'];
    }

    #[DataProvider('brokenValues')]
    public function testBrokenSettingsValueIsAConfigurationError(string $raw): void
    {
        $settings = $this->settings($raw);

        $this->expectException(ConfigurationException::class);
        $settings->settings();
    }

    public function testMissingEncryptionSettingsAreAConfigurationError(): void
    {
        $settings = $this->settings(self::validSettings());

        $this->expectException(ConfigurationException::class);
        $settings->publicKey();
    }

    /**
     * SE-08: exactly one value; with two, it's unclear which key is the right one.
     */
    public function testSeveralEncryptionSettingsAreAConfigurationError(): void
    {
        $pem = (string) file_get_contents(self::KEYS . 'publicKey1.pem');
        $this->fake->seedValue($this->categories[KvSchema::ENCRYPTION_CATEGORY], json_encode([KvSchema::PUBLIC_KEY => $pem], JSON_THROW_ON_ERROR));
        $this->fake->seedValue($this->categories[KvSchema::ENCRYPTION_CATEGORY], json_encode([KvSchema::PUBLIC_KEY => $pem], JSON_THROW_ON_ERROR));
        $settings = $this->settings(self::validSettings());

        try {
            $settings->publicKey();
            self::fail('Expected a ConfigurationException.');
        } catch (ConfigurationException $e) {
            self::assertStringContainsString('exactly one value', $e->getMessage());
        }
    }

    /**
     * SE-05: an explicit JSON null is neither true nor false.
     */
    public function testNullBooleansAreRejected(): void
    {
        foreach ([KvSchema::SETTING_REQUIRE_PRIMARY_PASSWORD, KvSchema::SETTING_ALLOW_CUSTOM_PASSWORD] as $key) {
            $raw = self::validSettings();
            $raw[$key] = null;
            $settings = $this->settings(json_encode($raw, JSON_THROW_ON_ERROR));
            try {
                $settings->settings();
                self::fail("Expected a ConfigurationException for $key = null.");
            } catch (ConfigurationException $e) {
                self::assertStringContainsString($key, $e->getMessage());
            }
            $this->setUp();
        }
    }

    public function testEncryptionSettingsWithoutPublicKeyAreAConfigurationError(): void
    {
        $this->fake->seedValue($this->categories[KvSchema::ENCRYPTION_CATEGORY], '{"other": 1}');
        $settings = $this->settings(self::validSettings());

        $this->expectException(ConfigurationException::class);
        $settings->publicKey();
    }

    // ---------------------------------------------------------------- EN-05, EN-06, EN-10

    /**
     * @return iterable<string, array{string}>
     */
    public static function acceptedKeys(): iterable
    {
        yield 'RSA 4096' => [(string) file_get_contents(self::KEYS . 'publicKey1.pem')];
        yield 'RSA 4096 with CRLF line endings' => [(string) file_get_contents(self::KEYS . 'valid/rsa4096-crlf.pub.pem')];
        yield 'RSA 8192' => [(string) file_get_contents(self::KEYS . 'valid/rsa8192.pub.pem')];
    }

    #[DataProvider('acceptedKeys')]
    public function testRsaKeysWithAtLeast4096BitsAreAccepted(string $pem): void
    {
        self::assertGreaterThanOrEqual(4096, $this->withPublicKey($pem)->publicKey()->key->getLength());
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function rejectedKeys(): iterable
    {
        yield 'RSA 2048' => [(string) file_get_contents(self::KEYS . 'invalid/rsa2048.pub.pem')];
        yield 'EC P-256' => [(string) file_get_contents(self::KEYS . 'invalid/ec.pub.pem')];
        yield 'Ed25519' => [(string) file_get_contents(self::KEYS . 'invalid/ed25519.pub.pem')];
        yield 'X.509 certificate with an RSA 4096 key' => [(string) file_get_contents(self::KEYS . 'invalid/certificate.pem')];
        yield 'private key' => [(string) file_get_contents(self::KEYS . 'privateKey1.pem')];
        yield 'garbage' => ['-----BEGIN PUBLIC KEY-----\nnot base64\n-----END PUBLIC KEY-----'];
        yield 'empty' => [''];
    }

    #[DataProvider('rejectedKeys')]
    public function testOtherKeysAreConfigurationErrors(string $pem): void
    {
        $settings = $this->withPublicKey($pem);

        $this->expectException(ConfigurationException::class);
        $settings->publicKey();
    }

    /**
     * An invalid backendUrl only disables machine clients, like a missing one (spec 4.4a.3); users keep working.
     */
    #[DataProvider('invalidBackendUrls')]
    public function testAnInvalidBackendUrlIsTreatedAsMissingAndReported(mixed $url): void
    {
        $settings = $this->settings(['backendUrl' => $url] + self::validSettings())->settings();

        self::assertNull($settings->backendUrl);
        self::assertSame(16, $settings->passwordLength, 'The other settings stay usable.');
        self::assertCount(1, $this->repository->findings());
        self::assertStringContainsString('backendUrl', $this->repository->findings()[0]);
        self::assertTrue($this->log->hasWarningThatContains('The setting backendUrl must be an https:// URL'));
    }

    /**
     * @return iterable<string, array{mixed}>
     */
    public static function invalidBackendUrls(): iterable
    {
        yield 'http' => ['http://backend.example.org'];
        yield 'empty' => [''];
        yield 'with query' => ['https://backend.example.org/?x=1'];
        yield 'with fragment' => ['https://backend.example.org/#x'];
        yield 'with credentials' => ['https://u:p@backend.example.org'];
        yield 'not a string' => [42];
    }

    // ---------------------------------------------------------------- machineClients (spec 3.2, D5)

    /**
     * @param array<string, mixed> $overrides
     * @return array<string, mixed>
     */
    private static function client(array $overrides = []): array
    {
        return array_merge([
            'id' => 'ct-radius',
            'name' => 'WiFi RADIUS',
            'publicKeys' => [base64_encode(str_repeat('k', 32))],
            'permissions' => ['entries:read'],
            'createdAt' => '2026-11-01',
        ], $overrides);
    }

    /**
     * @param mixed $machineClients
     */
    private function machineSettings(mixed $machineClients): \CtPassStore\Domain\Settings
    {
        return $this->settings(['machineClients' => $machineClients] + self::validSettings())->settings();
    }

    public function testMissingMachineClientsMeansNone(): void
    {
        $settings = $this->settings(self::validSettings())->settings();

        self::assertSame([], $settings->machineClients);
        self::assertSame([], $this->repository->findings());
        self::assertFalse($this->log->hasWarningRecords());
    }

    public function testAValidClientIsEnabled(): void
    {
        $settings = $this->machineSettings([self::client(), self::client(['id' => 'other-client', 'publicKeys' => [rtrim(strtr(base64_encode(str_repeat('o', 32)), '+/', '-_'), '=')]])]);

        self::assertSame(['ct-radius', 'other-client'], array_keys($settings->machineClients));
        $client = $settings->machineClients['ct-radius'];
        self::assertSame('WiFi RADIUS', $client->name);
        self::assertSame([str_repeat('k', 32)], $client->publicKeys);
        self::assertSame(['entries:read'], $client->permissions);
        self::assertSame([str_repeat('o', 32)], $settings->machineClients['other-client']->publicKeys, 'base64url without padding is accepted.');
        self::assertSame([], $this->repository->findings());
    }

    /**
     * @param array<string, mixed>|string $entry
     */
    #[DataProvider('invalidClients')]
    public function testAnInvalidEntryDisablesOnlyThatClient(array|string $entry, string $problem): void
    {
        $settings = $this->machineSettings([self::client(['id' => 'good-client']), $entry]);

        self::assertSame(['good-client'], array_keys($settings->machineClients));
        self::assertCount(1, $this->repository->findings());
        self::assertStringContainsString($problem, $this->repository->findings()[0]);
        self::assertTrue($this->log->hasWarningThatContains($problem), 'The admin finds the reason in the log.');
    }

    /**
     * @return iterable<string, array{array<string, mixed>|string, string}>
     */
    public static function invalidClients(): iterable
    {
        yield 'not an object' => ['ct-radius', 'isn\'t an object'];
        yield 'uppercase id' => [self::client(['id' => 'CT-Radius']), 'the id must be'];
        yield 'id too short' => [self::client(['id' => 'ab']), 'the id must be'];
        yield 'id too long' => [self::client(['id' => str_repeat('a', 41)]), 'the id must be'];
        yield 'id with lookalike' => [self::client(['id' => "ct-r\u{0430}dius"]), 'the id must be'];
        yield 'id with space' => [self::client(['id' => 'ct radius']), 'the id must be'];
        yield 'id missing' => [self::client(['id' => null]), 'the id must be'];
        yield 'empty publicKeys' => [self::client(['publicKeys' => []]), 'publicKeys must be a non-empty list'];
        yield 'publicKeys missing' => [self::client(['publicKeys' => null]), 'publicKeys must be a non-empty list'];
        yield 'publicKeys a string' => [self::client(['publicKeys' => base64_encode(str_repeat('k', 32))]), 'publicKeys must be a non-empty list'];
        yield 'key too short' => [self::client(['publicKeys' => [base64_encode(str_repeat('k', 31))]]), 'isn\'t a base64-encoded Ed25519'];
        yield 'key not base64' => [self::client(['publicKeys' => ['not base64!']]), 'isn\'t a base64-encoded Ed25519'];
        yield 'RSA PEM as key' => [self::client(['publicKeys' => ["-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----"]]), 'isn\'t a base64-encoded Ed25519'];
        yield 'permissions not a list' => [self::client(['permissions' => 'entries:read']), 'permissions must be a list'];
    }

    public function testDuplicateIdsDisableBothEntries(): void
    {
        $settings = $this->machineSettings([self::client(), self::client(['name' => 'Impostor']), self::client(['id' => 'good-client'])]);

        self::assertSame(['good-client'], array_keys($settings->machineClients));
        self::assertCount(2, $this->repository->findings());
    }

    /**
     * SE-06a: 3 and 40 characters are the boundaries (2 and 41 are in invalidClients).
     */
    public function testClientIdLengthBoundariesAreAccepted(): void
    {
        $settings = $this->machineSettings([
            self::client(['id' => 'abc', 'publicKeys' => [base64_encode(str_repeat('a', 32))]]),
            self::client(['id' => str_repeat('b', 40), 'publicKeys' => [base64_encode(str_repeat('b', 32))]]),
        ]);

        self::assertSame(['abc', str_repeat('b', 40)], array_keys($settings->machineClients));
    }

    public function testClientsSharingAPublicKeyAreAllDisabled(): void
    {
        $shared = base64_encode(str_repeat('s', 32));
        $settings = $this->machineSettings([
            self::client(['id' => 'ct-radius', 'publicKeys' => [base64_encode(str_repeat('k', 32)), $shared]]),
            self::client(['id' => 'impostor', 'publicKeys' => [$shared]]),
            self::client(['id' => 'good-client', 'publicKeys' => [base64_encode(str_repeat('g', 32))]]),
        ]);

        self::assertSame(['good-client'], array_keys($settings->machineClients));
        self::assertCount(2, $this->repository->findings());
        self::assertStringContainsString('ct-radius is disabled: it shares a public key with impostor', $this->repository->findings()[0]);
        self::assertTrue($this->log->hasWarningThatContains('impostor is disabled: it shares a public key with ct-radius'));
    }

    public function testTheSameKeyTwiceWithinOneClientIsFine(): void
    {
        $key = base64_encode(str_repeat('k', 32));
        $settings = $this->machineSettings([self::client(['publicKeys' => [$key, $key]])]);

        self::assertSame(['ct-radius'], array_keys($settings->machineClients));
        self::assertSame([], $this->repository->findings());
    }

    public function testUnknownPermissionsGrantNothingAndAreReported(): void
    {
        $settings = $this->machineSettings([self::client(['permissions' => ['entries:read', 'entries:write', '*', 'admin', 42]])]);

        self::assertSame(['entries:read'], $settings->machineClients['ct-radius']->permissions);
        self::assertCount(4, $this->repository->findings());
        self::assertStringContainsString('entries:write', $this->repository->findings()[0]);
        self::assertStringContainsString('admin', $this->repository->findings()[2]);
    }

    public function testAClientWithoutPermissionsIsEnabledWithoutRights(): void
    {
        $settings = $this->machineSettings([self::client(['permissions' => null])]);

        self::assertSame([], $settings->machineClients['ct-radius']->permissions);
    }

    public function testABrokenListDisablesAllMachineClientsButNotTheSettings(): void
    {
        $settings = $this->machineSettings(['ct-radius' => self::client()]);

        self::assertSame([], $settings->machineClients);
        self::assertStringContainsString('isn\'t a list', $this->repository->findings()[0]);
        self::assertSame(16, $settings->passwordLength, 'Users are not affected.');
    }
}
