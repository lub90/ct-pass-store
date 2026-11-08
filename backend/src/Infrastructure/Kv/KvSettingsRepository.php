<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Kv;

use CtPassStore\Application\Port\SettingsRepository;
use CtPassStore\Config\ConfigurationException;
use CtPassStore\Domain\MachineClient;
use CtPassStore\Domain\PasswordPolicy;
use CtPassStore\Domain\Settings;
use CtPassStore\Infrastructure\Crypto\RsaPublicKey;
use Psr\Log\LoggerInterface;

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

    public function __construct(
        private readonly ExtensionData $extension,
        private readonly LoggerInterface $logger,
    ) {}

    public function settings(): Settings
    {
        if ($this->settings !== null) {
            return $this->settings;
        }

        $raw = $this->singleValue(KvSchema::SETTINGS_CATEGORY, 'The extension settings', 'Save the settings in the extension.');

        [$clients, $problems] = self::machineClients($raw[KvSchema::SETTING_MACHINE_CLIENTS] ?? []);
        // Only machine clients need backendUrl (for aud). An invalid one disables them, as a missing one does
        // (spec 4.4a.3), instead of breaking every request that needs the settings.
        $backendUrl = self::backendUrl($raw);
        if ($backendUrl === false) {
            $backendUrl = null;
            $problems[] = 'The setting backendUrl must be an https:// URL without credentials, query or fragment; machine clients can\'t authenticate until it\'s fixed.';
        }
        // A disabled client only sees 401 invalid-token, like an unknown one; the log tells the admin why.
        foreach ($problems as $problem) {
            $this->logger->warning($problem);
        }

        return $this->settings = new Settings(
            requirePrimaryPassword: self::boolean($raw, KvSchema::SETTING_REQUIRE_PRIMARY_PASSWORD),
            allowCustomPasswords: self::boolean($raw, KvSchema::SETTING_ALLOW_CUSTOM_PASSWORD),
            passwordLength: self::passwordLength($raw),
            adminUsers: self::personIds($raw, KvSchema::SETTING_ADMIN_USERS),
            backendUrl: $backendUrl,
            machineClients: $clients,
            problems: $problems,
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
     * The valid machine clients, and a description of every problem (spec 3.2). An invalid entry disables only that
     * client; a broken list disables all of them. Users are never affected, and nothing invalid ever grants access.
     *
     * @return array{array<string, MachineClient>, list<string>}
     */
    private static function machineClients(mixed $value): array
    {
        if (!is_array($value) || !array_is_list($value)) {
            return [[], ['The setting machineClients isn\'t a list; all machine clients are disabled.']];
        }

        $clients = [];
        $problems = [];
        $seen = [];
        foreach ($value as $index => $entry) {
            $id = is_array($entry) ? ($entry['id'] ?? null) : null;
            $label = is_string($id) && preg_match(MachineClient::ID_PATTERN, $id) === 1 ? $id : "#$index";
            $problem = self::machineClientProblem($entry, $seen);
            if (is_string($id)) {
                $seen[$id] = true;
            }
            if ($problem !== null) {
                $problems[] = "Machine client $label is disabled: $problem.";
                // A duplicate disables the earlier entry as well: which of the two is meant can't be decided.
                if (isset($clients[$label])) {
                    unset($clients[$label]);
                    $problems[] = "Machine client $label (the earlier entry) is disabled too: its id is used twice.";
                }

                continue;
            }
            /** @var array{id: string, name?: mixed, publicKeys: list<string>, permissions?: mixed} $entry */
            $permissions = [];
            foreach (is_array($entry['permissions'] ?? null) ? $entry['permissions'] : [] as $permission) {
                if ($permission === MachineClient::PERMISSION_READ_ENTRIES) {
                    $permissions[] = $permission;
                } else {
                    $problems[] = sprintf('Machine client %s: the permission %s is unknown and grants nothing.', $label, is_string($permission) && preg_match('/^[a-z:*_-]{1,40}\z/', $permission) === 1 ? $permission : '(invalid)');
                }
            }
            $clients[$entry['id']] = new MachineClient(
                $entry['id'],
                is_string($entry['name'] ?? null) ? $entry['name'] : $entry['id'],
                array_map(self::ed25519Key(...), $entry['publicKeys']),
                array_values(array_unique($permissions)),
            );
        }

        return self::withoutSharedKeys($clients, $problems);
    }

    /**
     * Disables every client that shares a public key with another one. A token's `kid`, `iss` and `sub` are chosen
     * by whoever holds the private key, so a shared key would let one client act as the other.
     *
     * @param array<string, MachineClient> $clients
     * @param list<string> $problems
     * @return array{array<string, MachineClient>, list<string>}
     */
    private static function withoutSharedKeys(array $clients, array $problems): array
    {
        $owners = [];
        foreach ($clients as $client) {
            foreach (array_unique($client->publicKeys) as $key) {
                $owners[$key][] = $client->id;
            }
        }
        foreach ($owners as $ids) {
            if (count($ids) < 2) {
                continue;
            }
            foreach ($ids as $id) {
                if (isset($clients[$id])) {
                    unset($clients[$id]);
                    $problems[] = sprintf('Machine client %s is disabled: it shares a public key with %s. Give every client its own key pair.', $id, implode(', ', array_diff($ids, [$id])));
                }
            }
        }

        return [$clients, $problems];
    }

    /**
     * @param array<string, true> $seen IDs of earlier entries
     */
    private static function machineClientProblem(mixed $entry, array $seen): ?string
    {
        if (!is_array($entry) || array_is_list($entry)) {
            return 'the entry isn\'t an object';
        }
        $id = $entry['id'] ?? null;
        if (!is_string($id) || preg_match(MachineClient::ID_PATTERN, $id) !== 1) {
            return 'the id must be 3 to 40 characters a–z, 0–9 or -';
        }
        if (isset($seen[$id])) {
            return 'its id is used twice';
        }
        $keys = $entry['publicKeys'] ?? null;
        if (!is_array($keys) || !array_is_list($keys) || $keys === []) {
            return 'publicKeys must be a non-empty list';
        }
        foreach ($keys as $key) {
            if (!is_string($key) || self::ed25519KeyOrNull($key) === null) {
                return 'publicKeys contains a value that isn\'t a base64-encoded Ed25519 public key';
            }
        }
        $permissions = $entry['permissions'] ?? [];
        if (!is_array($permissions) || !array_is_list($permissions)) {
            return 'permissions must be a list';
        }

        return null;
    }

    private static function ed25519Key(string $base64): string
    {
        return self::ed25519KeyOrNull($base64) ?? throw new \LogicException('Checked before.');
    }

    /**
     * The raw 32-byte key from base64 or base64url, or null.
     */
    private static function ed25519KeyOrNull(string $base64): ?string
    {
        $raw = base64_decode(strtr(trim($base64), '-_', '+/'), true);

        return is_string($raw) && strlen($raw) === SODIUM_CRYPTO_SIGN_PUBLICKEYBYTES ? $raw : null;
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
