<?php

declare(strict_types=1);

namespace CtPassStore\Application\Auth;

/**
 * The only header parameters the backend reads (spec 4.3.3). Everything else, embedded keys included, is ignored.
 */
final class TokenHeader
{
    public function __construct(
        public readonly string $alg,
        public readonly ?string $kid,
    ) {}
}
