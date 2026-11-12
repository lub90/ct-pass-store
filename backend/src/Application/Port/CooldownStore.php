<?php

declare(strict_types=1);

namespace CtPassStore\Application\Port;

use CtPassStore\Application\Exception\ConfigurationException;

/**
 * Remembers when something last started, so it can start at most once per period (cleanup design 5.2).
 */
interface CooldownStore
{
    /**
     * Atomically: if the last start of `$name` is at least `$seconds` ago (or there is none), records "now" as its start
     * and returns null; otherwise records nothing and returns the seconds left (at least 1).
     *
     * @throws ConfigurationException if the store can't be used (fail closed: nothing starts)
     */
    public function startIfDue(string $name, int $seconds): ?int;
}
