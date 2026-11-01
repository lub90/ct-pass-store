<?php

declare(strict_types=1);

namespace CtPassStore\Application;

/**
 * A backend access token as handed to the client.
 */
final class IssuedToken
{
    public function __construct(
        #[\SensitiveParameter]
        public readonly string $token,
        public readonly int $expiresIn,
    ) {}
}
