<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Contract;

use CtPassStore\Infrastructure\ChurchTools\Credential;
use CtPassStore\Infrastructure\ChurchTools\GuzzleChurchToolsClient;
use CtPassStore\Tests\Contract\Helpers\ContractPrerequisites;
use CtPassStore\Tests\Contract\Helpers\OAuthCodeFetcher;
use GuzzleHttp\Client;
use GuzzleHttp\Cookie\CookieJar;
use GuzzleHttp\RequestOptions;
use PHPUnit\Framework\Attributes\Depends;
use PHPUnit\Framework\TestCase;

/**
 * Measures two ChurchTools facts the admin group relies on (catalog AG-10, AG-11): an OAuth client with a deep redirect
 * URI is accepted and redirects there with `code` and `state`, and the user's own OAuth token can read the user's group
 * memberships. The OAuth user is the first normal test user (it needs the per-client login right, granted and removed by the test). Creates an OAuth client named "ctpassstore contract test" as the first admin of
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
    private static int $clientNumericId = 0;
    private static int $loginAuthId = 0;
    private static bool $grantTouched = false;

    /** @var list<string> */
    private static array $grantsBefore = [];
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
        // The OAuth user is a normal test user. For a client created on the fly it needs the per-client right "login to
        // external system", which the test grants for the client's lifetime and removes again.
        $adminUser = self::fixtureUser('admin_users.json');
        self::$user = self::fixtureUser('normal_users.json');

        self::$admin = new Client([RequestOptions::COOKIES => new CookieJar(), RequestOptions::HTTP_ERRORS => false, RequestOptions::TIMEOUT => 30]);
        $login = self::$admin->post(self::$root . '/api/login', [RequestOptions::JSON => ['username' => $adminUser['username'], 'password' => $adminUser['pwd']]]);
        self::assertSame(200, $login->getStatusCode(), 'Admin login');
        self::$csrf = (string) self::json(self::$admin->get(self::$root . '/api/csrftoken'))['data'];

        try {
            self::deleteClients(self::stale());
            $create = self::$admin->post(self::$root . '/api/oauthclients', [
                RequestOptions::HEADERS => ['CSRF-Token' => self::$csrf],
                RequestOptions::JSON => ['name' => self::CLIENT_NAME, 'redirectUri' => self::$redirectUri, 'confidential' => true],
            ]);
            $client = self::json($create)['data'] ?? [];
            $client = is_array($client) && array_is_list($client) ? ($client[0] ?? []) : $client;
            self::$clientId = (string) ($client['identifier'] ?? '');
            self::$clientSecret = (string) ($client['clientSecret'] ?? '');
            self::$clientNumericId = (int) ($client['id'] ?? 0);
            self::assertContains($create->getStatusCode(), [200, 201], 'Creating the OAuth client: ' . substr((string) $create->getBody(), 0, 300));
            self::assertNotSame('', self::$clientId);
            self::grantLogin();
        } catch (\Throwable $e) {
            // tearDownAfterClass doesn't run when setUpBeforeClass fails, so clean up here.
            try {
                self::restoreLoginRight();
                self::deleteClients(self::$clientId === '' ? self::stale() : [self::$clientId]);
            } catch (\Throwable) {
                // The original failure is the one to report.
            }
            throw $e;
        }
    }

    public static function tearDownAfterClass(): void
    {
        try {
            // The right goes first, so no grant for a deleted client is left behind.
            self::restoreLoginRight();
        } finally {
            if (self::$clientId !== '') {
                self::deleteClients([self::$clientId]);
            }
        }
    }

    /** The user's own (not inherited) grants as sorted "authId:dataId" strings. */
    /** @return list<string> */
    private static function grants(): array
    {
        $response = self::$admin->get(self::$root . '/api/permissions/person/' . self::$user['id']);
        self::assertSame(200, $response->getStatusCode(), 'Reading the permissions of the test user');
        $grants = [];
        foreach (self::json($response)['data'] ?? [] as $entry) {
            if (($entry['isInherited'] ?? true) === false) {
                $grants[] = ($entry['authId'] ?? '') . ':' . ($entry['dataId'] ?? '');
            }
        }
        sort($grants);

        return $grants;
    }

    /** Grants the normal user the login right for the test client; its right for other clients stays. */
    private static function grantLogin(): void
    {
        $master = self::json(self::$admin->post(self::$root . '/index.php?q=churchauth/ajax', [
            RequestOptions::HEADERS => ['CSRF-Token' => self::$csrf],
            RequestOptions::FORM_PARAMS => ['func' => 'getMasterData'],
        ]));
        $authId = $master['data']['auth_table']['churchcore']['login to external system']['id'] ?? null;
        self::assertIsInt($authId, 'The auth ID of "login to external system" in the rights master data');
        self::$loginAuthId = $authId;
        self::$grantsBefore = self::grants();
        self::$grantTouched = true;
        // PUT adds the client to the user's list for this right (measured: it does not replace the list).
        self::changeLogin('put');

        // Wait until the user's own permissions show the client.
        $user = new Client([RequestOptions::COOKIES => new CookieJar(), RequestOptions::HTTP_ERRORS => false, RequestOptions::TIMEOUT => 30]);
        $user->post(self::$root . '/api/login', [RequestOptions::JSON => ['username' => self::$user['username'], 'password' => self::$user['pwd']]]);
        for ($i = 0; $i < 30; $i++) {
            $ids = self::json($user->get(self::$root . '/api/permissions/global'))['data']['churchcore']['login to external system'] ?? [];
            if (in_array(self::$clientNumericId, is_array($ids) ? $ids : [], true)) {
                return;
            }
            sleep(1);
        }
        throw new \RuntimeException('The login right for the test client did not show up in /permissions/global after 30 s.');
    }

    /** Adds ('put') or removes ('delete') the test client in the user's list for the login right; others stay. */
    private static function changeLogin(string $method): void
    {
        $status = self::$admin->request(strtoupper($method), self::$root . '/api/permissions/person/' . self::$user['id'], [
            RequestOptions::HEADERS => ['CSRF-Token' => self::$csrf],
            RequestOptions::JSON => ['authId' => self::$loginAuthId, 'dataId' => [self::$clientNumericId]],
        ])->getStatusCode();
        if ($status < 200 || $status >= 300) {
            fwrite(STDERR, 'WARNING: changing the login right of person ' . self::$user['id'] . " answered $status; check it by hand.\n");
            throw new \RuntimeException("Changing the login right answered $status.");
        }
    }

    /** Puts the login right back to what it was and checks that all of the user's grants are as before. */
    private static function restoreLoginRight(): void
    {
        if (!self::$grantTouched) {
            return;
        }
        self::changeLogin('delete');
        self::$grantTouched = false;
        $now = self::grants();
        if ($now !== self::$grantsBefore) {
            fwrite(STDERR, 'WARNING: the permissions of person ' . self::$user['id'] . " differ from the start; check them by hand.\n");
            throw new \RuntimeException('The permissions of the test user differ from the state before the test.');
        }
    }

    /** @return list<string> identifiers of clients named exactly like the test client (left by crashed runs) */
    private static function stale(): array
    {
        $list = self::json(self::$admin->get(self::$root . '/api/oauthclients'))['data'] ?? [];
        $ids = [];
        foreach (is_array($list) ? $list : [] as $client) {
            if (is_array($client) && ($client['name'] ?? null) === self::CLIENT_NAME && is_string($client['identifier'] ?? null)) {
                $ids[] = $client['identifier'];
            }
        }

        return $ids;
    }

    /** @param list<string> $identifiers */
    private static function deleteClients(array $identifiers): void
    {
        foreach ($identifiers as $identifier) {
            $status = self::$admin->delete(self::$root . '/api/oauthclients/' . rawurlencode($identifier), [
                RequestOptions::HEADERS => ['CSRF-Token' => self::$csrf],
            ])->getStatusCode();
            if ($status < 200 || $status >= 300) {
                fwrite(STDERR, "WARNING: deleting the test OAuth client $identifier answered $status; delete it by hand.\n");
                throw new \RuntimeException("Deleting the test OAuth client $identifier answered $status.");
            }
        }
    }

    /** AG-11 */
    public function testDeepRedirectUriIsAcceptedAndRedirectsWithCodeAndState(): void
    {
        $fetcher = new OAuthCodeFetcher((string) getenv('CT_API_URL'));
        $authorization = $fetcher->code(self::$user['username'], self::$user['pwd'], self::$clientId, self::$redirectUri);
        self::assertNotSame('', $authorization['code']);
        self::assertSame(16, strlen($authorization['state']), 'The state is returned as sent.');
        self::$authorization = $authorization;
        self::$verifier = $fetcher->codeVerifier();

        $token = $this->exchange();
        self::assertNotSame('', $token);
    }

    /** AG-10 */
    #[Depends('testDeepRedirectUriIsAcceptedAndRedirectsWithCodeAndState')]
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

        // The client method returns the same groups as integers.
        $viaClient = (new GuzzleChurchToolsClient((string) getenv('CT_API_URL'), Credential::loginToken((string) getenv('CT_API_TOKEN'))))
            ->activeGroupIds(Credential::bearerToken($token), self::$user['id']);
        $expectedInts = array_map('intval', $expectedIds);
        sort($expectedInts);
        sort($viaClient);
        self::assertSame($expectedInts, $viaClient, 'activeGroupIds() with the OAuth token.');
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
