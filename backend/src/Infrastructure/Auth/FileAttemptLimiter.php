<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Auth;

use CtPassStore\Application\Exception\TooManyAttemptsException;
use CtPassStore\Application\Port\AttemptLimiter;
use CtPassStore\Application\Port\Clock;
use CtPassStore\Domain\PersonId;
use CtPassStore\Infrastructure\Store\SignedFileStore;

/**
 * The primary-password limit of spec 6.3, kept in the signed security store:
 *
 * - The 5th attempt within a sliding window of 15 minutes blocks the person until 15 minutes after it, unless it
 *   turns out correct (reset) or can't be checked (withdrawn). Attempts count from their start (see AttemptLimiter),
 *   so parallel requests can't run more than 5 checks against ChurchTools.
 * - Attempts during a block aren't counted, so they don't extend it.
 * - After a block, counting starts over.
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

    public function begin(PersonId $person): string
    {
        $now = $this->clock->now()->getTimestamp();
        $id = bin2hex(random_bytes(8));
        $blockedFor = 0;

        $this->store->update(self::name($person), static function (array $state) use ($now, $id, &$blockedFor): array {
            $until = $state['blockedUntil'] ?? null;
            if (is_int($until) && $until > $now) {
                $blockedFor = $until - $now;

                return $state;
            }
            // No block, or an expired one: counting starts over after a block.
            $attempts = is_int($until) ? [] : self::recent($state['attempts'] ?? null, $now);
            $attempts[] = ['id' => $id, 'at' => $now];
            if (count($attempts) >= self::MAX_FAILURES) {
                return ['attempts' => $attempts, 'blockedUntil' => $now + self::BLOCK_SECONDS, 'blockedBy' => $id];
            }

            return ['attempts' => $attempts];
        });

        if ($blockedFor > 0) {
            throw new TooManyAttemptsException("Too many wrong passwords. Try again in {$blockedFor} seconds.", $blockedFor);
        }

        return $id;
    }

    public function succeed(PersonId $person): void
    {
        $this->store->update(self::name($person), static fn(array $state): array => []);
    }

    public function withdraw(PersonId $person, string $attemptId): void
    {
        $now = $this->clock->now()->getTimestamp();
        $this->store->update(self::name($person), static function (array $state) use ($attemptId, $now): array {
            $attempts = array_values(array_filter(
                self::recent($state['attempts'] ?? null, $now),
                static fn(array $attempt): bool => $attempt['id'] !== $attemptId,
            ));
            // A block stays only if another attempt caused it.
            if (($state['blockedBy'] ?? null) !== $attemptId && is_int($state['blockedUntil'] ?? null)) {
                return ['attempts' => $attempts, 'blockedUntil' => $state['blockedUntil'], 'blockedBy' => $state['blockedBy'] ?? null];
            }

            return ['attempts' => $attempts];
        });
    }

    /**
     * The well-formed attempts of the last 15 minutes.
     *
     * @return list<array{id: string, at: int}>
     */
    private static function recent(mixed $attempts, int $now): array
    {
        $recent = [];
        foreach (is_array($attempts) ? $attempts : [] as $attempt) {
            if (is_array($attempt) && is_string($attempt['id'] ?? null) && is_int($attempt['at'] ?? null) && $attempt['at'] > $now - self::WINDOW_SECONDS) {
                $recent[] = ['id' => $attempt['id'], 'at' => $attempt['at']];
            }
        }

        return $recent;
    }

    private static function name(PersonId $person): string
    {
        return 'attempts:' . $person->value;
    }
}
