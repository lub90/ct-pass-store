<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Kv;

use CtPassStore\Application\Exception\ConfigurationException;
use CtPassStore\Domain\PasswordPolicy;
use CtPassStore\Domain\Settings;

/**
 * Turns the decoded settings value into Settings (spec 3.2). Pure: no I/O, no logging, so every rule is testable
 * on its own.
 *
 * - Invalid values that would weaken security are a ConfigurationException naming the setting, never a fallback.
 * - `backendUrl`, which only machine clients need, disables those clients when invalid and is reported as a finding:
 *   users keep working.
 * - The machine clients and the admin group are in the `access` category (AccessParser); fields the backend doesn't
 *   use (`schema`, `revision`, `oauthClientId`, `texts`, and a leftover `machineClients`) are ignored.
 */
final class SettingsParser
{
    /**
     * @param array<string, mixed> $raw
     *
     * @throws ConfigurationException naming the first invalid setting
     */
    public static function parse(array $raw): ParsedSettings
    {
        $findings = [];
        // Only machine clients need backendUrl (for aud). An invalid one disables them, as a missing one does
        // (spec 4.4a.3), instead of breaking every request that needs the settings.
        $backendUrl = self::backendUrl($raw);
        if ($backendUrl === false) {
            $backendUrl = null;
            $findings[] = 'The setting backendUrl must be an https:// URL without credentials, query or fragment; machine clients can\'t authenticate until it\'s fixed.';
        }

        return new ParsedSettings(new Settings(
            requirePrimaryPassword: self::boolean($raw, KvSchema::SETTING_REQUIRE_PRIMARY_PASSWORD),
            allowCustomPasswords: self::boolean($raw, KvSchema::SETTING_ALLOW_CUSTOM_PASSWORD),
            passwordLength: self::passwordLength($raw),
            backendUrl: $backendUrl,
        ), $findings);
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
     * The normalized backendUrl, null if it's missing, false if it's invalid.
     *
     * @param array<string, mixed> $raw
     */
    private static function backendUrl(array $raw): string|false|null
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
            return false;
        }

        return rtrim((string) $value, '/');
    }
}
