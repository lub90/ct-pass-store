<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Support;

use CtPassStore\Application\Port\Clock;

/**
 * A clock that only moves when the test says so.
 */
final class FrozenClock implements Clock
{
    private \DateTimeImmutable $now;

    public function __construct(string $now = '2026-11-01T12:00:00Z')
    {
        $this->now = new \DateTimeImmutable($now);
    }

    public function now(): \DateTimeImmutable
    {
        return $this->now;
    }

    public function advance(int $seconds): void
    {
        $this->now = $this->now->modify(sprintf('%+d seconds', $seconds));
    }

    public function timestamp(): int
    {
        return $this->now->getTimestamp();
    }
}
