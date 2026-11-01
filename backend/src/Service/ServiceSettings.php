<?php

declare(strict_types=1);

namespace CtPassStore\Service;

use CtPassStore\Config\AppConfig;
use CtPassStore\Config\ConfigurationException;
use phpseclib3\Crypt\PublicKeyLoader;
use phpseclib3\Crypt\RSA;

/**
 * The extension's settings and public key from ChurchTools, validated when loaded (spec 3.2, 5.4).
 *
 * Invalid values are a ConfigurationException (`500 misconfigured`) naming the setting, never a silent fallback.
 */
class ServiceSettings extends ChurchToolsBaseService
{
    public const MIN_PASSWORD_LENGTH = 12;
    public const MAX_PASSWORD_LENGTH = 64;
    public const MIN_RSA_KEY_BITS = 4096;

    private const PASSWORD_LENGTH = 'passwordLength';
    private const ADMIN_USERS = 'adminUsers';
    private const READ_ACCESS_USERS = 'readAccessUsers';
    private const BACKEND_URL = 'backendUrl';

    /** @var array{requirePassword: bool, allowCustom: bool, passwordLength: int, adminUsers: list<int>, readAccessUsers: list<int>, backendUrl: string|null}|null */
    private ?array $settings = null;

    private ?string $publicKey = null;

    /**
     * @return array{requirePassword: bool, allowCustom: bool, passwordLength: int, adminUsers: list<int>, readAccessUsers: list<int>, backendUrl: string|null}
     */
    private function settings(): array
    {
        if ($this->settings !== null) {
            return $this->settings;
        }

        $raw = $this->singleValue(AppConfig::CT_SETTINGS_CATEGORY_NAME, 'The extension settings', 'Save the settings in the extension.');

        return $this->settings = [
            'requirePassword' => $this->boolean($raw, AppConfig::CT_REQUIRE_PWD_FOR_PWD_CHANGE_FIELD_NAME),
            'allowCustom' => $this->boolean($raw, AppConfig::CT_ALLOW_CUSTOM_PASSWORD_FIELD_NAME),
            'passwordLength' => $this->passwordLength($raw),
            'adminUsers' => $this->personIds($raw, self::ADMIN_USERS),
            'readAccessUsers' => $this->personIds($raw, self::READ_ACCESS_USERS),
            'backendUrl' => $this->parseBackendUrl($raw),
        ];
    }

    public function requirePasswordForPasswordChange(): bool
    {
        return $this->settings()['requirePassword'];
    }

    public function allowCustomPasswords(): bool
    {
        return $this->settings()['allowCustom'];
    }

    /**
     * @return list<int>
     */
    public function adminUsers(): array
    {
        return $this->settings()['adminUsers'];
    }

    /**
     * @return list<int>
     */
    public function readAccessUsers(): array
    {
        return $this->settings()['readAccessUsers'];
    }

    public function pwdLength(): int
    {
        return $this->settings()['passwordLength'];
    }

    /**
     * The backend URL without a trailing slash, or null if the setting is missing (needed for machine clients from
     * plan item 3.3 on).
     */
    public function backendUrl(): ?string
    {
        return $this->settings()['backendUrl'];
    }

    /**
     * The validated PEM-encoded RSA public key (at least 4096 bits).
     */
    public function publicKey(): string
    {
        if ($this->publicKey !== null) {
            return $this->publicKey;
        }

        $raw = $this->singleValue(AppConfig::CT_ENCRYPTION_SETTINGS_CATEGORY_NAME, 'The encryption settings', 'Run the encryption step of the extension setup.');
        $pem = $raw[AppConfig::CT_PUBLIC_KEY_FIELD_NAME] ?? null;
        if (!is_string($pem) || $pem === '') {
            throw new ConfigurationException('The encryption settings have no publicKey. Run the encryption step of the extension setup.');
        }

        return $this->publicKey = self::validatedRsaPublicKey($pem);
    }

