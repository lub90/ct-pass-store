<?php

declare(strict_types=1);

namespace CtPassStore\Application\Port;

use CtPassStore\Application\Exception\NoServiceAccessException;
use CtPassStore\Application\Exception\OAuthCodeInvalidException;
use CtPassStore\Domain\PersonPrincipal;

/**
 * Turns an OAuth authorization code into a verified person (spec 4.4.2–4.4.5), including the admin role.
 */
interface IdentityProvider
{
    /**
     * @param int|null $adminGroupId the admin group from `access` (spec 3.2); null means nobody is an admin and the
     *                               groups aren't asked for
     * @return PersonPrincipal with `admin` true only for an active member of exactly that group (spec 4.4 step 4)
     * @throws OAuthCodeInvalidException if the code isn't accepted
     * @throws NoServiceAccessException if the person may not use the extension
     */
    public function authenticate(
        #[\SensitiveParameter]
        string $code,
        #[\SensitiveParameter]
        string $codeVerifier,
        string $redirectUri,
        ?int $adminGroupId,
    ): PersonPrincipal;
}
