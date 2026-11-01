<?php

declare(strict_types=1);

namespace CtPassStore\Application\Port;

/**
 * The current time. Injected everywhere time matters (tokens, rate limits), so tests can control it.
 */
interface Clock
{
    public function now(): \DateTimeImmutable;
}
