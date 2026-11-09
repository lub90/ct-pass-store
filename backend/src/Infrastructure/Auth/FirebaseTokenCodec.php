<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Auth;

use CtPassStore\Application\Auth\TokenHeader;
use CtPassStore\Application\Auth\TokenRules;
use CtPassStore\Application\Auth\VerifiedToken;
use CtPassStore\Application\Port\TokenCodec;
use Firebase\JWT\ExpiredException;
use Firebase\JWT\JWT as FirebaseJwt;
use Firebase\JWT\Key;

/**
 * TokenCodec on top of firebase/php-jwt.
 *
 * - The header is read here first, so callers can pick the kind of token and its keys. Only `alg` and `kid` are read;
 *   a token with `crit` is rejected, and keys embedded in the header are never used.
 * - The algorithm is pinned per call: a key is only ever used with the algorithm the caller names.
 */
final class FirebaseTokenCodec implements TokenCodec
{
    /** Far more than any valid token; protects the decoder from huge inputs. */
    private const MAX_LENGTH = 8192;

    public function header(string $token): TokenHeader
    {
        $parts = explode('.', $token);
        if (strlen($token) > self::MAX_LENGTH || count($parts) !== 3 || preg_match('/^[A-Za-z0-9_-]+\z/', $parts[0]) !== 1) {
            throw TokenRules::invalid();
        }
        $header = json_decode((string) base64_decode(strtr($parts[0], '-_', '+/'), true), true);
        if (!is_array($header) || array_is_list($header) || array_key_exists('crit', $header)) {
            throw TokenRules::invalid();
        }
        $alg = $header['alg'] ?? null;
        $kid = $header['kid'] ?? null;
        if (!is_string($alg) || ($kid !== null && !is_string($kid))) {
            throw TokenRules::invalid();
        }

        return new TokenHeader($alg, $kid);
    }

    public function verify(string $token, string $algorithm, array $keys, int $now, int $leeway): VerifiedToken
    {
        // firebase/php-jwt keeps its clock and leeway in static properties; they're set for this call only.
        $previous = [FirebaseJwt::$timestamp, FirebaseJwt::$leeway];
        FirebaseJwt::$timestamp = $now;
        FirebaseJwt::$leeway = $leeway;
        try {
            foreach ($keys as $raw) {
                try {
                    return new VerifiedToken(self::toArray(FirebaseJwt::decode($token, self::key($raw, $algorithm))), false);
                } catch (ExpiredException $e) {
                    // Thrown only after the signature was verified.
                    return new VerifiedToken(self::toArray($e->getPayload()), true);
                } catch (\UnexpectedValueException|\DomainException|\InvalidArgumentException|\JsonException) {
                    // What firebase/php-jwt throws for a wrong key, bad signature or malformed token (its
                    // SignatureInvalidException and BeforeValidException included), and JSON too deep to be a real
                    // token: try the next key. Anything else is a bug and reaches the error middleware as a 500.
                }
            }
        } finally {
            [FirebaseJwt::$timestamp, FirebaseJwt::$leeway] = $previous;
        }

        throw TokenRules::invalid();
    }

    public function sign(array $claims, string $algorithm, #[\SensitiveParameter] string $key): string
    {
        return FirebaseJwt::encode($claims, $key, $algorithm);
    }

    /**
     * firebase/php-jwt expects EdDSA keys base64-encoded, HMAC secrets as they are.
     */
    private static function key(#[\SensitiveParameter] string $raw, string $algorithm): Key
    {
        return new Key($algorithm === 'EdDSA' ? base64_encode($raw) : $raw, $algorithm);
    }

    /**
     * @return array<string, mixed>
     */
    private static function toArray(object $payload): array
    {
        $claims = json_decode(json_encode($payload, JSON_THROW_ON_ERROR), true, 32, JSON_THROW_ON_ERROR);
        if (!is_array($claims) || array_is_list($claims) && $claims !== []) {
            throw TokenRules::invalid();
        }

        return $claims;
    }
}
