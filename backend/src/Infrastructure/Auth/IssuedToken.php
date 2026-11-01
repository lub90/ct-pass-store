<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Auth;

final class IssuedToken
{
    public function __construct(
        #[\SensitiveParameter]
        public readonly string $token,
        public readonly int $expiresIn,
    ) {}
}
