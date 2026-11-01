<?php

declare(strict_types=1);

namespace CtPassStore\Auth;

/**
 * The ChurchTools person a request was authenticated as.
 */
final class AuthenticatedPerson
{
    public function __construct(
        public readonly int $id,
        public readonly string $username,
    ) {}
}
