<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Auth;

use CtPassStore\Application\Auth\AddressLimit;
use CtPassStore\Application\Exception\TooManyAttemptsException;
use CtPassStore\Application\Port\AddressLimiter;
use CtPassStore\Application\Port\Clock;
use CtPassStore\Infrastructure\Store\SignedFileStore;

/**
 * The per-address limit of spec 6.3 (Q26) in fixed buckets (spec 6.1, "Bounded size").
 *
 * Addresses are hashed into BUCKETS buckets per limit, so the number of records is bounded no matter how many
 * addresses call. The hash is keyed from JWT_SECRET, so nobody can aim at a victim's bucket. A bucket keeps the
 * timestamps of the last 60 seconds (at most max() of them); it is blocked at max() entries, until the oldest has
 * passed the window. Blocked requests aren't counted.
 */
final class FileAddressLimiter implements AddressLimiter
{
    public const BUCKETS = 256;

    private readonly string $key;

    public function __construct(
        private readonly SignedFileStore $store,
        private readonly Clock $clock,
        #[\SensitiveParameter]
        string $jwtSecret,
    ) {
        $this->key = hash_hmac('sha256', 'ctpassstore address buckets v1', $jwtSecret);
    }

    public function hit(AddressLimit $limit, string $remoteAddr): void
    {
        $this->check($limit, $remoteAddr, true);
    }

    public function assertOpen(AddressLimit $limit, string $remoteAddr): void
    {
        $this->check($limit, $remoteAddr, false);
    }

    /**
     * The network an address counts as: IPv4 as is, IPv4-mapped IPv6 as IPv4, other IPv6 as its /64, else "unknown".
     */
    public static function network(string $remoteAddr): string
    {
        $bytes = $remoteAddr === '' ? false : @inet_pton($remoteAddr);
        if ($bytes === false) {
            return 'unknown';
        }
        if (strlen($bytes) === 4) {
            return (string) inet_ntop($bytes);
        }
        if (str_starts_with($bytes, str_repeat("\0", 10) . "\xff\xff")) {
            return (string) inet_ntop(substr($bytes, 12));
        }

        return bin2hex(substr($bytes, 0, 8)) . '/64';
    }

    private function check(AddressLimit $limit, string $remoteAddr, bool $count): void
    {
        $now = $this->clock->now()->getTimestamp();
        $max = $limit->max();
        $globalMax = $limit->globalMax();
        $globalName = 'addr:' . $limit->value . ':all';
        $store = $this->store;
        $blockedFor = 0;

        // The address bucket is locked first, then the global record (always in this order). A request is counted in
        // both or in neither.
        $store->update(
            $this->name($limit, $remoteAddr),
            static function (array $state) use ($now, $max, $count, $globalMax, $globalName, $store, &$blockedFor): array {
                $times = self::recent($state['hits'] ?? null, $now);
                $bucketFull = count($times) >= $max;
                if ($bucketFull) {
                    $blockedFor = self::retryAfter($times, $now);
                }
                if ($globalMax !== null) {
                    $store->update(
                        $globalName,
                        static function (array $global) use ($now, $globalMax, $count, $bucketFull, &$blockedFor): array {
                            $all = self::recent($global['hits'] ?? null, $now);
                            if (count($all) >= $globalMax) {
                                $blockedFor = max($blockedFor, self::retryAfter($all, $now));
                            } elseif ($count && !$bucketFull) {
                                $all[] = $now;
                            }

                            return ['hits' => $all];
                        },
                    );
                }
                if ($count && $blockedFor === 0) {
                    $times[] = $now;
                }

                return ['hits' => $times];
            },
        );

        if ($blockedFor > 0) {
            throw new TooManyAttemptsException("Too many requests from this address. Try again in {$blockedFor} seconds.", $blockedFor);
        }
    }

    /**
     * @param list<int> $times oldest first
     */
    private static function retryAfter(array $times, int $now): int
    {
        return max(1, $times[0] + AddressLimit::WINDOW_SECONDS - $now);
    }

    /**
     * The well-formed timestamps of the last 60 seconds, oldest first.
     *
     * @return list<int>
     */
    private static function recent(mixed $hits, int $now): array
    {
        $recent = [];
        foreach (is_array($hits) ? $hits : [] as $at) {
            if (is_int($at) && $at > $now - AddressLimit::WINDOW_SECONDS && $at <= $now) {
                $recent[] = $at;
            }
        }
        sort($recent);

        return $recent;
    }

    private function name(AddressLimit $limit, string $remoteAddr): string
    {
        $hash = hash_hmac('sha256', self::network($remoteAddr), $this->key);
        $bucket = (int) hexdec(substr($hash, 0, 8)) % self::BUCKETS;

        return 'addr:' . $limit->value . ':' . $bucket;
    }
}
