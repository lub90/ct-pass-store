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

    public function verifyUserPassword(string $username, #[\SensitiveParameter] string $password): bool
    {
        try {
            $result = $this->client->verifyLogin($username, $password);
        } catch (ChurchToolsException $e) {
            $this->logger->error("ChurchTools password check error for user {$username}: " . $e->getMessage());

            return false;
        }

        if ($result === null) {
            $this->logger->info("ChurchTools password check failed for user {$username}");

            return false;
        }

        // Unchanged behavior: an accepted password counts as valid even if a second factor is still pending.
        // Whether that's intended is open question Q13 of the spec; the change belongs to plan item 3.5.
        return true;
    }
}
