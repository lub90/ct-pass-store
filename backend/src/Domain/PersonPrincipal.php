<?php

declare(strict_types=1);

namespace CtPassStore\Domain;

/**
 * A ChurchTools person, authenticated with their own token.
 *
 * `admin` is the role decided at login from the membership in the admin group and carried in the backend token's
 * signed claim `admin` (spec 4.3, 4.4, D9). It's never taken from the request or the settings.
 */
final class PersonPrincipal implements Principal
{
    public function __construct(
        public readonly PersonId $id,
        public readonly string $username,
        public readonly bool $admin = false,
    ) {}

    public function describe(): string
    {
        return "user {$this->id}";
    }
}
