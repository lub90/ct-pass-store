<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Kv;

use CtPassStore\Application\Port\SettingsRepository;
use CtPassStore\Config\ConfigurationException;
use CtPassStore\Domain\PasswordPolicy;
use CtPassStore\Domain\Settings;
use CtPassStore\Infrastructure\Crypto\RsaPublicKey;

/**
 * The extension's settings and public key from the KV store, validated when loaded and then kept for the request
 * (spec 3.2, 5.4).
 *
 * Invalid values are a ConfigurationException (`500 misconfigured`) naming the setting, never a silent fallback.
 */
final class KvSettingsRepository implements SettingsRepository
{
    private ?Settings $settings = null;

    private ?RsaPublicKey $publicKey = null;

    public function __construct(private readonly ExtensionData $extension) {}

    public function settings(): Settings
    {
        if ($this->settings !== null) {
            return $this->settings;
        }

        $raw = $this->singleValue(KvSchema::SETTINGS_CATEGORY, 'The extension settings', 'Save the settings in the extension.');

        return $this->settings = new Settings(
            requirePrimaryPassword: self::boolean($raw, KvSchema::SETTING_REQUIRE_PRIMARY_PASSWORD),
            allowCustomPasswords: self::boolean($raw, KvSchema::SETTING_ALLOW_CUSTOM_PASSWORD),
            passwordLength: self::passwordLength($raw),
            adminUsers: self::personIds($raw, KvSchema::SETTING_ADMIN_USERS),
            readAccessUsers: self::personIds($raw, KvSchema::SETTING_READ_ACCESS_USERS),
            backendUrl: self::backendUrl($raw),
        );
    }

    /**
     * @throws ConfigurationException if the key is missing or not an RSA public key of at least 4096 bits
     */
    public function publicKey(): RsaPublicKey
    {
        if ($this->publicKey !== null) {
            return $this->publicKey;
        }

        $raw = $this->singleValue(KvSchema::ENCRYPTION_CATEGORY, 'The encryption settings', 'Run the encryption step of the extension setup.');
        $pem = $raw[KvSchema::PUBLIC_KEY] ?? null;
        if (!is_string($pem) || $pem === '') {
            throw new ConfigurationException('The encryption settings have no publicKey. Run the encryption step of the extension setup.');
        }

        return $this->publicKey = RsaPublicKey::fromPem($pem);
    }

    /**
     * The decoded JSON object of the only value in a category.
     *
     * @return array<string, mixed>
     */
    private function singleValue(string $category, string $what, string $fix): array
    {
        $values = $this->extension->values($category);
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
    private static function boolean(array $raw, string $key): bool
    {
        if (!array_key_exists($key, $raw) || !is_bool($raw[$key])) {
            throw new ConfigurationException("The setting $key must be true or false. Save the settings in the extension.");
        }

        return $raw[$key];
    }

    /**
     * @param array<string, mixed> $raw
     */
    private static function passwordLength(array $raw): int
    {
        $key = KvSchema::SETTING_PASSWORD_LENGTH;
        $value = $raw[$key] ?? null;
        if (!is_int($value) || $value < PasswordPolicy::MIN_CONFIGURABLE_LENGTH || $value > PasswordPolicy::MAX_CONFIGURABLE_LENGTH) {
            throw new ConfigurationException(sprintf('The setting %s must be a whole number from %d to %d. Save the settings in the extension.', $key, PasswordPolicy::MIN_CONFIGURABLE_LENGTH, PasswordPolicy::MAX_CONFIGURABLE_LENGTH));
        }

        return $value;
    }

    /**
     * @param array<string, mixed> $raw
     * @return list<int>
     */
    private static function personIds(array $raw, string $key): array
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
    private static function backendUrl(array $raw): ?string
    {
        $value = $raw[KvSchema::SETTING_BACKEND_URL] ?? null;
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
