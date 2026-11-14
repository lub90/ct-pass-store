<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Kv;

use CtPassStore\Domain\MachineClient;

/**
 * Turns the decoded `access` value into the admin group and the machine clients (spec 3.2). Pure: no I/O, no
 * logging.
 *
 * Nothing here throws: an invalid or missing value means no admins and no machine clients (fail closed), and is
 * reported as a finding. Users can always log in. Everything except `groups.admins.groupId` and `machineClients` is
 * ignored.
 */
final class AccessParser
{
    private const REASON_TEXTS = [
        'not-an-object' => 'the entry isn\'t an object',
        'invalid-id' => 'the id must be 3 to 40 characters a–z, 0–9 or -',
        'duplicate-id' => 'its id is used twice',
        'missing-name' => 'name must be a non-empty string',
        'invalid-created-at' => 'createdAt must be a date like 2026-11-01',
        'no-keys' => 'publicKeys must be a non-empty list',
        'invalid-key' => 'publicKeys contains a value that isn\'t a base64-encoded Ed25519 public key',
        'invalid-permissions' => 'permissions must be a list',
        'shared-key' => 'it shares a public key with another client; give every client its own key pair',
    ];

    /**
     * Parses the JSON text of the `access` value. Objects and lists stay apart (`{"0": …}` is not a list), so what
     * the backend enables is what the extension's reader accepts.
     */
    public static function parseJson(?string $json): ParsedAccess
    {
        $decoded = $json === null ? null : json_decode($json, false);

        return self::parse($decoded instanceof \stdClass ? $decoded : null);
    }

    /**
     * @param \stdClass|array<string, mixed>|null $raw null if the category or its value is missing. A \stdClass is a JSON
     *     object and an array is a list; a non-empty array with string keys is accepted as an object (tests).
     */
    public static function parse(\stdClass|array|null $raw): ParsedAccess
    {
        if ($raw === null) {
            return new ParsedAccess(null, [], ['The KV category access has no value; nobody is an admin and no machine client is enabled. Run the extension setup.']);
        }

        $findings = [];
        $groupId = self::adminGroupId($raw, $findings);
        [$clients, $problems, $entryReasons] = self::machineClients(self::field($raw, KvSchema::ACCESS_MACHINE_CLIENTS) ?? []);

        return new ParsedAccess($groupId, $clients, [...$findings, ...$problems], $entryReasons);
    }

    /**
     * @param \stdClass|array<string, mixed> $raw
     * @param list<string> $findings
     */
    private static function adminGroupId(\stdClass|array $raw, array &$findings): ?int
    {
        $groups = self::field($raw, KvSchema::ACCESS_GROUPS);
        $admins = self::isObject($groups) ? self::field($groups, KvSchema::GROUP_ADMINS) : null;
        $id = self::isObject($admins) ? self::field($admins, KvSchema::GROUP_ID) : null;
        if (is_int($id) && $id > 0) {
            return $id;
        }
        $findings[] = 'The value of access has no valid groups.admins.groupId (a whole number above 0); nobody is an admin. Run the extension setup.';

        return null;
    }

