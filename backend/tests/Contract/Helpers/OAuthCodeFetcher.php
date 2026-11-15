<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Contract\Helpers;

use GuzzleHttp\Client;
use GuzzleHttp\Cookie\CookieJar;
use GuzzleHttp\RequestOptions;
use Psr\Http\Message\ResponseInterface;

/**
 * Plays the browser's part of the OAuth authorization code flow against ChurchTools: logs in with the user's own
 * credentials in a cookie jar of its own, calls `/oauth/authorize` with PKCE and, if a consent page appears, submits
 * its form. The redirect to the redirect URI is never followed; `code` and `state` are read from its `Location`.
 */
final class OAuthCodeFetcher
{
    private string $codeVerifier = '';

    /** @param string $apiUrl the `CT_API_URL` (…/api), the OAuth endpoints live next to it */
    public function __construct(private readonly string $apiUrl) {}

    /** @return array{code: string, state: string} */
    public function code(
        string $username,
        #[\SensitiveParameter]
        string $password,
        string $clientId,
        string $redirectUri,
    ): array {
        $root = preg_replace('#/api/?$#', '', rtrim($this->apiUrl, '/')) ?? '';
        $http = new Client([
            RequestOptions::COOKIES => new CookieJar(),
            RequestOptions::HTTP_ERRORS => false,
            RequestOptions::ALLOW_REDIRECTS => false,
            RequestOptions::TIMEOUT => 30,
        ]);

        $login = $http->post($root . '/api/login', [RequestOptions::JSON => ['username' => $username, 'password' => $password]]);
        if ($login->getStatusCode() !== 200) {
            throw new \RuntimeException('OAuthCodeFetcher: login answered ' . $login->getStatusCode());
        }

        $this->codeVerifier = rtrim(strtr(base64_encode(random_bytes(48)), '+/', '-_'), '=');
        $state = bin2hex(random_bytes(8));
        $query = http_build_query([
            'client_id' => $clientId,
            'redirect_uri' => $redirectUri,
            'response_type' => 'code',
            'scope' => 'api',
            'state' => $state,
            'code_challenge' => rtrim(strtr(base64_encode(hash('sha256', $this->codeVerifier, true)), '+/', '-_'), '='),
            'code_challenge_method' => 'S256',
        ]);

        $response = $http->get($root . '/oauth/authorize?' . $query);
        // Follows redirects inside ChurchTools by hand (e.g. to a consent page); stops at the redirect URI.
        for ($hops = 0; $hops < 6; $hops++) {
            $location = $response->getHeaderLine('Location');
            if ($location !== '' && explode('?', $location, 2)[0] === $redirectUri) {
                return $this->parse($location, $state);
            }
            if ($location !== '') {
                $response = $http->get(self::absolute($root, $location));
                continue;
            }
            $response = $this->submitConsent($http, $root, $response);
        }

        throw new \RuntimeException('OAuthCodeFetcher: no redirect to the redirect URI after 6 steps.');
    }

    public function codeVerifier(): string
    {
        return $this->codeVerifier;
    }

    /**
     * The consent page is a Vue page that carries the authorize query in `window.grantPermissionData`. Its approve button
     * POSTs it to `/oauth/authorize_granted` with `grant_access=1` and the session's CSRF token (read from its bundle).
     */
    private function submitConsent(Client $http, string $root, ResponseInterface $page): ResponseInterface
    {
        $html = (string) $page->getBody();
        if ($page->getStatusCode() !== 200 || preg_match('/grantPermissionData\s*=\s*(\{.*?\});/s', $html, $match) !== 1) {
            // No page text in the message: the page can carry codes or tokens.
            throw new \RuntimeException(sprintf(
                'OAuthCodeFetcher: the authorize step answered %d without a redirect or a consent page (%s).',
                $page->getStatusCode(),
                Redact::body($html),
            ));
        }
        $data = json_decode($match[1], true, 8, JSON_THROW_ON_ERROR);
        $params = is_array($data) && is_array($data['queryParams'] ?? null) ? $data['queryParams'] : [];
        $csrf = json_decode((string) $http->get($root . '/api/csrftoken')->getBody(), true)['data'] ?? '';

        return $http->post($root . '/oauth/authorize_granted?' . http_build_query($params), [
            RequestOptions::FORM_PARAMS => ['grant_access' => '1', 'CSRF-Token' => $csrf],
        ]);
    }

    private static function absolute(string $root, string $location): string
    {
        return preg_match('#^https?://#', $location) === 1 ? $location : $root . '/' . ltrim($location, '/');
    }

    /** @return array{code: string, state: string} */
    private function parse(string $location, string $expectedState): array
    {
        parse_str((string) parse_url($location, PHP_URL_QUERY), $params);
        $code = $params['code'] ?? '';
        $state = $params['state'] ?? '';
        if (!is_string($code) || $code === '' || !is_string($state) || $state !== $expectedState) {
            throw new \RuntimeException('OAuthCodeFetcher: the redirect has no code or a wrong state (' . implode(',', array_keys($params)) . ').');
        }

        return ['code' => $code, 'state' => $state];
    }
}
