<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Auth;

use CtPassStore\Application\Exception\ConfigurationException;
use CtPassStore\Application\Exception\InvalidTokenException;
use CtPassStore\Infrastructure\Store\SignedFileStore;

/**
 * Accepts each machine token only once (spec 4.4a.5): the pair (client, `jti`) is kept until the token can no longer
 * be valid. Only called for fully verified tokens, so unauthenticated requests can neither fill the cache nor block
 * another client's `jti`s.
 */
final class ReplayGuard
{
    public function __construct(private readonly SignedFileStore $store) {}

    /**
     * @throws InvalidTokenException if the token was seen before
     * @throws ConfigurationException if the cache can't be used (fail closed)
     */
    public function record(string $clientId, string $jti, int $exp, int $now): void
    {
        $replayed = false;
        // Prefixed, so a jti like "0" never becomes an integer key (and the record a JSON list).
        $key = 'j:' . $jti;
        $this->store->update('jti:' . $clientId, static function (array $seen) use ($key, $exp, $now, &$replayed): array {
            // Tokens are accepted up to the leeway after exp; keep their jti that long.
            $seen = array_filter($seen, static fn(mixed $until): bool => is_int($until) && $until >= $now);
            if (array_key_exists($key, $seen)) {
                $replayed = true;

                return $seen;
            }
            $seen[$key] = $exp + Jwt::LEEWAY_SECONDS;

            return $seen;
        });

        if ($replayed) {
            throw Jwt::invalid();
        }
    }
}
