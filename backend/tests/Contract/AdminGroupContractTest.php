<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Contract;

use CtPassStore\Tests\Contract\Helpers\ContractPrerequisites;
use CtPassStore\Tests\Contract\Helpers\OAuthCodeFetcher;
use GuzzleHttp\Client;
use GuzzleHttp\Cookie\CookieJar;
use GuzzleHttp\RequestOptions;
use PHPUnit\Framework\TestCase;

/**
 * Measures two ChurchTools facts the admin group relies on (catalog AG-10, AG-11): an OAuth client with a deep redirect
 * URI is accepted and redirects there with `code` and `state`, and the user's own OAuth token can read the user's group
 * memberships. The OAuth user is the admin test user (admins may log in to every client). Creates an OAuth client named "ctpassstore contract test" as the first admin of
 * `fixtures/admin_users.json` and deletes it again in every case.
 */
final class AdminGroupContractTest extends TestCase
{
    private const CLIENT_NAME = 'ctpassstore contract test';

    private static string $root;
    private static Client $admin;
    private static string $csrf;
    private static string $clientId = '';
    private static string $clientSecret = '';
    private static string $redirectUri;

    /** @var array{code: string, state: string}|null */
    private static ?array $authorization = null;
    private static string $verifier = '';

    /** @var array{id: int, username: string, pwd: string} */
    private static array $user;

    public static function setUpBeforeClass(): void
    {
        ContractPrerequisites::assertMet();
        if (!is_readable(__DIR__ . '/fixtures/admin_users.json')) {
            throw new \RuntimeException('The contract tests need tests/Contract/fixtures/admin_users.json. See docs/testing.md.');
        }
        self::$root = preg_replace('#/api/?$#', '', rtrim((string) getenv('CT_API_URL'), '/')) ?? '';
        self::$redirectUri = self::$root . '/ccm/ctpassstore/auth/callback';
        // The OAuth user is the admin test user: a normal user lacks the right "login to external system" for a client
        // created on the fly (the authorize step answers 500 "not permitted"), and the test doesn't grant rights.
        $adminUser = self::fixtureUser('admin_users.json');
        self::$user = $adminUser;

        self::$admin = new Client([RequestOptions::COOKIES => new CookieJar(), RequestOptions::HTTP_ERRORS => false, RequestOptions::TIMEOUT => 30]);
        $login = self::$admin->post(self::$root . '/api/login', [RequestOptions::JSON => ['username' => $adminUser['username'], 'password' => $adminUser['pwd']]]);
        self::assertSame(200, $login->getStatusCode(), 'Admin login');
        self::$csrf = (string) self::json(self::$admin->get(self::$root . '/api/csrftoken'))['data'];

        $create = self::$admin->post(self::$root . '/api/oauthclients', [
            RequestOptions::HEADERS => ['CSRF-Token' => self::$csrf],
            RequestOptions::JSON => ['name' => self::CLIENT_NAME, 'redirectUri' => self::$redirectUri, 'confidential' => true],
        ]);
        $body = self::json($create);
        $client = $body['data'] ?? [];
        $client = is_array($client) && array_is_list($client) ? ($client[0] ?? []) : $client;
        self::$clientId = (string) ($client['identifier'] ?? '');
        self::$clientSecret = (string) ($client['clientSecret'] ?? '');
        self::assertContains($create->getStatusCode(), [200, 201], 'Creating the OAuth client: ' . substr((string) $create->getBody(), 0, 300));
        self::assertNotSame('', self::$clientId);
    }

    public static function tearDownAfterClass(): void
    {
        if (self::$clientId !== '') {
            self::$admin->delete(self::$root . '/api/oauthclients/' . rawurlencode(self::$clientId), [
                RequestOptions::HEADERS => ['CSRF-Token' => self::$csrf],
            ]);
        }
    }

    /** AG-11 */
    public function testDeepRedirectUriIsAcceptedAndRedirectsWithCodeAndState(): void
    {
        $fetcher = new OAuthCodeFetcher((string) getenv('CT_API_URL'));
        $authorization = $fetcher->code(self::$user['username'], self::$user['pwd'], self::$clientId, self::$redirectUri);
        self::assertNotSame('', $authorization['code']);
        self::assertSame(32 - 16, strlen($authorization['state']), 'The state is returned as sent.');
        self::$authorization = $authorization;
        self::$verifier = $fetcher->codeVerifier();

        $token = $this->exchange();
        self::assertNotSame('', $token);
    }

