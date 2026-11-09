<?php

declare(strict_types=1);

namespace CtPassStore\Application\Port;

use CtPassStore\Application\Auth\TokenHeader;
use CtPassStore\Application\Auth\VerifiedToken;
use CtPassStore\Application\Exception\InvalidTokenException;

/**
 * The cryptographic part of JWTs: reading the header, signing, checking a signature. All rules about claims,
 * lifetimes and the order of checks are the callers' (Application\Auth).
 */
interface TokenCodec
{
    /**
     * @throws InvalidTokenException if the token isn't a JWT, or its header is unusable or has `crit`
     */
    public function header(string $token): TokenHeader;

    /**
     * Checks the signature with one of the keys, for exactly this algorithm, and returns the claims. `nbf` and `iat`
     * in the future (beyond the leeway) make the token invalid; a passed `exp` is reported in the result.
     *
     * @param non-empty-list<string> $keys raw keys: the secret for HS256, 32-byte public keys for EdDSA
     *
     * @throws InvalidTokenException
     */
    public function verify(string $token, string $algorithm, array $keys, int $now, int $leeway): VerifiedToken;

    /**
     * @param array<string, mixed> $claims
     */
    public function sign(array $claims, string $algorithm, #[\SensitiveParameter] string $key): string;
}
