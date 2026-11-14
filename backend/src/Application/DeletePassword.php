<?php

declare(strict_types=1);

namespace CtPassStore\Application;

use CtPassStore\Application\Port\PasswordRepository;
use CtPassStore\Domain\PersonId;
use CtPassStore\Domain\Principal;
use Psr\Log\LoggerInterface;

/**
 * Removes a person's secondary password (spec 4.7).
 */
final class DeletePassword
{
    public function __construct(
        private readonly EntryGuard $guard,
        private readonly PasswordRepository $passwords,
        private readonly LoggerInterface $logger,
    ) {}

    public function execute(Principal $principal, PersonId $target, #[\SensitiveParameter] ?string $primaryPassword): void
    {
        $this->guard->authorizeChange($principal, $target, $primaryPassword);
        $this->passwords->delete($target);
        // Like SetPassword: who deleted whose password, by ID only (spec 6.4).
        $this->logger->info(ucfirst($principal->describe()) . " deleted the password of person {$target}.");
    }
}
