<?php

declare(strict_types=1);

namespace CtPassStore\Application\Port;

use CtPassStore\Application\Exception\TooManyAttemptsException;
use CtPassStore\Domain\PersonId;

/**
 * Counts primary-password attempts per caller (spec 6.3).
 *
 * Every attempt is counted as a failure **before** ChurchTools is asked, in the same atomic step that checks the
 * block. So parallel requests can't all pass the check: at most the allowed number of attempts are in flight. The
 * attempt is then resolved: a correct password resets the counter, an attempt that couldn't be checked (ChurchTools
 * error) is withdrawn, and a wrong password simply stays counted.
 */
interface AttemptLimiter
{
    /**
     * Counts a new attempt and returns its ID.
     *
     * @throws TooManyAttemptsException if the person is blocked; that attempt isn't counted
     */
    public function begin(PersonId $person): string;

    /**
     * The password was correct: the counter starts over.
     */
    public function succeed(PersonId $person): void;

    /**
     * The attempt couldn't be checked (e.g. ChurchTools was unreachable): it no longer counts, and a block it caused
     * is lifted.
     */
    public function withdraw(PersonId $person, string $attemptId): void;
}
