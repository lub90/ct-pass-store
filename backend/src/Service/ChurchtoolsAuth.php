<?php

declare(strict_types=1);

namespace CtPassStore\Service;

use CtPassStore\Auth\AuthenticatedPerson;
use CtPassStore\ChurchTools\ChurchToolsClient;
use CtPassStore\ChurchTools\Credential;
use CtPassStore\ChurchTools\Exception\ChurchToolsException;
use CtPassStore\ChurchTools\Exception\InvalidResponseException;
use CtPassStore\Config\AppConfig;
use Psr\Log\LoggerInterface;

/**
 * Validates a user's ChurchTools login token and checks their access to the extension.
 */
class ChurchtoolsAuth extends BaseService
{
    public function __construct(
        private readonly ChurchToolsClient $client,
        LoggerInterface $logger,
    ) {
        parent::__construct($logger);
    }

    /**
     * Returns the person the token belongs to.
     *
     * @throws ChurchToolsException if ChurchTools rejects the token or can't be asked
     * @throws \InvalidArgumentException if the token is empty or contains whitespace
     */
    public function validateToken(#[\SensitiveParameter] string $apiToken): AuthenticatedPerson
    {
        $person = $this->client->whoami(Credential::loginToken($apiToken));

        $id = $person['id'] ?? null;
        $username = $person['cmsUserId'] ?? '';
        if (!is_int($id) || !is_string($username)) {
            throw new InvalidResponseException('GET whoami: unexpected person data.');
        }

        return new AuthenticatedPerson($id, $username);
    }

    /**
     * Whether the token's owner has the extension's `view` permission.
     *
     * @throws ChurchToolsException if ChurchTools rejects the token or can't be asked
     */
    public function hasAccessRights(#[\SensitiveParameter] string $apiToken): bool
    {
        $permissions = $this->client->globalPermissions(Credential::loginToken($apiToken));

        $extension = $permissions[AppConfig::CT_EXTENSION_ID] ?? null;

        return is_array($extension) && ($extension['view'] ?? null) === true;
    }
}
