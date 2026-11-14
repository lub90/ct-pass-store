<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Kv;

use CtPassStore\Application\Exception\ConfigurationException;
use CtPassStore\Domain\MachineClient;
use CtPassStore\Domain\Settings;
use CtPassStore\Infrastructure\Store\SignedFileStore;
use Psr\Log\LoggerInterface;

/**
 * Logs at `notice` when the set of enabled machine clients or the backend address differs from the last one seen
 * (spec 6.4). Both decide who may read every password, so a change must be visible in the log even if the admin
 * doesn't look at the extension.
 *
 * - "Last seen" is one record in the signed security store, so it outlives the settings cache and a `JWT_SECRET`
 *   rotation only makes the next load log the values as first seen. The compare and the update run under the record's
 *   exclusive lock, so of concurrent requests that load the same change only one logs it.
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
    ) {}

    public function observe(Settings $settings): void
    {
        $clients = self::describeClients($settings->machineClients);
        $backendUrl = $settings->backendUrl;
        $messages = [];
        try {
            $this->store->update(self::RECORD, static function (array $seen) use ($clients, $backendUrl, &$messages): array {
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

                if (!array_key_exists('backendUrl', $seen)) {
                    $messages[] = 'Backend address, first seen: ' . ($backendUrl ?? self::NONE) . '.';
                } elseif ($seen['backendUrl'] !== $backendUrl) {
                    $old = is_string($seen['backendUrl']) ? $seen['backendUrl'] : self::NONE;
                    $messages[] = "The backend address changed from $old to " . ($backendUrl ?? self::NONE) . '.';
                }

                return ['machineClients' => $clients, 'backendUrl' => $backendUrl];
            });
        } catch (ConfigurationException) {
            $this->logger->warning('Changes of the machine clients and the backend address can\'t be checked, because the cache folder can\'t be used.');

            return;
        }

        foreach ($messages as $message) {
            $this->logger->notice($message);
        }
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
