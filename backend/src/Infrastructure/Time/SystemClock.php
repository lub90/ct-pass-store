<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Time;

use CtPassStore\Application\Port\Clock;

final class SystemClock implements Clock
{
    public function now(): \DateTimeImmutable
    {
        return new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
    }
}
