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
        /** The admin role signed into the token (spec 4.4), returned to the client as `admin`. */
        public readonly bool $admin,
    ) {}
}
