<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Auth;

use CtPassStore\Application\Exception\ConfigurationException;
use CtPassStore\Application\Port\Clock;
use CtPassStore\Application\Port\MachineClientUsage;
use CtPassStore\Infrastructure\Store\SignedFileStore;
use Psr\Log\LoggerInterface;

/**
 * A usage summary per machine client in the log, at most one line per client and hour (spec 6.4): the first request
 * after an hour since the last summary logs how many requests came from which addresses since then. No line per
 * request: ct-radius sends one for every RADIUS login.
 *
 * One record per client in the signed security store (`usage:<id>`), written under its lock, so concurrent requests
 * neither lose counts nor log twice. Only authenticated clients get a record, so their number is bounded by the
 * registered clients, and a record keeps at most MAX_ADDRESSES addresses. Fail open: a folder that can't be used is a
 * `warning`, never a refused request (the replay cache, which the request needs anyway, fails closed on its own).
 */
final class FileMachineClientUsage implements MachineClientUsage
{
    public const WINDOW_SECONDS = 3600;

    /** Addresses kept per summary; more are only counted as "more than". */
    public const MAX_ADDRESSES = 10;

    public function __construct(
        private readonly SignedFileStore $store,
        private readonly Clock $clock,
        private readonly LoggerInterface $logger,
    ) {}

    public function record(string $clientId, string $address): void
    {
        $now = $this->clock->now()->getTimestamp();
        $summary = null;
        try {
            $this->store->update('usage:' . $clientId, static function (array $state) use ($now, $address, &$summary): array {
                $since = $state['since'] ?? null;
                $count = $state['count'] ?? null;
                $addresses = $state['addresses'] ?? null;
                $valid = is_int($since) && is_int($count) && is_array($addresses) && array_is_list($addresses);
                // A start "in the future" means the clock went back; that starts a new hour too.
                if ($valid && $since <= $now && $now - $since < self::WINDOW_SECONDS) {
                    if (!in_array($address, $addresses, true) && count($addresses) <= self::MAX_ADDRESSES) {
                        $addresses[] = $address;
                    }

                    return ['since' => $since, 'count' => $count + 1, 'addresses' => $addresses];
                }

                $summary = $valid ? ['since' => $since, 'count' => $count, 'addresses' => $addresses] : [];

                return ['since' => $now, 'count' => 1, 'addresses' => [$address]];
            });
        } catch (ConfigurationException) {
            $this->logger->warning("The usage of machine client $clientId can't be counted, because the cache folder can't be used.", ['ip' => $address]);

            return;
        }

        if ($summary === null) {
            return;
        }
        if ($summary === []) {
            $this->logger->info("Machine client $clientId is in use; first request seen.", ['ip' => $address]);

            return;
        }

        /** @var list<string> $addresses */
        $addresses = array_values(array_filter($summary['addresses'], is_string(...)));
        $more = count($addresses) > self::MAX_ADDRESSES;
        $addresses = array_slice($addresses, 0, self::MAX_ADDRESSES);
        $this->logger->info(sprintf(
            'Machine client %s is in use; %d %s from %s since the last summary at %s.',
            $clientId,
            $summary['count'],
            $summary['count'] === 1 ? 'request' : 'requests',
            $more ? 'more than ' . self::MAX_ADDRESSES . ' addresses' : (count($addresses) === 1 ? '1 address' : count($addresses) . ' addresses'),
            gmdate('Y-m-d\TH:i:sP', $summary['since']),
        ), ['ip' => $address, 'addresses' => $addresses]);
    }
}
