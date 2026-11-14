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
    ];

    /**
     * @param array<string, mixed>|null $raw null if the category or its value is missing
     */
    public static function parse(?array $raw): ParsedAccess
    {
        if ($raw === null) {
            return new ParsedAccess(null, [], ['The KV category access has no value; nobody is an admin and no machine client is enabled. Run the extension setup.']);
        }

        $findings = [];
        $groupId = self::adminGroupId($raw, $findings);
        [$clients, $problems] = self::machineClients($raw[KvSchema::ACCESS_MACHINE_CLIENTS] ?? []);

        return new ParsedAccess($groupId, $clients, [...$findings, ...$problems]);
    }

    /**
     * @param array<string, mixed> $raw
     * @param list<string> $findings
     */
    private static function adminGroupId(array $raw, array &$findings): ?int
    {
        $groups = $raw[KvSchema::ACCESS_GROUPS] ?? null;
        $admins = is_array($groups) ? ($groups[KvSchema::GROUP_ADMINS] ?? null) : null;
        $id = is_array($admins) ? ($admins[KvSchema::GROUP_ID] ?? null) : null;
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
     * @return array{array<string, MachineClient>, list<string>}
     */
    private static function machineClients(mixed $value): array
    {
        if (!is_array($value) || !array_is_list($value)) {
            return [[], ['The machineClients in access isn\'t a list; all machine clients are disabled.']];
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
            /** @var array{id: string, name: string, publicKeys: list<string>, permissions?: mixed} $entry */
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
                trim($entry['name']),
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
        $reasons = self::reasons($entry, $seen);
        if ($reasons === []) {
            return null;
        }

        return implode('; ', array_map(static fn(string $reason): string => self::REASON_TEXTS[$reason], $reasons));
    }

    /**
     * The reason codes why an entry is invalid (empty if it's valid). The codes are pinned by
     * `shared/access-client-cases.json`, which the extension's reader tests as well.
     *
     * @param array<string, true> $seen IDs of earlier entries
     * @return list<string>
     */
    public static function reasons(mixed $entry, array $seen = []): array
    {
        if (!is_array($entry) || array_is_list($entry)) {
            return ['not-an-object'];
        }
        $reasons = [];
        $id = $entry['id'] ?? null;
        if (!is_string($id) || preg_match(MachineClient::ID_PATTERN, $id) !== 1) {
            $reasons[] = 'invalid-id';
        } elseif (isset($seen[$id])) {
            $reasons[] = 'duplicate-id';
        }
        $name = $entry['name'] ?? null;
        if (!is_string($name) || trim($name) === '') {
            $reasons[] = 'missing-name';
        }
        if (!self::isDate($entry['createdAt'] ?? null)) {
            $reasons[] = 'invalid-created-at';
        }
        $keys = $entry['publicKeys'] ?? null;
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
        $permissions = $entry['permissions'] ?? [];
        if (!is_array($permissions) || !array_is_list($permissions)) {
            $reasons[] = 'invalid-permissions';
        }

        return $reasons;
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
     * The raw 32-byte key from base64 or base64url, or null.
     */
    private static function ed25519KeyOrNull(string $base64): ?string
    {
        $raw = base64_decode(strtr(trim($base64), '-_', '+/'), true);

        return is_string($raw) && strlen($raw) === SODIUM_CRYPTO_SIGN_PUBLICKEYBYTES ? $raw : null;
    }
}
