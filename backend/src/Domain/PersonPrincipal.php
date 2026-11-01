<?php

declare(strict_types=1);

namespace CtPassStore\Domain;

/**
 * A ChurchTools person, authenticated with their own token.
 */
final class PersonPrincipal implements Principal
{
    public function __construct(
        public readonly PersonId $id,
        public readonly string $username,
    ) {}

    public function describe(): string
    {
        return "user {$this->id}";
    }
}
