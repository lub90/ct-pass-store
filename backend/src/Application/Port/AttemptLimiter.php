<?php

declare(strict_types=1);

namespace CtPassStore\Application\Port;

use CtPassStore\Domain\PersonId;

/**
 * Counts wrong primary passwords per caller (spec 6.3).
 */
interface AttemptLimiter
{
    /**
     * Seconds until the person may try again, or 0 if they aren't blocked.
     */
    public function blockedFor(PersonId $person): int;

    public function recordFailure(PersonId $person): void;

    public function reset(PersonId $person): void;
}