    /**
     * AG-10
     *
     * @depends testDeepRedirectUriIsAcceptedAndRedirectsWithCodeAndState
     */
    public function testOAuthTokenReadsOwnGroupMemberships(): void
    {
        $userSession = new Client([RequestOptions::COOKIES => new CookieJar(), RequestOptions::HTTP_ERRORS => false, RequestOptions::TIMEOUT => 30]);
        $userSession->post(self::$root . '/api/login', [RequestOptions::JSON => ['username' => self::$user['username'], 'password' => self::$user['pwd']]]);
        $expected = self::json($userSession->get(self::$root . '/api/persons/' . self::$user['id'] . '/groups'))['data'] ?? [];
        self::assertIsArray($expected);
        $expectedIds = [];
        foreach ($expected as $entry) {
            if (($entry['groupMemberStatus'] ?? '') === 'active') {
                $expectedIds[] = (string) $entry['group']['domainIdentifier'];
            }
        }
        self::assertNotSame([], $expectedIds, 'The test user needs at least one active group membership.');

        // The token of the first test is spent (codes are single use), so this fetches a fresh one.
        $fetcher = new OAuthCodeFetcher((string) getenv('CT_API_URL'));
        self::$authorization = $fetcher->code(self::$user['username'], self::$user['pwd'], self::$clientId, self::$redirectUri);
        self::$verifier = $fetcher->codeVerifier();
        $token = $this->exchange();

        $response = (new Client([RequestOptions::HTTP_ERRORS => false, RequestOptions::TIMEOUT => 30]))->get(
            self::$root . '/api/persons/' . self::$user['id'] . '/groups',
            [RequestOptions::HEADERS => ['Authorization' => 'Bearer ' . $token, 'X-OnlyAuthenticated' => '1', 'Accept' => 'application/json']],
        );
        self::assertSame(200, $response->getStatusCode(), substr((string) $response->getBody(), 0, 300));
        $actual = [];
        foreach ((self::json($response)['data'] ?? []) as $entry) {
            self::assertIsString($entry['group']['domainIdentifier'] ?? null, 'group.domainIdentifier is a string');
            if (($entry['groupMemberStatus'] ?? '') === 'active') {
                $actual[] = $entry['group']['domainIdentifier'];
            }
        }
        sort($expectedIds);
        sort($actual);
        self::assertSame($expectedIds, $actual, 'The OAuth token sees the same active memberships as the session.');
    }

    private function exchange(): string
    {
        self::assertNotNull(self::$authorization);
        $response = (new Client([RequestOptions::HTTP_ERRORS => false, RequestOptions::TIMEOUT => 30]))->post(self::$root . '/oauth/access_token', [
            RequestOptions::HEADERS => ['Accept' => 'application/json'],
            RequestOptions::FORM_PARAMS => [
                'grant_type' => 'authorization_code',
                'client_id' => self::$clientId,
                'client_secret' => self::$clientSecret,
                'redirect_uri' => self::$redirectUri,
                'code' => self::$authorization['code'],
                'code_verifier' => self::$verifier,
            ],
        ]);
        self::assertSame(200, $response->getStatusCode(), 'Token exchange: ' . substr(preg_replace('/"[A-Za-z_]*token"\s*:\s*"[^"]*"/', '"…":"…"', (string) $response->getBody()) ?? '', 0, 300));

        return (string) (self::json($response)['access_token'] ?? '');
    }

    /** @return array{id: int, username: string, pwd: string} */
    private static function fixtureUser(string $file): array
    {
        $users = json_decode((string) file_get_contents(__DIR__ . '/fixtures/' . $file), true, 8, JSON_THROW_ON_ERROR);
        self::assertIsArray($users[0] ?? null, "$file needs at least one user.");

        return ['id' => (int) $users[0]['id'], 'username' => (string) $users[0]['username'], 'pwd' => (string) $users[0]['pwd']];
    }

    /** @return array<string, mixed> */
    private static function json(\Psr\Http\Message\ResponseInterface $response): array
    {
        $data = json_decode((string) $response->getBody(), true);

        return is_array($data) ? $data : [];
    }
}
