<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Auth;

use CtPassStore\Application\Exception\ConfigurationException;
use CtPassStore\Application\Failure\Reason;
use CtPassStore\Application\Port\Clock;
use CtPassStore\Application\Port\MachineClientUsage;
use CtPassStore\Infrastructure\Store\SignedFileStore;
use Psr\Log\LoggerInterface;

/**
 * A usage summary per machine client in the log, at most one line per client and hour (spec 6.4): the first request
 * after an hour since the last summary logs how many requests came from which addresses since then. No line per
 * request: ct-radius sends one for every RADIUS login.
 *
 * One record (`usage`) in the signed security store holds an entry per client, written under the record's lock, so
 * concurrent requests neither lose counts nor log twice. Bounded:
 * - only authenticated clients get an entry, and the access load drops the entries of clients that are no longer
 *   configured (prune());
 * - an entry keeps at most MAX_ADDRESSES + 1 addresses: the first MAX_ADDRESSES are logged, one more only tells
 *   "more than MAX_ADDRESSES";
 * - every write drops entries whose hour began RETENTION_SECONDS (14 days) ago or more, so no address is kept longer
 *   than the log keeps it (spec 6.4). A dropped entry's pending summary is logged first, so no hour is lost.
 *
 * Fail open: a folder that can't be used or a tampered record is a `warning`, never a refused request (the replay
 * cache, which the request needs anyway, fails closed on its own).
 */
final class FileMachineClientUsage implements MachineClientUsage
{
    public const RECORD = 'usage';

    public const WINDOW_SECONDS = 3600;

    /** Addresses listed per summary; one more is kept only to say "more than". */
    public const MAX_ADDRESSES = 10;

    /** The log's retention (14 files, one per day); usage entries are kept no longer. */
    public const RETENTION_SECONDS = 14 * 86400;

    public function __construct(
        private readonly SignedFileStore $store,
        private readonly Clock $clock,
        private readonly LoggerInterface $logger,
    ) {}

    public function record(string $clientId, string $address): void
    {
        $now = $this->clock->now()->getTimestamp();
        // Prefixed, so an ID like "0" never becomes an integer key (and the record a JSON list).
        $key = 'c:' . $clientId;
        $summary = null;
        $dropped = [];
        try {
            $this->store->update(self::RECORD, static function (array $all) use ($now, $key, $address, &$summary, &$dropped): array {
                [$all, $dropped] = self::splitExpired($all, $now);
                $state = $all[$key] ?? null;
                // A start "in the future" means the clock went back; that starts a new hour too.
                if (is_array($state) && $state['since'] <= $now && $now - $state['since'] < self::WINDOW_SECONDS) {
                    $addresses = $state['addresses'];
                    if (!in_array($address, $addresses, true) && count($addresses) <= self::MAX_ADDRESSES) {
                        $addresses[] = $address;
                    }
                    $all[$key] = ['since' => $state['since'], 'count' => $state['count'] + 1, 'addresses' => $addresses];

                    return $all;
                }

                $summary = is_array($state) ? $state : [];
                $all[$key] = ['since' => $now, 'count' => 1, 'addresses' => [$address]];

                return $all;
            });
        } catch (ConfigurationException $e) {
            $this->warn($e, "The usage of machine client $clientId can't be counted, because the cache folder can't be used.", ['ip' => $address]);

            return;
        }

        $this->logPending($dropped);
        if ($summary === null) {
            return;
        }
        if ($summary === []) {
            $this->logger->info("Machine client $clientId is in use; first request in the last 14 days.", ['ip' => $address]);

            return;
        }
        $this->logSummary($clientId, $summary, ['ip' => $address]);
    }

    /**
     * Drops the entries of clients not in the list, and old ones. Called when the access value is loaded. Never
     * creates the record, and fails open like record().
     *
     * @param list<string> $clientIds the configured (enabled) clients
     */
    public function prune(array $clientIds): void
    {
        $now = $this->clock->now()->getTimestamp();
        $keep = array_fill_keys(array_map(static fn(string $id): string => 'c:' . $id, $clientIds), true);
        $dropped = [];
        try {
            if (!$this->store->exists(self::RECORD)) {
                return;
            }
            $this->store->update(self::RECORD, static function (array $all) use ($now, $keep, &$dropped): array {
                [$valid, $dropped] = self::splitExpired($all, $now);
                $dropped += array_diff_key($valid, $keep);

                return array_intersect_key($valid, $keep);
            });
        } catch (ConfigurationException $e) {
            $this->warn($e, "The usage of machine clients can't be cleaned up, because the cache folder can't be used.");

            return;
        }
        $this->logPending($dropped);
    }

    /**
     * The summaries of entries that were dropped (expired, or of clients no longer configured), so their last hour
     * isn't lost. Logged only after the write that dropped them succeeded.
     *
     * @param array<string, array{since: int, count: int, addresses: list<string>}> $dropped
     */
    private function logPending(array $dropped): void
    {
        foreach ($dropped as $key => $state) {
            $this->logSummary(substr($key, 2), $state, []);
        }
    }

    /**
     * @param array{since: int, count: int, addresses: list<string>} $summary
     * @param array<string, string> $context
     */
    private function logSummary(string $clientId, array $summary, array $context): void
    {
        $more = count($summary['addresses']) > self::MAX_ADDRESSES;
        $addresses = array_slice($summary['addresses'], 0, self::MAX_ADDRESSES);
        $this->logger->info(sprintf(
            'Machine client %s is in use; %d %s from %s since the last summary at %s.',
            $clientId,
            $summary['count'],
            $summary['count'] === 1 ? 'request' : 'requests',
            $more ? 'more than ' . self::MAX_ADDRESSES . ' addresses' : (count($addresses) === 1 ? '1 address' : count($addresses) . ' addresses'),
            gmdate('Y-m-d\TH:i:sP', $summary['since']),
        ), $context + ['addresses' => $addresses]);
    }

    /**
     * Splits the record into the entries that began less than RETENTION_SECONDS ago (a start in the future counts as
     * such) and the expired ones. Entries of another shape are left out of both.
     *
     * @param array<array-key, mixed> $all
     * @return array{array<string, array{since: int, count: int, addresses: list<string>}>, array<string, array{since: int, count: int, addresses: list<string>}>}
     */
    private static function splitExpired(array $all, int $now): array
    {
        $kept = [];
        $expired = [];
        foreach ($all as $key => $state) {
            if (!is_string($key) || !str_starts_with($key, 'c:') || !is_array($state)) {
                continue;
            }
            $since = $state['since'] ?? null;
            $count = $state['count'] ?? null;
            $addresses = $state['addresses'] ?? null;
            if (!is_int($since) || !is_int($count) || !is_array($addresses)) {
                continue;
            }
            $entry = ['since' => $since, 'count' => $count, 'addresses' => array_values(array_filter($addresses, is_string(...)))];
            if ($now - $since >= self::RETENTION_SECONDS) {
                $expired[$key] = $entry;
            } else {
                $kept[$key] = $entry;
            }
        }

        return [$kept, $expired];
    }

    /**
     * @param array<string, string> $context
     */
    private function warn(ConfigurationException $e, string $unusable, array $context = []): void
    {
        $this->logger->warning(
            $e->reason() === Reason::StoreTampered
                ? 'The usage record of the machine clients failed its integrity check, so usage isn\'t counted. Check the server for unauthorized access, then empty the folder cache/.'
                : $unusable,
            $context,
        );
    }
}
