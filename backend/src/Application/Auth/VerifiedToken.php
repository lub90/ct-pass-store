<?php

declare(strict_types=1);

namespace CtPassStore\Application\Auth;

/**
 * A token whose signature is valid. `expired` is true if its `exp` has passed beyond the leeway; the caller checks its
 * other claims before reporting that, so an expired token never says more than an invalid one.
 */
final class VerifiedToken
{
    /**
     * @param array<string, mixed> $claims
     */
    public function __construct(
        public readonly array $claims,
        public readonly bool $expired,
    ) {}
}
