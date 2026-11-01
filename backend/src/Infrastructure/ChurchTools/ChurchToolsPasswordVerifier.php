<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\ChurchTools;

use CtPassStore\Application\Port\PrimaryPasswordVerifier;
use CtPassStore\Domain\PersonId;
use CtPassStore\Infrastructure\ChurchTools\Exception\ChurchToolsException;
use Psr\Log\LoggerInterface;

/**
 * Checks a primary password with a ChurchTools login.
 */
final class ChurchToolsPasswordVerifier implements PrimaryPasswordVerifier
{
    public function __construct(
        private readonly ChurchToolsClient $client,
        private readonly LoggerInterface $logger,
    ) {}

    /**
     * @throws ChurchToolsException if ChurchTools can't be asked
     */
    public function verify(string $username, #[\SensitiveParameter] string $password, PersonId $person): bool
    {
        // ChurchTools errors propagate: they are never a wrong password (spec 5.5.3).
        $result = $this->client->verifyLogin($username, $password);

        if ($result === null) {
            $this->logger->info("ChurchTools password check failed for user {$username}");

            return false;
        }

        // The username may have been given to someone else since the login: only the token's own person counts
        // (spec 5.5.3).
        if ($result->personId !== $person->value) {
            $this->logger->warning("ChurchTools password check for user {$username} returned person {$result->personId} instead of {$person}; counted as wrong.");

            return false;
        }

        // A correct password counts even if a second factor is still pending (spec 5.5.3, decision Q13): this check
        // only confirms that the user knows their password.
        return true;
    }
}
