<?php

declare(strict_types=1);

namespace CtPassStore\Domain;

/**
 * A machine client, authenticated with a token it signed itself (spec 4.4a). Never compared with persons: a client
 * with the ID `123` isn't person 123 (spec 4.3).
 */
final class MachinePrincipal implements Principal
{
    /**
     * @param list<string> $permissions from the client's current settings entry
     */
    public function __construct(
        public readonly string $clientId,
        public readonly array $permissions,
    ) {}

    public function may(string $permission): bool
    {
        return in_array($permission, $this->permissions, true);
    }

    public function describe(): string
    {
        return "machine client {$this->clientId}";
    }
}
