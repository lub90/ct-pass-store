<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Infrastructure\Kv;

use CtPassStore\Config\ConfigurationException;
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
    private const KEYS = __DIR__ . '/../../../keys/';

    private FakeChurchToolsClient $fake;

    /** @var array<string, int> */
    private array $categories;

    protected function setUp(): void
    {
        $this->fake = new FakeChurchToolsClient();
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

        return new KvSettingsRepository(new ExtensionData($this->fake));
    }

    private function withPublicKey(string $pem): KvSettingsRepository
    {
        $this->fake->seedValue($this->categories[KvSchema::ENCRYPTION_CATEGORY], json_encode([KvSchema::PUBLIC_KEY => $pem], JSON_THROW_ON_ERROR));

        return $this->settings(self::validSettings());
    }

    // ---------------------------------------------------------------- SE-01, SE-02, SE-09

    public function testValidSettingsAreTyped(): void
    {
        $settings = $this->settings(self::validSettings());

        self::assertTrue($settings->settings()->requirePrimaryPassword);
        self::assertFalse($settings->settings()->allowCustomPasswords);
        self::assertSame(16, $settings->settings()->passwordLength);
        self::assertSame([7, 8], $settings->settings()->adminUsers);
        self::assertSame([9], $settings->settings()->readAccessUsers);
        self::assertSame('https://backend.example.org/ctpassstore', $settings->settings()->backendUrl, 'A trailing slash is removed.');
    }

    public function testMissingOptionalListsAreEmpty(): void
    {
        $raw = self::validSettings();
        unset($raw['adminUsers'], $raw['readAccessUsers'], $raw['backendUrl']);
        $settings = $this->settings($raw);

        self::assertSame([], $settings->settings()->adminUsers);
        self::assertSame([], $settings->settings()->readAccessUsers);
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
        yield 'readAccessUsers with a string' => ['readAccessUsers', ['x']];
        yield 'requirePassword as string' => [KvSchema::SETTING_REQUIRE_PRIMARY_PASSWORD, 'false'];
        yield 'requirePassword as 0' => [KvSchema::SETTING_REQUIRE_PRIMARY_PASSWORD, 0];
        yield 'requirePassword as 1' => [KvSchema::SETTING_REQUIRE_PRIMARY_PASSWORD, 1];
        yield 'requirePassword missing' => [KvSchema::SETTING_REQUIRE_PRIMARY_PASSWORD, null];
        yield 'allowCustom as "true"' => [KvSchema::SETTING_ALLOW_CUSTOM_PASSWORD, 'true'];
        yield 'allowCustom missing' => [KvSchema::SETTING_ALLOW_CUSTOM_PASSWORD, null];
        yield 'backendUrl http' => ['backendUrl', 'http://backend.example.org'];
        yield 'backendUrl empty' => ['backendUrl', ''];
        yield 'backendUrl with query' => ['backendUrl', 'https://backend.example.org/?x=1'];
        yield 'backendUrl with fragment' => ['backendUrl', 'https://backend.example.org/#x'];
        yield 'backendUrl with credentials' => ['backendUrl', 'https://u:p@backend.example.org'];
        yield 'backendUrl not a string' => ['backendUrl', 42];
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
        $settings = new KvSettingsRepository(new ExtensionData($this->fake));

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
}
