<?php

declare(strict_types=1);

namespace CtPassStore\Application\Auth;

use CtPassStore\Application\Exception\ConfigurationException;
use CtPassStore\Application\Exception\InvalidTokenException;
use CtPassStore\Application\Exception\TokenExpiredException;
use CtPassStore\Application\Port\Clock;
use CtPassStore\Application\Port\ReplayCache;
use CtPassStore\Application\Port\SettingsRepository;
use CtPassStore\Application\Port\TokenCodec;
use CtPassStore\Domain\MachinePrincipal;

/**
 * Tokens that machine clients sign themselves with Ed25519 (spec 4.4a, D5).
 *
 * Order: registered client (`kid`) → signature with one of its keys → claims → `exp` → replay. The `jti` is recorded
 * only after everything else succeeded.
 */
final class MachineTokens
{
    public const ALGORITHM = 'EdDSA';
    public const MAX_LIFETIME_SECONDS = 300;

    public function __construct(
        private readonly SettingsRepository $settings,
        private readonly ReplayCache $replays,
        private readonly Clock $clock,
        private readonly TokenCodec $codec,
    ) {}

    /**
     * Whether a token with this header is meant to be a machine token (EdDSA with a `kid`).
     */
    public static function claims(TokenHeader $header): bool
    {
        return $header->alg === self::ALGORITHM && $header->kid !== null;
    }

    /**
     * @throws InvalidTokenException
     * @throws TokenExpiredException only for a token with a valid signature and valid claims
     * @throws ConfigurationException if `backendUrl` is missing or the replay cache can't be used (fail closed)
     */
    public function verify(#[\SensitiveParameter] string $token): MachinePrincipal
    {
        $header = $this->codec->header($token);
        if (!self::claims($header) || $header->kid === null) {
            throw TokenRules::invalid();
        }

        $settings = $this->settings->settings();
        // Without the backend's own URL, aud can't be checked: no machine client is accepted (spec 4.4a.3).
        if ($settings->backendUrl === null) {
            throw new ConfigurationException('The setting backendUrl is missing, so machine clients can\'t authenticate. Save the backend URL in the extension settings.');
        }

        // 1. A registered, enabled client. Disabled clients aren't in the list, so they're treated like unknown ones.
        $client = $settings->machineClients[$header->kid] ?? throw TokenRules::invalid();

        // 2. The signature, with one of the client's keys. Keys in the token header are never used.
        $now = $this->clock->now()->getTimestamp();
        $verified = $this->codec->verify($token, self::ALGORITHM, $client->publicKeys, $now, TokenRules::LEEWAY_SECONDS);
        $claims = $verified->claims;

        // 3. Claims. All are required.
        $iat = $claims['iat'] ?? null;
        $exp = $claims['exp'] ?? null;
        $jti = $claims['jti'] ?? null;
        $aud = $claims['aud'] ?? null;
        $valid = ($claims['iss'] ?? null) === $client->id
            && ($claims['sub'] ?? null) === $client->id
            && is_string($aud) && $aud !== '' && rtrim($aud, '/') === $settings->backendUrl
            && is_int($iat) && is_int($exp)
            && $exp > $iat && $exp - $iat <= self::MAX_LIFETIME_SECONDS
            && $iat <= $now + TokenRules::LEEWAY_SECONDS
            && is_string($jti) && strlen($jti) >= 16 && strlen($jti) <= 128;
        if (!$valid) {
            throw TokenRules::invalid();
        }

        // 4. Expiry, reported only now that signature and claims are known to be valid.
        if ($verified->expired) {
            throw new TokenExpiredException('The access token has expired. Sign a new one.');
        }

        // 5. Replay. Tokens are accepted up to the leeway after exp, so their jti is kept that long.
        if (!$this->replays->recordOnce($client->id, $jti, $exp + TokenRules::LEEWAY_SECONDS, $now)) {
            throw TokenRules::invalid();
        }

        return new MachinePrincipal($client->id, $client->permissions);
    }
}
