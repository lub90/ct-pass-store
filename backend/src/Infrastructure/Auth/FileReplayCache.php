<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Auth;

use CtPassStore\Application\Port\ReplayCache;
use CtPassStore\Infrastructure\Store\SignedFileStore;

/**
 * The `jti` replay cache in the signed security store, one record per client. Expired pairs are removed on every
 * write, so the record stays bounded by the client's request rate.
 */
final class FileReplayCache implements ReplayCache
{
    public function __construct(private readonly SignedFileStore $store) {}

    public function recordOnce(string $clientId, string $jti, int $keepUntil, int $now): bool
    {
        $first = true;
        // Prefixed, so a jti like "0" never becomes an integer key (and the record a JSON list).
        $key = 'j:' . $jti;
        $this->store->update('jti:' . $clientId, static function (array $seen) use ($key, $keepUntil, $now, &$first): array {
            $seen = array_filter($seen, static fn(mixed $until): bool => is_int($until) && $until >= $now);
            if (array_key_exists($key, $seen)) {
                $first = false;

                return $seen;
            }
            $seen[$key] = $keepUntil;

            return $seen;
        });

        return $first;
    }
}
