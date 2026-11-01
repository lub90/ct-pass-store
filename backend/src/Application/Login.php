<?php

declare(strict_types=1);

namespace CtPassStore\Application;

use CtPassStore\Application\Exception\InvalidRedirectUriException;
use CtPassStore\Application\Port\AccessTokenIssuer;
use CtPassStore\Application\Port\IdentityProvider;
use Psr\Log\LoggerInterface;

/**
 * `POST /v1/auth/token`: exchanges an OAuth authorization code for a backend access token (spec 4.4).
 */
final class Login
{
    /**
     * @param string $instanceOrigin the ChurchTools instance as `https://host[:port]`; the redirect URI must point there
     */
    public function __construct(
        private readonly string $instanceOrigin,
        private readonly IdentityProvider $identities,
        private readonly AccessTokenIssuer $tokens,
        private readonly LoggerInterface $logger,
    ) {}

    public function execute(
        #[\SensitiveParameter]
        string $code,
        #[\SensitiveParameter]
        string $codeVerifier,
        string $redirectUri,
    ): IssuedToken {
        // Checked before ChurchTools is called, so the backend can't be used to send codes elsewhere (spec 4.4.1).
        if (self::origin($redirectUri) !== $this->instanceOrigin) {
            throw new InvalidRedirectUriException('redirectUri must be a page of the ChurchTools instance this backend belongs to.');
        }

        $person = $this->identities->authenticate($code, $codeVerifier, $redirectUri);
        $this->logger->info(ucfirst($person->describe()) . ' logged in.');

        return $this->tokens->issue($person);
    }

    /**
     * The normalized origin (`https://host[:port]`, lowercase host, default port omitted) of an absolute https URL
     * without credentials, or null for anything else. Parsed, never compared as a string prefix (catalog AX-03).
     */
    public static function origin(string $url): ?string
    {
        // Backslashes and percent-encoding are read differently by different URL parsers; such URLs are never valid.
        if (preg_match('/[\\\\%\s]/', $url) === 1) {
            return null;
        }
        $parts = parse_url($url);
        if ($parts === false || strtolower($parts['scheme'] ?? '') !== 'https' || isset($parts['user']) || isset($parts['pass'])) {
            return null;
        }
        $host = strtolower($parts['host'] ?? '');
        if (preg_match('/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\z/', $host) !== 1) {
            return null;
        }
        $port = $parts['port'] ?? 443;

        return 'https://' . $host . ($port === 443 ? '' : ':' . $port);
    }
}