    /**
     * The valid machine clients, and a description of every problem (spec 3.2). An invalid entry disables only that
     * client; a broken list disables all of them. Users are never affected, and nothing invalid ever grants access.
     *
     * @return array{array<string, MachineClient>, list<string>, list<list<string>>} the clients, the findings and the
     *     reason codes of every entry (see reasons())
     */
    private static function machineClients(mixed $value): array
    {
        if (!is_array($value) || !array_is_list($value)) {
            return [[], ['The machineClients in access isn\'t a list; all machine clients are disabled.'], []];
        }

        $clients = [];
        $problems = [];
        $seen = [];
        $entryReasons = [];
        $enabledAt = [];
        $indexesById = [];
        foreach ($value as $index => $entry) {
            $id = self::isObject($entry) ? self::field($entry, 'id') : null;
            $label = is_string($id) && preg_match(MachineClient::ID_PATTERN, $id) === 1 ? $id : "#$index";
            $reasons = self::reasons($entry, $seen);
            if (in_array('duplicate-id', $reasons, true)) {
                // Every earlier entry with this id is disabled too, so it carries the code as well.
                foreach ($indexesById[$id] as $earlier) {
                    $entryReasons[$earlier] = self::inOrder([...$entryReasons[$earlier], 'duplicate-id']);
                }
            }
            if (is_string($id) && !in_array('invalid-id', $reasons, true)) {
                $indexesById[$id][] = $index;
            }
            $entryReasons[$index] = $reasons;
            if (is_string($id)) {
                $seen[$id] = true;
            }
            if ($reasons !== []) {
                $problems[] = "Machine client $label is disabled: " . self::reasonTexts($reasons) . '.';
                // A duplicate disables the earlier entry as well: which of the two is meant can't be decided.
                if (isset($clients[$label])) {
                    unset($clients[$label]);
                    $problems[] = "Machine client $label (the earlier entry) is disabled too: its id is used twice.";
                }

                continue;
            }
            /** @var \stdClass|array<string, mixed> $entry */
            $permissions = [];
            $given = self::field($entry, 'permissions');
            foreach (is_array($given) ? $given : [] as $permission) {
                if ($permission === MachineClient::PERMISSION_READ_ENTRIES) {
                    $permissions[] = $permission;
                } else {
                    $problems[] = sprintf('Machine client %s: the permission %s is unknown and grants nothing.', $label, is_string($permission) && preg_match('/^[a-z:*_-]{1,40}\z/', $permission) === 1 ? $permission : '(invalid)');
                }
            }
            /** @var string $clientId */
            $clientId = self::field($entry, 'id');
            /** @var string $name */
            $name = self::field($entry, 'name');
            /** @var list<string> $keys */
            $keys = self::field($entry, 'publicKeys');
            $clients[$clientId] = new MachineClient(
                $clientId,
                trim($name),
                array_map(self::ed25519Key(...), $keys),
                array_values(array_unique($permissions)),
            );
            $enabledAt[$clientId] = $index;
        }

        [$clients, $problems, $shared] = self::withoutSharedKeys($clients, $problems);
        foreach ($shared as $id) {
            $entryReasons[$enabledAt[$id]][] = 'shared-key';
        }

        return [$clients, $problems, array_values($entryReasons)];
    }

    /**
     * Disables every client that shares a public key with another one. A token's `kid`, `iss` and `sub` are chosen
     * by whoever holds the private key, so a shared key would let one client act as the other.
     *
     * @param array<string, MachineClient> $clients
     * @param list<string> $problems
     * @return array{array<string, MachineClient>, list<string>, list<string>} the clients left, the problems and the
     *     IDs disabled for a shared key
     */
    private static function withoutSharedKeys(array $clients, array $problems): array
    {
        $owners = [];
        foreach ($clients as $client) {
            foreach (array_unique($client->publicKeys) as $key) {
                $owners[$key][] = $client->id;
            }
        }
        $shared = [];
        foreach ($owners as $ids) {
            if (count($ids) < 2) {
                continue;
            }
            foreach ($ids as $id) {
                if (isset($clients[$id])) {
                    unset($clients[$id]);
                    $shared[] = $id;
                    $problems[] = sprintf('Machine client %s is disabled: it shares a public key with %s. Give every client its own key pair.', $id, implode(', ', array_diff($ids, [$id])));
                }
            }
        }

        return [$clients, $problems, $shared];
    }

    /**
     * @param list<string> $reasons
     * @return list<string> without repeats, in the order of REASON_TEXTS
     */
    private static function inOrder(array $reasons): array
    {
        return array_values(array_intersect(array_keys(self::REASON_TEXTS), $reasons));
    }

