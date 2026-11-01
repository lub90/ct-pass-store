<?php

declare(strict_types=1);

namespace CtPassStore\Application\Port;

use CtPassStore\Application\Exception\NoServiceAccessException;
use CtPassStore\Application\Exception\OAuthCodeInvalidException;
use CtPassStore\Domain\PersonPrincipal;

/**
 * Turns an OAuth authorization code into a verified person (spec 4.4.2–4.4.5).
 */
interface IdentityProvider
{
    /**
     * @throws OAuthCodeInvalidException if the code isn't accepted
     * @throws NoServiceAccessException if the person may not use the extension
     */
    public function authenticate(
        #[\SensitiveParameter]
        string $code,
        #[\SensitiveParameter]
        string $codeVerifier,
        string $redirectUri,
    ): PersonPrincipal;
}
