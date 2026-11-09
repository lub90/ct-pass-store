<?php

declare(strict_types=1);

namespace CtPassStore\Application\Auth;

use CtPassStore\Application\Exception\ConfigurationException;
use CtPassStore\Application\Exception\InvalidTokenException;
use CtPassStore\Application\Exception\TokenExpiredException;
use CtPassStore\Application\Port\TokenCodec;
use CtPassStore\Domain\Principal;

/**
 * Turns a bearer token into a principal (spec 4.3.3): the header decides whether it's a backend token for a person
 * (HS256, no `kid`) or a machine client's token (EdDSA with `kid`). Nothing else is accepted, and no ChurchTools call
 * is made.
 */
final class Authenticator
{
    public function __construct(
        private readonly TokenCodec $codec,
        private readonly UserTokens $userTokens,
        private readonly MachineTokens $machineTokens,
    ) {}

    /**
     * @throws InvalidTokenException
     * @throws TokenExpiredException
     * @throws ConfigurationException if machine authentication can't work (fail closed)
     */
    public function authenticate(#[\SensitiveParameter] string $token): Principal
    {
        $header = $this->codec->header($token);

        return match (true) {
            UserTokens::claims($header) => $this->userTokens->verify($token),
            MachineTokens::claims($header) => $this->machineTokens->verify($token),
            default => throw TokenRules::invalid(),
        };
    }
}