    /**
     * @param list<string> $reasons
     */
    private static function reasonTexts(array $reasons): string
    {
        return implode('; ', array_map(static fn(string $reason): string => self::REASON_TEXTS[$reason], $reasons));
    }

    /**
     * The reason codes why an entry is invalid (empty if it's valid), in this order. The codes are pinned by
     * `shared/access-client-cases.json`, which the extension's reader tests as well. `shared-key` is added by
     * parse() afterwards, because it depends on the other entries.
     *
     * @param array<string, true> $seen IDs of earlier entries
     * @return list<string>
     */
    private static function reasons(mixed $entry, array $seen): array
    {
        if (!self::isObject($entry)) {
            return ['not-an-object'];
        }
        $reasons = [];
        $id = self::field($entry, 'id');
        if (!is_string($id) || preg_match(MachineClient::ID_PATTERN, $id) !== 1) {
            $reasons[] = 'invalid-id';
        } elseif (isset($seen[$id])) {
            $reasons[] = 'duplicate-id';
        }
        $name = self::field($entry, 'name');
        if (!is_string($name) || trim($name) === '') {
            $reasons[] = 'missing-name';
        }
        if (!self::isDate(self::field($entry, 'createdAt'))) {
            $reasons[] = 'invalid-created-at';
        }
        $keys = self::field($entry, 'publicKeys');
        if (!is_array($keys) || !array_is_list($keys) || $keys === []) {
            $reasons[] = 'no-keys';
        } else {
            foreach ($keys as $key) {
                if (!is_string($key) || self::ed25519KeyOrNull($key) === null) {
                    $reasons[] = 'invalid-key';
                    break;
                }
            }
        }
        $permissions = self::field($entry, 'permissions');
        if ($permissions !== null && (!is_array($permissions) || !array_is_list($permissions))) {
            $reasons[] = 'invalid-permissions';
        }

        return $reasons;
    }

    /**
     * A JSON object: a \stdClass, or (only when built in PHP) a non-empty array with string keys.
     */
    private static function isObject(mixed $value): bool
    {
        return $value instanceof \stdClass || (is_array($value) && $value !== [] && !array_is_list($value));
    }

    /** @param \stdClass|array<string, mixed> $object */
    private static function field(\stdClass|array $object, string $name): mixed
    {
        if ($object instanceof \stdClass) {
            return property_exists($object, $name) ? $object->{$name} : null;
        }

        return $object[$name] ?? null;
    }

    private static function isDate(mixed $value): bool
    {
        return is_string($value)
            && preg_match('/^(\d{4})-(\d{2})-(\d{2})\z/', $value, $m) === 1
            && checkdate((int) $m[2], (int) $m[3], (int) $m[1]);
    }

    private static function ed25519Key(string $base64): string
    {
        return self::ed25519KeyOrNull($base64) ?? throw new \LogicException('Checked before.');
    }

    /**
     * The raw 32-byte key, or null. Only canonical forms are accepted after trimming: standard base64 with padding
     * (43 characters and "="), or base64url with or without padding (what Node.js exports as a JWK's `x`). Mixed
     * alphabets, inner whitespace and non-zero trailing bits are rejected, so the extension's reader decodes exactly
     * the same keys.
     */
    private static function ed25519KeyOrNull(string $text): ?string
    {
        $text = trim($text);
        if (preg_match('/^[A-Za-z0-9+\/]{43}=\z/', $text) !== 1 && preg_match('/^[A-Za-z0-9_-]{43}=?\z/', $text) !== 1) {
            return null;
        }
        $raw = base64_decode(strtr($text, '-_', '+/'), true);
        if (!is_string($raw) || strlen($raw) !== SODIUM_CRYPTO_SIGN_PUBLICKEYBYTES) {
            return null;
        }

        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=') === rtrim(strtr($text, '+/', '-_'), '=') ? $raw : null;
    }
}
