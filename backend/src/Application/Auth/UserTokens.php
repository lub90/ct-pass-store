<?php

declare(strict_types=1);

namespace CtPassStore\Application\Auth;

use CtPassStore\Application\Exception\InvalidTokenException;
use CtPassStore\Application\Exception\TokenExpiredException;
use CtPassStore\Application\IssuedToken;
use CtPassStore\Application\Port\Clock;
use CtPassStore\Application\Port\TokenCodec;
use CtPassStore\Domain\PersonId;
use CtPassStore\Domain\PersonPrincipal;

/**
 * The backend's own access tokens for users (spec 4.4, Q21): HS256 with `JWT_SECRET`, 15 minutes. The algorithm is
 * pinned; `iss` and `aud` are constants and never come from the request. All claims are required.
 */
final class UserTokens
{
    public const ALGORITHM = 'HS256';
    public const ISSUER = 'ctpassstore-backend';
    public const AUDIENCE = 'ctpassstore-api';
    public const LIFETIME_SECONDS = 900;

    public function __construct(
        #[\SensitiveParameter]
        private readonly string $secret,
        private readonly Clock $clock,
        private readonly TokenCodec $codec,
    ) {}

    public function issue(PersonPrincipal $person): IssuedToken
    {
        $now = $this->clock->now()->getTimestamp();
        $token = $this->codec->sign([
            'iss' => self::ISSUER,
            'aud' => self::AUDIENCE,
            'sub' => (string) $person->id->value,
            'username' => $person->username,
            'iat' => $now,
            'nbf' => $now,
            'exp' => $now + self::LIFETIME_SECONDS,
            'jti' => bin2hex(random_bytes(16)),
        ], self::ALGORITHM, $this->secret);

        return new IssuedToken($token, self::LIFETIME_SECONDS);
    }

    /**
     * Whether a token with this header is meant to be one of ours (HS256 without `kid`).
     */
    public static function claims(TokenHeader $header): bool
    {
        return $header->alg === self::ALGORITHM && $header->kid === null;
    }

    /**
     * @throws InvalidTokenException
     * @throws TokenExpiredException only for a token with a valid signature and valid claims
     */
    public function verify(#[\SensitiveParameter] string $token): PersonPrincipal
    {
        if (!self::claims($this->codec->header($token))) {
            throw TokenRules::invalid();
        }

        // Signature first, then claims, then expiry (spec 4.3.3).
        $verified = $this->codec->verify($token, self::ALGORITHM, [$this->secret], $this->clock->now()->getTimestamp(), TokenRules::LEEWAY_SECONDS);
        $claims = $verified->claims;

        $sub = $claims['sub'] ?? null;
        $personId = is_string($sub) ? PersonId::decimal($sub) : null;
        $username = $claims['username'] ?? null;
        $valid = ($claims['iss'] ?? null) === self::ISSUER
            && ($claims['aud'] ?? null) === self::AUDIENCE
            && $personId !== null && $personId > 0
            && is_string($username) && $username !== ''
            && is_string($claims['jti'] ?? null) && $claims['jti'] !== ''
            && is_int($claims['iat'] ?? null) && is_int($claims['nbf'] ?? null) && is_int($claims['exp'] ?? null);
        if (!$valid) {
            throw TokenRules::invalid();
        }
        if ($verified->expired) {
            throw new TokenExpiredException('The access token has expired. Log in again.');
        }

        return new PersonPrincipal(new PersonId($personId), $username);
    }
}
