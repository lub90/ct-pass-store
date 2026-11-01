<?php

declare(strict_types=1);

namespace CtPassStore\Application\Port;

/**
 * Checks a person's primary ChurchTools password (spec 5.5).
 */
interface PrimaryPasswordVerifier
{
    /**
     * Whether the password is correct. Throws if that can't be determined; an outage is never a wrong password.
     */
    public function verify(string $username, #[\SensitiveParameter] string $password): bool;
}
