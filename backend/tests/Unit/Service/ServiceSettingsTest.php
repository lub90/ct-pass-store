<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Service;

use CtPassStore\Config\AppConfig;
use CtPassStore\Exception\ConfigurationException;
use CtPassStore\Service\ExtensionDataService;
use CtPassStore\Service\ServiceSettings;
use CtPassStore\Tests\Support\FakeChurchToolsClient;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;

/**
 * Catalog SE-01 to SE-05, SE-07 to SE-09, EN-05, EN-06, EN-10.
 */
final class ServiceSettingsTest extends TestCase
{
    private const KEYS = __DIR__ . '/../../keys/';

    private FakeChurchToolsClient $fake;

    /** @var array<string, int> */
    private array $categories;

    protected function setUp(): void
    {
        $this->fake = new FakeChurchToolsClient();
        $this->categories = $this->fake->addModule(AppConfig::CT_EXTENSION_ID, [
            AppConfig::CT_SETTINGS_CATEGORY_NAME,
            AppConfig::CT_ENCRYPTION_SETTINGS_CATEGORY_NAME,
            AppConfig::CT_PWD_CATEGORY_NAME,
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private static function validSettings(): array
    {
        return [
            AppConfig::CT_REQUIRE_PWD_FOR_PWD_CHANGE_FIELD_NAME => true,
            AppConfig::CT_ALLOW_CUSTOM_PASSWORD_FIELD_NAME => false,
            'passwordLength' => 16,
            'adminUsers' => [7, 8],
            'readAccessUsers' => [9],
            'backendUrl' => 'https://backend.example.org/ctpassstore/',
        ];
    }

    /**
     * @param array<string, mixed>|string $settings a JSON object, or a raw value
     */
    private function settings(array|string $settings): ServiceSettings
    {
        $this->fake->seedValue($this->categories[AppConfig::CT_SETTINGS_CATEGORY_NAME], is_string($settings) ? $settings : json_encode($settings, JSON_THROW_ON_ERROR));

        return new ServiceSettings(new ExtensionDataService($this->fake, AppConfig::CT_EXTENSION_ID), new NullLogger());
    }

    private function withPublicKey(string $pem): ServiceSettings
    {
        $this->fake->seedValue($this->categories[AppConfig::CT_ENCRYPTION_SETTINGS_CATEGORY_NAME], json_encode([AppConfig::CT_PUBLIC_KEY_FIELD_NAME => $pem], JSON_THROW_ON_ERROR));

        return $this->settings(self::validSettings());
    }

    // ---------------------------------------------------------------- SE-01, SE-02, SE-09

    public function testValidSettingsAreTyped(): void
    {
        $settings = $this->settings(self::validSettings());

        self::assertTrue($settings->requirePasswordForPasswordChange());
        self::assertFalse($settings->allowCustomPasswords());
        self::assertSame(16, $settings->pwdLength());
        self::assertSame([7, 8], $settings->adminUsers());
        self::assertSame([9], $settings->readAccessUsers());
        self::assertSame('https://backend.example.org/ctpassstore', $settings->backendUrl(), 'A trailing slash is removed.');
    }

    public function testMissingOptionalListsAreEmpty(): void
    {
        $raw = self::validSettings();
        unset($raw['adminUsers'], $raw['readAccessUsers'], $raw['backendUrl']);
        $settings = $this->settings($raw);

        self::assertSame([], $settings->adminUsers());
        self::assertSame([], $settings->readAccessUsers());
        self::assertNull($settings->backendUrl());
    }

    public function testSettingsAreLoadedOnlyOnce(): void
    {
        $settings = $this->settings(self::validSettings());
        $settings->pwdLength();
        $settings->adminUsers();
        $settings->allowCustomPasswords();

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
        self::assertSame($length, $this->settings(['passwordLength' => $length] + self::validSettings())->pwdLength());
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
        yield 'requirePassword as string' => [AppConfig::CT_REQUIRE_PWD_FOR_PWD_CHANGE_FIELD_NAME, 'false'];
        yield 'requirePassword as 0' => [AppConfig::CT_REQUIRE_PWD_FOR_PWD_CHANGE_FIELD_NAME, 0];
        yield 'requirePassword as 1' => [AppConfig::CT_REQUIRE_PWD_FOR_PWD_CHANGE_FIELD_NAME, 1];
        yield 'requirePassword missing' => [AppConfig::CT_REQUIRE_PWD_FOR_PWD_CHANGE_FIELD_NAME, null];
        yield 'allowCustom as "true"' => [AppConfig::CT_ALLOW_CUSTOM_PASSWORD_FIELD_NAME, 'true'];
        yield 'allowCustom missing' => [AppConfig::CT_ALLOW_CUSTOM_PASSWORD_FIELD_NAME, null];
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
            $settings->pwdLength();
            self::fail("Expected a ConfigurationException for $key.");
        } catch (ConfigurationException $e) {
            self::assertStringContainsString($key, $e->getMessage());
        }
    }

    public function testPasswordLengthAsAFloatIsAConfigurationError(): void
    {
        $settings = $this->settings('{"requirePasswordForPasswordChange": true, "allowCustomPassword": true, "passwordLength": 12.0}');

        $this->expectException(ConfigurationException::class);
        $settings->pwdLength();
    }

    // ---------------------------------------------------------------- SE-07, SE-08

    public function testNoSettingsValueIsAConfigurationError(): void
    {
        $settings = new ServiceSettings(new ExtensionDataService($this->fake, AppConfig::CT_EXTENSION_ID), new NullLogger());

        $this->expectException(ConfigurationException::class);
        $settings->pwdLength();
    }

    public function testSeveralSettingsValuesAreAConfigurationError(): void
    {
        $this->fake->seedValue($this->categories[AppConfig::CT_SETTINGS_CATEGORY_NAME], json_encode(self::validSettings(), JSON_THROW_ON_ERROR));
        $settings = $this->settings(self::validSettings());

        $this->expectException(ConfigurationException::class);
        $settings->pwdLength();
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
        $settings->pwdLength();
    }

    public function testMissingEncryptionSettingsAreAConfigurationError(): void
    {
        $settings = $this->settings(self::validSettings());

        $this->expectException(ConfigurationException::class);
        $settings->publicKey();
    }

    public function testEncryptionSettingsWithoutPublicKeyAreAConfigurationError(): void
    {
        $this->fake->seedValue($this->categories[AppConfig::CT_ENCRYPTION_SETTINGS_CATEGORY_NAME], '{"other": 1}');
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
        self::assertSame($pem, $this->withPublicKey($pem)->publicKey());
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