    /**
     * Accepts only a PEM public key (not a certificate or a private key) of type RSA with at least 4096 bits.
     */
    public static function validatedRsaPublicKey(string $pem): string
    {
        // phpseclib would also extract the key from a certificate, so the PEM type is checked first.
        if (preg_match('/^\s*-----BEGIN (RSA )?PUBLIC KEY-----/', $pem) !== 1 || str_contains($pem, 'PRIVATE KEY') || str_contains($pem, 'CERTIFICATE')) {
            throw new ConfigurationException('The publicKey in the encryption settings must be a PEM public key (BEGIN PUBLIC KEY), not a certificate or a private key.');
        }

        try {
            $key = PublicKeyLoader::loadPublicKey($pem);
        } catch (\Throwable) {
            throw new ConfigurationException('The publicKey in the encryption settings can\'t be read.');
        }
        if (!$key instanceof RSA\PublicKey) {
            throw new ConfigurationException('The publicKey in the encryption settings must be an RSA key.');
        }
        if ($key->getLength() < self::MIN_RSA_KEY_BITS) {
            throw new ConfigurationException(sprintf('The publicKey in the encryption settings has %d bits; at least %d are required.', $key->getLength(), self::MIN_RSA_KEY_BITS));
        }

        return $pem;
    }

    /**
     * The decoded JSON object of the only value in a category.
     *
     * @return array<string, mixed>
     */
    private function singleValue(string $category, string $what, string $fix): array
    {
        $values = $this->extension->getCategoryData($category);
        if (count($values) !== 1) {
            throw new ConfigurationException(sprintf('%s must be exactly one value in the category %s, but there are %d. %s', $what, $category, count($values), $fix));
        }

        $value = $values[0]['value'] ?? null;
        $decoded = is_string($value) ? json_decode($value, true) : null;
        if (!is_array($decoded) || ($decoded !== [] && array_is_list($decoded))) {
            throw new ConfigurationException("$what aren't a valid JSON object. $fix");
        }

        return $decoded;
    }

    /**
     * @param array<string, mixed> $raw
     */
    private function boolean(array $raw, string $key): bool
    {
        if (!array_key_exists($key, $raw) || !is_bool($raw[$key])) {
            throw new ConfigurationException("The setting $key must be true or false. Save the settings in the extension.");
        }

        return $raw[$key];
    }

    /**
     * @param array<string, mixed> $raw
     */
    private function passwordLength(array $raw): int
    {
        $value = $raw[self::PASSWORD_LENGTH] ?? null;
        if (!is_int($value) || $value < self::MIN_PASSWORD_LENGTH || $value > self::MAX_PASSWORD_LENGTH) {
            throw new ConfigurationException(sprintf('The setting %s must be a whole number from %d to %d. Save the settings in the extension.', self::PASSWORD_LENGTH, self::MIN_PASSWORD_LENGTH, self::MAX_PASSWORD_LENGTH));
        }

        return $value;
    }

    /**
     * @param array<string, mixed> $raw
     * @return list<int>
     */
    private function personIds(array $raw, string $key): array
    {
        $value = $raw[$key] ?? [];
        if (!is_array($value) || !array_is_list($value)) {
            throw new ConfigurationException("The setting $key must be a list of person IDs. Save the settings in the extension.");
        }
        foreach ($value as $id) {
            if (!is_int($id) || $id < 1) {
                throw new ConfigurationException("The setting $key must contain only positive whole numbers (person IDs). Save the settings in the extension.");
            }
        }

        return $value;
    }

    /**
     * @param array<string, mixed> $raw
     */
    private function parseBackendUrl(array $raw): ?string
    {
        $value = $raw[self::BACKEND_URL] ?? null;
        if ($value === null) {
            return null;
        }
        $parts = is_string($value) ? parse_url($value) : false;
        if (
            $parts === false
            || ($parts['scheme'] ?? null) !== 'https'
            || ($parts['host'] ?? '') === ''
            || isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) || isset($parts['fragment'])
        ) {
            throw new ConfigurationException('The setting backendUrl must be an https:// URL without credentials, query or fragment. Save the settings in the extension.');
        }

        return rtrim((string) $value, '/');
    }
}
