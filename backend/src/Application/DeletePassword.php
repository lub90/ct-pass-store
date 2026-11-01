<?php

declare(strict_types=1);

namespace CtPassStore\Application;

use CtPassStore\Application\Port\PasswordRepository;
use CtPassStore\Domain\PersonId;
use CtPassStore\Domain\Principal;

/**
 * Removes a person's secondary password (spec 4.7).
 */
final class DeletePassword
{
    public function __construct(
        private readonly EntryGuard $guard,
        private readonly PasswordRepository $passwords,
    ) {}

    public function execute(Principal $principal, PersonId $target, #[\SensitiveParameter] ?string $primaryPassword): void
    {
        $this->guard->authorizeChange($principal, $target, $primaryPassword);
        $this->passwords->delete($target);
    }
}
