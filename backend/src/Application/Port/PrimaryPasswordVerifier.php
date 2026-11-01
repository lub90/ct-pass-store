<?php

declare(strict_types=1);

namespace CtPassStore\Application\Port;

use CtPassStore\Domain\PersonId;

/**
 * Checks a person's primary ChurchTools password (spec 5.5).
 */
interface PrimaryPasswordVerifier
{
    /**
     * Whether the password is correct for `$username` **and** belongs to `$person`. Throws if that can't be
     * determined; an outage is never a wrong password.
     */
    public function verify(string $username, #[\SensitiveParameter] string $password, PersonId $person): bool;
}
