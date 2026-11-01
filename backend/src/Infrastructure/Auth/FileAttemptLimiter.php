<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Auth;

use CtPassStore\Application\Port\AttemptLimiter;
use CtPassStore\Application\Port\Clock;
use CtPassStore\Domain\PersonId;
use CtPassStore\Infrastructure\Store\SignedFileStore;

/**
 * The primary-password limit of spec 6.3, kept in the signed security store:
 *
 * - The 5th wrong password within a sliding window of 15 minutes blocks the person until 15 minutes after that 5th
 *   failure.
 * - Attempts during a block aren't counted (the caller doesn't check them), so they don't extend it.
 * - A correct password resets the counter.
 */
final class FileAttemptLimiter implements AttemptLimiter
{
    public const MAX_FAILURES = 5;
    public const WINDOW_SECONDS = 900;
    public const BLOCK_SECONDS = 900;

    public function __construct(
        private readonly SignedFileStore $store,
        private readonly Clock $clock,
    ) {}

    public function blockedFor(PersonId $person): int
    {
        $now = $this->clock->now()->getTimestamp();
        $state = $this->store->update(self::name($person), static fn(array $state): array => $state);
        $until = $state['blockedUntil'] ?? null;

        return is_int($until) && $until > $now ? $until - $now : 0;
    }

    public function recordFailure(PersonId $person): void
    {
        $now = $this->clock->now()->getTimestamp();
        $this->store->update(self::name($person), static function (array $state) use ($now): array {
            $failures = array_values(array_filter(
                is_array($state['failures'] ?? null) ? $state['failures'] : [],
                static fn(mixed $at): bool => is_int($at) && $at > $now - self::WINDOW_SECONDS,
            ));
            $failures[] = $now;
            if (count($failures) >= self::MAX_FAILURES) {
                return ['failures' => [], 'blockedUntil' => $now + self::BLOCK_SECONDS];
            }

            return ['failures' => $failures];
        });
    }

    public function reset(PersonId $person): void
    {
        $this->store->update(self::name($person), static fn(array $state): array => []);
    }

    private static function name(PersonId $person): string
    {
        return 'attempts:' . $person->value;
    }
}
