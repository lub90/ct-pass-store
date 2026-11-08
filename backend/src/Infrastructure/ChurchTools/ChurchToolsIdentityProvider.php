<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\ChurchTools;

use CtPassStore\Application\Exception\NoServiceAccessException;
use CtPassStore\Application\Exception\OAuthCodeInvalidException;
use CtPassStore\Application\Port\IdentityProvider;
use CtPassStore\Config\ConfigurationException;
use CtPassStore\Domain\PersonId;
use CtPassStore\Domain\PersonPrincipal;
use CtPassStore\Infrastructure\ChurchTools\Exception\InvalidResponseException;
use CtPassStore\Infrastructure\ChurchTools\Exception\OAuthClientRejectedException;
use CtPassStore\Infrastructure\ChurchTools\Exception\OAuthCodeRejectedException;
use CtPassStore\Infrastructure\Kv\KvSchema;
use Psr\Log\LoggerInterface;

/**
 * Logs a person in through ChurchTools' OAuth server (spec 4.4, D4).
 *
 * The ChurchTools access token exists only inside authenticate(): it's used for `whoami` and `permissions/global` and
 * then dropped. It's never stored, logged or put into an exception message.
 */
final class ChurchToolsIdentityProvider implements IdentityProvider
{
    public function __construct(
        private readonly ChurchToolsClient $client,
        private readonly string $clientId,
        #[\SensitiveParameter]
        private readonly string $clientSecret,
        private readonly LoggerInterface $logger,
    ) {}

    public function authenticate(
        #[\SensitiveParameter]
        string $code,
        #[\SensitiveParameter]
        string $codeVerifier,
        string $redirectUri,
    ): PersonPrincipal {
        try {
            $accessToken = $this->client->exchangeAuthorizationCode($this->clientId, $this->clientSecret, $code, $redirectUri, $codeVerifier);
        } catch (OAuthCodeRejectedException $e) {
            $this->logger->warning('Login failed: ' . $e->getMessage());
            throw new OAuthCodeInvalidException('ChurchTools didn\'t accept the authorization code. Start the login again.');
        } catch (OAuthClientRejectedException) {
            throw new ConfigurationException('ChurchTools rejected OAUTH_CLIENT_ID or OAUTH_CLIENT_SECRET in credentials.php. Check them against the OAuth application in ChurchTools.');
        }

        $personId = $this->personIdFromToken($accessToken);
        $credential = Credential::bearerToken($accessToken);

        $person = $this->client->whoami($credential);
        $id = $person['id'] ?? null;
        $username = $person['cmsUserId'] ?? null;
        if (!is_int($id) || $id !== $personId) {
            throw new InvalidResponseException('GET whoami: the person doesn\'t match the token\'s sub.');
        }
        if (!is_string($username) || $username === '') {
            throw new InvalidResponseException('GET whoami: the person has no username (cmsUserId).');
        }

        $permissions = $this->client->globalPermissions($credential);
        $extension = $permissions[KvSchema::EXTENSION_KEY] ?? null;
        if (!is_array($extension) || ($extension['view'] ?? null) !== true) {
            $this->logger->warning("Login refused: user $personId has no access to the service.");
            throw new NoServiceAccessException('You don\'t have the right to use the CtPassStore extension.');
        }

        return new PersonPrincipal(new PersonId($personId), $username);
    }

    /**
     * Checks the ChurchTools access token's header and claims (spec 4.4.3). ChurchTools publishes no key, so the
     * signature can't be verified; `whoami` with the token is what proves it.
     */
    private function personIdFromToken(#[\SensitiveParameter] string $token): int
    {
        $parts = explode('.', $token);
        $header = count($parts) === 3 ? self::decodePart($parts[0]) : null;
        $claims = count($parts) === 3 ? self::decodePart($parts[1]) : null;
        if ($header === null || $claims === null || ($header['alg'] ?? null) !== 'RS256') {
            throw new InvalidResponseException('POST oauth/access_token: the access token isn\'t an RS256 JWT.');
        }

        $aud = $claims['aud'] ?? null;
        if (!is_string($aud) || !hash_equals($this->clientId, $aud)) {
            throw new InvalidResponseException('POST oauth/access_token: the access token is for another client.');
        }
        $scopes = $claims['scopes'] ?? null;
        if (!is_array($scopes) || !array_is_list($scopes) || !in_array('api', $scopes, true)) {
            throw new InvalidResponseException('POST oauth/access_token: the access token doesn\'t have the scope api.');
        }
        $sub = $claims['sub'] ?? null;
        if (is_int($sub) && $sub > 0) {
            return $sub;
        }
        $fromString = is_string($sub) ? PersonId::decimal($sub) : null;
        if ($fromString !== null && $fromString > 0) {
            return $fromString;
        }
        throw new InvalidResponseException('POST oauth/access_token: the access token has no valid person ID (sub).');
    }

    /**
     * @return array<string, mixed>|null
     */
    private static function decodePart(string $part): ?array
    {
        if (preg_match('/^[A-Za-z0-9_-]+\z/', $part) !== 1) {
            return null;
        }
        $decoded = json_decode((string) base64_decode(strtr($part, '-_', '+/'), true), true, 32);

        return is_array($decoded) && !array_is_list($decoded) ? $decoded : null;
    }
}
