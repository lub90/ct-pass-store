<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Auth;

use CtPassStore\Application\Exception\InvalidTokenException;
use Firebase\JWT\ExpiredException;
use Firebase\JWT\JWT as FirebaseJwt;
use Firebase\JWT\Key;

/**
 * The parts of JWT handling shared by user and machine tokens (spec 4.3.3), around firebase/php-jwt.
 *
 * - The header is read here first, so the caller can pick the kind of token and its key. Only `alg`, `typ` and `kid`
 *   are read; a token with `crit` is rejected, and keys embedded in the header are never used.
 * - The signature is always checked before any claim. An expired token is reported as expired only when its
 *   signature is valid.
 */
final class Jwt
{
    /** Clock skew allowed for `nbf`, `iat` and `exp` (spec 4.4). */
    public const LEEWAY_SECONDS = 30;

    /** Far more than any valid token; protects the decoder from huge inputs. */
    private const MAX_LENGTH = 8192;

    /**
     * @return array{alg: string, kid: string|null}
     *
     * @throws InvalidTokenException
     */
    public static function header(string $token): array
    {
        $parts = explode('.', $token);
        if (strlen($token) > self::MAX_LENGTH || count($parts) !== 3 || preg_match('/^[A-Za-z0-9_-]+\z/', $parts[0]) !== 1) {
            throw self::invalid();
        }
        $header = json_decode((string) base64_decode(strtr($parts[0], '-_', '+/'), true), true);
        if (!is_array($header) || array_is_list($header) || array_key_exists('crit', $header)) {
            throw self::invalid();
        }
        $alg = $header['alg'] ?? null;
        $kid = $header['kid'] ?? null;
        if (!is_string($alg) || ($kid !== null && !is_string($kid))) {
            throw self::invalid();
        }

        return ['alg' => $alg, 'kid' => $kid];
    }

    /**
     * Verifies the signature with one of the keys and returns the claims. `expired` is true if the signature is
     * valid but `exp` has passed (beyond the leeway); the caller checks its other claims before reporting that.
     *
     * @param non-empty-list<Key> $keys tried in order; all must use the algorithm expected by the caller
     * @return array{claims: array<string, mixed>, expired: bool}
     *
     * @throws InvalidTokenException
     */
    public static function verify(string $token, array $keys, \DateTimeImmutable $now): array
    {
        // firebase/php-jwt keeps its clock and leeway in static properties; they're set for this call only.
        $previous = [FirebaseJwt::$timestamp, FirebaseJwt::$leeway];
        FirebaseJwt::$timestamp = $now->getTimestamp();
        FirebaseJwt::$leeway = self::LEEWAY_SECONDS;
        try {
            foreach ($keys as $key) {
                try {
                    return ['claims' => self::toArray(FirebaseJwt::decode($token, $key)), 'expired' => false];
                } catch (ExpiredException $e) {
                    // Thrown only after the signature was verified.
                    return ['claims' => self::toArray($e->getPayload()), 'expired' => true];
                } catch (\UnexpectedValueException|\DomainException|\InvalidArgumentException|\JsonException) {
                    // What firebase/php-jwt throws for a wrong key, bad signature or malformed token (its
                    // SignatureInvalidException and BeforeValidException included), and JSON too deep to be a real
                    // token: try the next key. Anything else is a bug and reaches the error middleware as a 500.
                }
            }
        } finally {
            [FirebaseJwt::$timestamp, FirebaseJwt::$leeway] = $previous;
        }

        throw self::invalid();
    }

    public static function invalid(): InvalidTokenException
    {
        return new InvalidTokenException('The access token is invalid.');
    }

    /**
     * @return array<string, mixed>
     */
    private static function toArray(object $payload): array
    {
        $claims = json_decode(json_encode($payload, JSON_THROW_ON_ERROR), true, 32, JSON_THROW_ON_ERROR);
        if (!is_array($claims) || array_is_list($claims) && $claims !== []) {
            throw self::invalid();
        }

        return $claims;
    }
}
