<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Auth;

use CtPassStore\Application\Exception\ConfigurationException;
use CtPassStore\Application\Exception\InvalidTokenException;
use CtPassStore\Application\Exception\TokenExpiredException;
use CtPassStore\Domain\Principal;

/**
 * Turns a bearer token into a principal (spec 4.3.3): the token's header decides whether it's a backend token for a
 * person (HS256, no `kid`) or a machine client's token (EdDSA with `kid`). Nothing else is accepted, and no
 * ChurchTools call is made.
 */
final class BearerAuthenticator
{
    public function __construct(
        private readonly TokenService $userTokens,
        private readonly MachineTokenVerifier $machineTokens,
    ) {}

    /**
     * @throws InvalidTokenException
     * @throws TokenExpiredException
     * @throws ConfigurationException if machine authentication can't work (fail closed)
     */
    public function authenticate(#[\SensitiveParameter] string $token): Principal
    {
        $header = Jwt::header($token);

        return match (true) {
            TokenService::claimsHeader($header['alg'], $header['kid']) => $this->userTokens->verify($token),
            MachineTokenVerifier::claimsHeader($header['alg'], $header['kid']) => $this->machineTokens->verify($token),
            default => throw Jwt::invalid(),
        };
    }
}
