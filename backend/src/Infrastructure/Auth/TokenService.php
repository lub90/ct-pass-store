<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Auth;

use CtPassStore\Application\Exception\InvalidTokenException;
use CtPassStore\Application\Exception\TokenExpiredException;
use CtPassStore\Application\IssuedToken;
use CtPassStore\Application\Port\AccessTokenIssuer;
use CtPassStore\Application\Port\Clock;
use CtPassStore\Domain\PersonId;
use CtPassStore\Domain\PersonPrincipal;
use Firebase\JWT\JWT as FirebaseJwt;
use Firebase\JWT\Key;

/**
 * Issues and validates the backend's own access tokens for users (spec 4.4, Q21): HS256 with `JWT_SECRET`, 15
 * minutes. The algorithm is pinned; `iss` and `aud` are constants and never come from the request.
 */
final class TokenService implements AccessTokenIssuer
{
    public const ALGORITHM = 'HS256';
    public const ISSUER = 'ctpassstore-backend';
    public const AUDIENCE = 'ctpassstore-api';
    public const LIFETIME_SECONDS = 900;

    public function __construct(
        #[\SensitiveParameter]
        private readonly string $secret,
        private readonly Clock $clock,
    ) {}

    public function issue(PersonPrincipal $person): IssuedToken
    {
        $now = $this->clock->now()->getTimestamp();
        $token = FirebaseJwt::encode([
            'iss' => self::ISSUER,
            'aud' => self::AUDIENCE,
            'sub' => (string) $person->id->value,
            'username' => $person->username,
            'iat' => $now,
            'nbf' => $now,
            'exp' => $now + self::LIFETIME_SECONDS,
            'jti' => bin2hex(random_bytes(16)),
        ], $this->secret, self::ALGORITHM);

        return new IssuedToken($token, self::LIFETIME_SECONDS);
    }

    /**
     * Whether the token looks like one of ours (HS256 without `kid`), judged by its header alone.
     */
    public static function claimsHeader(string $alg, ?string $kid): bool
    {
        return $alg === self::ALGORITHM && $kid === null;
    }

    /**
     * @throws InvalidTokenException
     * @throws TokenExpiredException only for a token with a valid signature and valid claims
     */
    public function verify(#[\SensitiveParameter] string $token): PersonPrincipal
    {
        $header = Jwt::header($token);
        if (!self::claimsHeader($header['alg'], $header['kid'])) {
            throw Jwt::invalid();
        }

        $result = Jwt::verify($token, [new Key($this->secret, self::ALGORITHM)], $this->clock->now());
        $claims = $result['claims'];

        $sub = $claims['sub'] ?? null;
        $username = $claims['username'] ?? null;
        $valid = ($claims['iss'] ?? null) === self::ISSUER
            && ($claims['aud'] ?? null) === self::AUDIENCE
            && is_string($sub) && preg_match('/^[1-9][0-9]{0,17}\z/', $sub) === 1
            && is_string($username) && $username !== ''
            && is_string($claims['jti'] ?? null) && $claims['jti'] !== ''
            && is_int($claims['iat'] ?? null) && is_int($claims['nbf'] ?? null) && is_int($claims['exp'] ?? null);
        if (!$valid) {
            throw Jwt::invalid();
        }
        if ($result['expired']) {
            throw new TokenExpiredException('The access token has expired. Log in again.');
        }

        return new PersonPrincipal(new PersonId((int) $sub), $username);
    }
}
