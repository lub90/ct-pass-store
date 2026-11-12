<?php

declare(strict_types=1);

namespace CtPassStore\Application;

use CtPassStore\Application\Exception\EntryNotFoundException;
use CtPassStore\Application\Exception\PersonNotFoundException;
use CtPassStore\Application\Port\PasswordRepository;
use CtPassStore\Application\Port\PersonDirectory;
use CtPassStore\Domain\PersonId;
use CtPassStore\Domain\PersonPrincipal;
use CtPassStore\Domain\Principal;
use Psr\Log\LoggerInterface;

/**
 * Reads a person's encrypted secondary password (spec 4.5). Deleted and archived persons have none (cleanup design 3.6).
 */
final class GetPassword
{
    public function __construct(
        private readonly EntryGuard $guard,
        private readonly PasswordRepository $passwords,
        private readonly PersonDirectory $persons,
        private readonly LoggerInterface $logger,
    ) {}

    /**
     * @return string the ciphertext
     */
    public function execute(Principal $principal, PersonId $target): string
    {
        $this->guard->authorizeRead($principal, $target);
        if (!($principal instanceof PersonPrincipal && $principal->id->value === $target->value) && !$this->persons->exists($target)) {
            $this->logger->info(ucfirst($principal->describe()) . " asked for person {$target}, who doesn't exist or is archived.");
            throw new PersonNotFoundException("Person {$target} doesn't exist in ChurchTools or is archived.");
        }

        return $this->passwords->find($target)
            ?? throw new EntryNotFoundException("Person {$target} has no secondary password.");
    }
}
