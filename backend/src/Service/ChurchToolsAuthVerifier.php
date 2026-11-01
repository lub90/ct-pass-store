<?php

declare(strict_types=1);

namespace CtPassStore\Service;

use CtPassStore\ChurchTools\ChurchToolsClient;
use CtPassStore\ChurchTools\Exception\ChurchToolsException;
use Psr\Log\LoggerInterface;

/**
 * Checks a user's primary ChurchTools password.
 */
class ChurchToolsAuthVerifier extends BaseService
{
    public function __construct(
        private readonly ChurchToolsClient $client,
        LoggerInterface $logger,
    ) {
        parent::__construct($logger);
    }

    /**
     * @throws ChurchToolsException if ChurchTools can't be asked
     */
    public function verifyUserPassword(string $username, #[\SensitiveParameter] string $password): bool
    {
        // ChurchTools errors propagate: they are never a wrong password (spec 5.5.3).
        $result = $this->client->verifyLogin($username, $password);

        if ($result === null) {
            $this->logger->info("ChurchTools password check failed for user {$username}");

            return false;
        }

        // A correct password counts even if a second factor is still pending (spec 5.5.3, decision Q13): this check
        // only confirms that the user knows their password.
        return true;
    }
}
