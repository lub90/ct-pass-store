<?php

declare(strict_types=1);

namespace CtPassStore\Application;

use CtPassStore\Application\Exception\EntryNotFoundException;
use CtPassStore\Application\Port\PasswordRepository;
use CtPassStore\Domain\PersonId;
use CtPassStore\Domain\Principal;

/**
 * Reads a person's encrypted secondary password (spec 4.5).
 */
final class GetPassword
{
    public function __construct(
        private readonly EntryGuard $guard,
        private readonly PasswordRepository $passwords,
    ) {}

    /**
     * @return string the ciphertext
     */
    public function execute(Principal $principal, PersonId $target): string
    {
        $this->guard->authorizeRead($principal, $target);

        return $this->passwords->find($target)
            ?? throw new EntryNotFoundException("Person {$target} has no secondary password.");
    }
}
