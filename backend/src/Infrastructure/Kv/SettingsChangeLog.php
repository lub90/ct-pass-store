<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Kv;

use CtPassStore\Application\Exception\ConfigurationException;
use CtPassStore\Application\Failure\Reason;
use CtPassStore\Domain\MachineClient;
use CtPassStore\Domain\Settings;
use CtPassStore\Infrastructure\Auth\FileMachineClientUsage;
use CtPassStore\Infrastructure\Store\SignedFileStore;
use Psr\Log\LoggerInterface;

/**
 * Logs at `notice` when the set of enabled machine clients, the admin group or the backend address differs from the
 * last one seen (spec 6.4). They decide who may read every password, so a change must be visible in the log even if
 * the admin doesn't look at the extension. Called when settings or access were loaded from ChurchTools, which is also
 * when the usage entries of clients that are no longer configured are dropped.
 *
 * - "Last seen" is one record in the signed security store, so it outlives the settings cache and a `JWT_SECRET`
 *   rotation only makes the next load log the values as first seen. The compare and the update run under the record's
 *   exclusive lock, so of concurrent requests that load the same change only one logs it. Requests that loaded
 *   different values (one just before a change in ChurchTools, one just after) can still take the lock in the other
 *   order: the change is then logged, logged back and logged again, never left out.
 * - A client is described by its ID, its permissions and the fingerprints of its keys (never a key, never its name);
 *   the order of clients, keys and permissions is no change.
 * - Fail open: if the folder can't be used, a `warning` says so and the request goes on. The security store that the
 *   requests themselves need fails closed on its own.
 */
final class SettingsChangeLog
{
    private const RECORD = 'audit:settings';

    private const NONE = 'none';

    public function __construct(
        private readonly SignedFileStore $store,
        private readonly LoggerInterface $logger,
        private readonly ?FileMachineClientUsage $usage = null,
    ) {}

    public function observe(Settings $settings): void
    {
        $clients = self::describeClients($settings->machineClients);
        $backendUrl = $settings->backendUrl;
        $adminGroupId = $settings->adminGroupId;
        $messages = [];
        try {
            $this->store->update(self::RECORD, static function (array $seen) use ($clients, $backendUrl, $adminGroupId, &$messages): array {
                $before = $seen['machineClients'] ?? null;
                if (!is_array($before) || !array_is_list($before)) {
                    $messages[] = 'Enabled machine clients, first seen: ' . self::listOrNone($clients) . '.';
                } elseif ($before !== $clients) {
                    $before = array_values(array_filter($before, is_string(...)));
                    $added = array_values(array_diff($clients, $before));
                    $removed = array_values(array_diff($before, $clients));
                    $messages[] = 'The enabled machine clients changed.'
                        . ($added !== [] ? ' Added: ' . implode(', ', $added) . '.' : '')
                        . ($removed !== [] ? ' Removed: ' . implode(', ', $removed) . '.' : '')
                        . ' Now enabled: ' . self::listOrNone($clients) . '.';
                }

                if (!array_key_exists('adminGroupId', $seen)) {
                    $messages[] = 'Admin group, first seen: ' . ($adminGroupId ?? self::NONE) . '.';
                } elseif ($seen['adminGroupId'] !== $adminGroupId) {
                    $old = is_int($seen['adminGroupId']) ? $seen['adminGroupId'] : self::NONE;
                    $messages[] = "The admin group changed from $old to " . ($adminGroupId ?? self::NONE) . '.';
                }

                if (!array_key_exists('backendUrl', $seen)) {
                    $messages[] = 'Backend address, first seen: ' . ($backendUrl ?? self::NONE) . '.';
                } elseif ($seen['backendUrl'] !== $backendUrl) {
                    $old = is_string($seen['backendUrl']) ? $seen['backendUrl'] : self::NONE;
                    $messages[] = "The backend address changed from $old to " . ($backendUrl ?? self::NONE) . '.';
                }

                return ['machineClients' => $clients, 'adminGroupId' => $adminGroupId, 'backendUrl' => $backendUrl];
            });
        } catch (ConfigurationException $e) {
            // Nothing logged as changed that wasn't stored: the next load would log it again.
            $this->logger->warning($e->reason() === Reason::StoreTampered
                ? 'The record of the last seen machine clients, admin group and backend address failed its integrity check, so their changes aren\'t logged. Check the server for unauthorized access, then empty the folder cache/.'
                : 'Changes of the machine clients, the admin group and the backend address can\'t be checked, because the cache folder can\'t be used.');
            $messages = [];
        }

        foreach ($messages as $message) {
            $this->logger->notice($message);
        }
        $this->usage?->prune(array_values(array_map(static fn(MachineClient $client): string => $client->id, $settings->machineClients)));
    }

    /**
     * @param array<string, MachineClient> $clients
     * @return list<string> one sorted description per client
     */
    private static function describeClients(array $clients): array
    {
        $described = [];
        foreach ($clients as $client) {
            $permissions = $client->permissions;
            sort($permissions, SORT_STRING);
            $prints = array_map(MachineClient::keyFingerprint(...), $client->publicKeys);
            sort($prints, SORT_STRING);
            $described[] = sprintf(
                '%s (permissions: %s; keys: %s)',
                $client->id,
                $permissions === [] ? self::NONE : implode(', ', $permissions),
                implode(', ', $prints),
            );
        }
        sort($described, SORT_STRING);

        return $described;
    }

    /**
     * @param list<string> $clients
     */
    private static function listOrNone(array $clients): string
    {
        return $clients === [] ? self::NONE : implode(', ', $clients);
    }
}
