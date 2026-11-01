<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\ChurchTools;

use CtPassStore\Domain\PersonId;
use CtPassStore\Domain\PersonPrincipal;
use CtPassStore\Infrastructure\ChurchTools\Exception\ChurchToolsException;
use CtPassStore\Infrastructure\ChurchTools\Exception\InvalidResponseException;
use CtPassStore\Infrastructure\Kv\KvSchema;

/**
 * Identifies the owner of a ChurchTools login token and checks their access to the extension. Replaced by the
 * backend's own tokens in plan item 3.4.
 */
final class ChurchToolsAuthenticator
{
    public function __construct(private readonly ChurchToolsClient $client) {}

    /**
     * The person the token belongs to, or null if their ID isn't a valid person ID.
     *
     * @throws ChurchToolsException if ChurchTools rejects the token or can't be asked
     * @throws \InvalidArgumentException if the token is empty or contains whitespace
     */
    public function authenticate(#[\SensitiveParameter] string $loginToken): ?PersonPrincipal
    {
        $person = $this->client->whoami(Credential::loginToken($loginToken));

        $id = $person['id'] ?? null;
        $username = $person['cmsUserId'] ?? '';
        if (!is_int($id) || !is_string($username)) {
            throw new InvalidResponseException('GET whoami: unexpected person data.');
        }

        return $id >= 1 ? new PersonPrincipal(new PersonId($id), $username) : null;
    }

    /**
     * Whether the token's owner has the extension's `view` permission.
     *
     * @throws ChurchToolsException if ChurchTools rejects the token or can't be asked
     */
    public function hasServiceAccess(#[\SensitiveParameter] string $loginToken): bool
    {
        $permissions = $this->client->globalPermissions(Credential::loginToken($loginToken));

        $extension = $permissions[KvSchema::EXTENSION_KEY] ?? null;

        return is_array($extension) && ($extension['view'] ?? null) === true;
    }
}
