<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Api;

use CtPassStore\Application\Auth\UserTokens;
use CtPassStore\Http\Problem\ProblemType;
use CtPassStore\Infrastructure\Auth\FirebaseTokenCodec;
use CtPassStore\Infrastructure\ChurchTools\Credential;
use CtPassStore\Infrastructure\ChurchTools\Exception\InvalidResponseException;
use CtPassStore\Infrastructure\ChurchTools\Exception\NotAuthenticatedException;
use CtPassStore\Infrastructure\ChurchTools\Exception\NotFoundException;
use CtPassStore\Infrastructure\ChurchTools\Exception\NotPermittedException;
use CtPassStore\Infrastructure\ChurchTools\Exception\RateLimitedException;
use CtPassStore\Infrastructure\ChurchTools\Exception\UnavailableException;
use CtPassStore\Infrastructure\Kv\KvSchema;
use CtPassStore\Infrastructure\Kv\KvSettingsRepository;
use Firebase\JWT\JWT;
use PHPUnit\Framework\Attributes\DataProvider;
use Psr\Http\Message\ResponseInterface;

/**
 * `POST /v1/auth/token` (spec 4.4, catalog AX-01 to AX-20, TK-14, AG-02 to AG-05).
 */
final class LoginApiTest extends ApiTestCase
{
    private const REDIRECT_URI = 'https://example.church.tools/ccm/ctpassstore/';
    private const CODE = 'authorization-code-SECRET-1';
    private const VERIFIER = 'pkce-verifier-SECRET-0123456789012345678901234';
    private const PERSON = 42;
    /** The admin group of ApiTestCase::setAccess(). */
    private const ADMIN_GROUP = 12;

    protected function setUp(): void
    {
        parent::setUp();
        $this->churchTools->setOAuthClient(self::OAUTH_CLIENT_ID, self::OAUTH_CLIENT_SECRET);
    }

    /**
     * A ChurchTools access token as ChurchTools issues it (RS256), with claim overrides; null removes a claim.
     *
     * @param array<string, mixed> $overrides
     */
    private static function churchToolsToken(array $overrides = []): string
    {
        $claims = array_filter(array_merge([
            'iss' => 'CtPassStore',
            'aud' => self::OAUTH_CLIENT_ID,
            'sub' => (string) self::PERSON,
            'scopes' => ['api'],
            'iat' => time(),
            'exp' => time() + 3600,
            'jti' => bin2hex(random_bytes(8)),
        ], $overrides), static fn(mixed $v): bool => $v !== null);

        return JWT::encode($claims, (string) file_get_contents(__DIR__ . '/../keys/privateKey1.pem'), 'RS256');
    }

    /**
     * Registers a code that gives `$accessToken`, and the person ChurchTools reports for that token.
     *
     * @param array<string, mixed>|null $whoami
     * @param array<string, mixed> $permissions
     */
    private function grant(?string $accessToken = null, ?array $whoami = null, array $permissions = [KvSchema::EXTENSION_KEY => ['view' => true]]): string
    {
        $accessToken ??= self::churchToolsToken();
        $this->churchTools->addAuthorizationCode(self::CODE, self::VERIFIER, self::REDIRECT_URI, $accessToken);
        $whoami ??= ['id' => self::PERSON, 'cmsUserId' => 'alice'];
        $this->churchTools->addUser(Credential::bearerToken($accessToken), self::PERSON, 'alice', $permissions);
        // The exact whoami data under test, including malformed ones.
        $this->churchTools->setWhoami(Credential::bearerToken($accessToken), $whoami);

        return $accessToken;
    }

    /**
     * @param array<string, mixed>|null $body
     * @param array<string, string> $headers
     */
    private function login(?array $body = null, array $headers = []): ResponseInterface
    {
        return $this->request('POST', '/v1/auth/token', null, $body ?? [
            'code' => self::CODE,
            'codeVerifier' => self::VERIFIER,
            'redirectUri' => self::REDIRECT_URI,
        ], $headers);
    }

    /**
     * @return array<string, mixed>
     */
    private function issuedClaims(ResponseInterface $response): array
    {
        $token = (string) $this->json($response)['accessToken'];
        $claims = json_decode((string) base64_decode(strtr(explode('.', $token)[1], '-_', '+/')), true);
        self::assertIsArray($claims);

        return $claims;
    }

    private function assertNoTokenIssued(ResponseInterface $response): void
    {
        self::assertStringNotContainsString('accessToken', (string) $response->getBody());
    }

    // ---------------------------------------------------------------- AX-01, AX-02, AX-17

    public function testAValidCodeGivesABackendToken(): void
    {
        $this->grant();
        $response = $this->login();

        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame('application/json', $response->getHeaderLine('Content-Type'));
        $body = $this->json($response);
        self::assertSame(['accessToken', 'tokenType', 'expiresIn', 'admin', 'version'], array_keys($body));
        self::assertSame('Bearer', $body['tokenType']);
        self::assertSame(900, $body['expiresIn']);
        self::assertFalse($body['admin'], 'AG-03: no membership in the admin group.');
        self::assertSame(self::VERSION, $body['version'], 'AG-03: the version the Kernel was given (Version::current()).');

        $person = (new UserTokens(self::JWT_SECRET, $this->clock, new FirebaseTokenCodec()))->verify((string) $body['accessToken']);
        self::assertSame(self::PERSON, $person->id->value);
        self::assertSame('alice', $person->username, 'AX-17: username comes from whoami.');
    }

    public function testTheExchangeSendsClientCredentialsRedirectUriAndVerifier(): void
    {
        $this->grant();

        $this->login();

        $exchange = array_values(array_filter($this->churchTools->calls(), static fn(array $c): bool => $c['method'] === 'exchangeAuthorizationCode'));
        self::assertCount(1, $exchange);
        self::assertSame([self::OAUTH_CLIENT_ID, self::REDIRECT_URI], $exchange[0]['args']);
        // The fake checks secret and verifier itself; a wrong one would have failed the login (AX-13, AX-05).
    }

    // ---------------------------------------------------------------- AX-03

    #[DataProvider('foreignRedirectUris')]
    public function testRedirectUrisOutsideTheInstanceAreRejectedWithoutCallingChurchTools(string $redirectUri): void
    {
        $this->grant();

        $response = $this->login(['code' => self::CODE, 'codeVerifier' => self::VERIFIER, 'redirectUri' => $redirectUri]);

        $this->assertProblem(ProblemType::InvalidBody, $response);
        self::assertSame([], $this->churchTools->calls());
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function foreignRedirectUris(): iterable
    {
        yield 'subdomain of attacker' => ['https://example.church.tools.evil.com/ccm/ctpassstore/'];
        yield 'credentials trick' => ['https://example.church.tools@evil.com/ccm/ctpassstore/'];
        yield 'http' => ['http://example.church.tools/ccm/ctpassstore/'];
        yield 'other port' => ['https://example.church.tools:444/ccm/ctpassstore/'];
        yield 'protocol-relative' => ['//evil.com/ccm/ctpassstore/'];
        yield 'javascript' => ['javascript:alert(1)'];
        yield 'backslash' => ['https://example.church.tools\\@evil.com/'];
        yield 'encoded host' => ['https://example%2Echurch.tools/'];
        yield 'other host' => ['https://evil.com/ccm/ctpassstore/'];
        yield 'relative' => ['/ccm/ctpassstore/'];
    }

    /**
     * URLs whose host is the instance, but which URL parsers read differently (backslash, percent-encoding, whitespace;
     * PHP's parse_url() even turns control characters into `_`) or which carry credentials. parse_url() alone would
     * accept each of them as the instance, so the pre-check and the user/pass check are what rejects them.
     *
     * @return iterable<string, array{string}>
     */
    public static function ambiguousInstanceRedirectUris(): iterable
    {
        yield 'percent in path' => ['https://example.church.tools/ccm/%2e%2e/ctpassstore/'];
        yield 'percent in query' => ['https://example.church.tools/ccm/ctpassstore/?next=%2F%2Fevil.com'];
        yield 'backslash in path' => ['https://example.church.tools/ccm\\ctpassstore/'];
        yield 'space in path' => ['https://example.church.tools/ccm ctpassstore/'];
        yield 'tab in path' => ["https://example.church.tools/ccm\t/ctpassstore/"];
        yield 'trailing newline' => ["https://example.church.tools/ccm/ctpassstore/\n"];
        yield 'user' => ['https://user@example.church.tools/'];
        yield 'user and password' => ['https://u:p@example.church.tools/'];
        yield 'empty user' => ['https://@example.church.tools/'];
        yield 'password with empty user' => ['https://:p@example.church.tools/'];
    }

    #[DataProvider('ambiguousInstanceRedirectUris')]
    public function testAmbiguousRedirectUrisOfTheInstanceAreRejectedWithoutCallingChurchTools(string $redirectUri): void
    {
        $this->grant();

        $response = $this->login(['code' => self::CODE, 'codeVerifier' => self::VERIFIER, 'redirectUri' => $redirectUri]);

        $this->assertProblem(ProblemType::InvalidBody, $response);
        self::assertSame([], $this->churchTools->calls());
    }

    public function testTheRedirectUriMayUseAnotherPathOrCase(): void
    {
        // ChurchTools checks the exact registered URI; the backend only pins the instance.
        $this->churchTools->addAuthorizationCode(self::CODE, self::VERIFIER, 'https://EXAMPLE.church.tools:443/ccm/ctpassstore/', $token = self::churchToolsToken());
        $this->churchTools->addUser(Credential::bearerToken($token), self::PERSON, 'alice', [KvSchema::EXTENSION_KEY => ['view' => true]]);

        $response = $this->login(['code' => self::CODE, 'codeVerifier' => self::VERIFIER, 'redirectUri' => 'https://EXAMPLE.church.tools:443/ccm/ctpassstore/']);

        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
    }

    // ---------------------------------------------------------------- AX-04, AX-05, AX-13

    public function testARejectedCodeIsOauthCodeInvalid(): void
    {
        $this->grant();

        $response = $this->login(['code' => 'unknown-code', 'codeVerifier' => self::VERIFIER, 'redirectUri' => self::REDIRECT_URI]);

        $this->assertProblem(ProblemType::OauthCodeInvalid, $response);
    }

    public function testAWrongVerifierIsOauthCodeInvalid(): void
    {
        $this->grant();

        $response = $this->login(['code' => self::CODE, 'codeVerifier' => 'wrong-verifier', 'redirectUri' => self::REDIRECT_URI]);

        $this->assertProblem(ProblemType::OauthCodeInvalid, $response);
        $this->assertNoTokenIssued($response);
    }

    /**
     * AX-13: a code that ChurchTools issued to another OAuth client. A missing codeVerifier never gets that far: it's
     * 400 invalid-body before ChurchTools is called (AX-10).
     */
    public function testACodeForAnotherClientIsOauthCodeInvalid(): void
    {
        $token = self::churchToolsToken();
        $this->churchTools->addAuthorizationCode(self::CODE, self::VERIFIER, self::REDIRECT_URI, $token, 'another-client');
        $this->churchTools->addUser(Credential::bearerToken($token), self::PERSON, 'alice', [KvSchema::EXTENSION_KEY => ['view' => true]]);

        $response = $this->login();

        $this->assertProblem(ProblemType::OauthCodeInvalid, $response);
        $this->assertNoTokenIssued($response);
    }

    public function testACodeCanBeUsedOnlyOnce(): void
    {
        $this->grant();

        self::assertSame(200, $this->login()->getStatusCode());
        $this->assertProblem(ProblemType::OauthCodeInvalid, $this->login());
    }

    public function testRejectedClientCredentialsAreMisconfigured(): void
    {
        $this->grant();
        $this->churchTools->setOAuthClient(self::OAUTH_CLIENT_ID, 'another-secret');

        $body = $this->assertProblem(ProblemType::Misconfigured, $this->login());

        self::assertStringContainsString('OAUTH_CLIENT_SECRET', (string) $body['detail']);
        self::assertStringNotContainsString(self::OAUTH_CLIENT_SECRET, (string) $body['detail']);
    }

    // ---------------------------------------------------------------- AX-06, AX-16, AX-18

    /**
     * @param array<string, mixed> $claims
     */
    #[DataProvider('unusableChurchToolsTokens')]
    public function testAnUnusableChurchToolsTokenIssuesNoToken(array $claims): void
    {
        $this->grant(self::churchToolsToken($claims));

        $response = $this->login();

        $this->assertProblem(ProblemType::UpstreamInvalid, $response);
        $this->assertNoTokenIssued($response);
    }

    /**
     * @return iterable<string, array{array<string, mixed>}>
     */
    public static function unusableChurchToolsTokens(): iterable
    {
        yield 'foreign aud' => [['aud' => 'another-client']];
        yield 'aud as list' => [['aud' => [self::OAUTH_CLIENT_ID]]];
        yield 'no aud' => [['aud' => null]];
        yield 'no scopes' => [['scopes' => null]];
        yield 'scopes without api' => [['scopes' => ['DEFAULT']]];
        yield 'scopes as string api' => [['scopes' => 'api']];
        yield 'scopes as string apix' => [['scopes' => 'apix']];
        yield 'scope apix' => [['scopes' => ['apix']]];
        yield 'scope API' => [['scopes' => ['API']]];
        yield 'sub with leading zero' => [['sub' => '042']];
        yield 'sub with letters' => [['sub' => '42a']];
        yield 'sub as float' => [['sub' => 42.5]];
        yield 'sub 0' => [['sub' => '0']];
        yield 'sub as integer 0' => [['sub' => 0]];
        yield 'sub as integer -1' => [['sub' => -1]];
        yield 'sub -1' => [['sub' => '-1']];
        yield 'no sub' => [['sub' => null]];
    }

    /**
     * @return iterable<string, array{int|string}>
     */
    public static function nonPositiveSubs(): iterable
    {
        yield 'integer 0' => [0];
        yield 'integer -1' => [-1];
        yield 'string 0' => ['0'];
    }

    /**
     * A non-positive sub that whoami confirms (so the whoami match can't catch it) is still an invalid upstream answer,
     * never a person ID 0 or below (which would be a 500).
     */
    #[DataProvider('nonPositiveSubs')]
    public function testANonPositiveSubConfirmedByWhoamiIsUpstreamInvalid(int|string $sub): void
    {
        $this->grant(self::churchToolsToken(['sub' => $sub]), ['id' => (int) $sub, 'cmsUserId' => 'alice']);

        $response = $this->login();

        $this->assertProblem(ProblemType::UpstreamInvalid, $response);
        $this->assertNoTokenIssued($response);
    }

    public function testSubAsNumberMatchesWhoami(): void
    {
        $this->grant(self::churchToolsToken(['sub' => self::PERSON]));

        self::assertSame(200, $this->login()->getStatusCode());
    }

    public function testATokenThatIsntRs256IsUpstreamInvalid(): void
    {
        $this->grant(JWT::encode(['aud' => self::OAUTH_CLIENT_ID, 'sub' => '42', 'scopes' => ['api']], str_repeat('k', 32), 'HS256'));

        $this->assertProblem(ProblemType::UpstreamInvalid, $this->login());
    }

    // ---------------------------------------------------------------- AX-07, AX-14, AX-19

    /**
     * @param array<string, mixed> $whoami
     */
    #[DataProvider('wrongPeople')]
    public function testWhoamiMustBeTheTokensPersonWithAUsername(array $whoami): void
    {
        $this->grant(whoami: $whoami);

        $response = $this->login();

        $this->assertProblem(ProblemType::UpstreamInvalid, $response);
        $this->assertNoTokenIssued($response);
    }

    /**
     * @return iterable<string, array{array<string, mixed>}>
     */
    public static function wrongPeople(): iterable
    {
        yield 'another person' => [['id' => 43, 'cmsUserId' => 'mallory']];
        yield 'anonymous -1' => [['id' => -1, 'cmsUserId' => 'anonymous']];
        yield 'anonymous 0' => [['id' => 0, 'cmsUserId' => '']];
        yield 'id as string' => [['id' => '42', 'cmsUserId' => 'alice']];
        yield 'no username' => [['id' => self::PERSON]];
        yield 'empty username' => [['id' => self::PERSON, 'cmsUserId' => '']];
        yield 'username not a string' => [['id' => self::PERSON, 'cmsUserId' => 42]];
    }

    // ---------------------------------------------------------------- AX-08, AX-15

    /**
     * @param array<string, mixed> $permissions
     */
    #[DataProvider('missingViewPermission')]
    public function testWithoutTheViewPermissionNoTokenIsIssued(array $permissions): void
    {
        $this->grant(permissions: $permissions);

        $response = $this->login();

        $this->assertProblem(ProblemType::NoServiceAccess, $response);
        $this->assertNoTokenIssued($response);
    }

    /**
     * @return iterable<string, array{array<string, mixed>}>
     */
    public static function missingViewPermission(): iterable
    {
        yield 'view false' => [[KvSchema::EXTENSION_KEY => ['view' => false]]];
        yield 'no extension key' => [['churchcore' => ['view' => true]]];
        yield 'view "true"' => [[KvSchema::EXTENSION_KEY => ['view' => 'true']]];
        yield 'view 1' => [[KvSchema::EXTENSION_KEY => ['view' => 1]]];
        yield 'view null' => [[KvSchema::EXTENSION_KEY => ['view' => null]]];
        yield 'view a list' => [[KvSchema::EXTENSION_KEY => ['view' => [true]]]];
        yield 'extension not an object' => [[KvSchema::EXTENSION_KEY => true]];
    }

    // ---------------------------------------------------------------- AX-09

    public function testChurchToolsTokensAppearNeitherInResponseNorLog(): void
    {
        $churchToolsToken = $this->grant();

        $ok = $this->login();
        $this->grant(self::churchToolsToken(['aud' => 'another-client']));
        $failed = $this->login();

        foreach ([$ok, $failed] as $response) {
            self::assertStringNotContainsString($churchToolsToken, (string) $response->getBody());
        }
        foreach ($this->log->getRecords() as $record) {
            $line = json_encode($record['message']) . json_encode($record['context']);
            foreach ([$churchToolsToken, self::CODE, self::VERIFIER, self::OAUTH_CLIENT_SECRET] as $secret) {
                self::assertStringNotContainsString($secret, (string) $line);
            }
        }
    }

    // ---------------------------------------------------------------- AX-10, AX-10a

    /**
     * @param array<string, mixed>|string $body
     */
    #[DataProvider('invalidBodies')]
    public function testInvalidBodiesAreRejectedWithoutCallingChurchTools(array|string $body): void
    {
        $response = is_string($body)
            ? $this->rawRequest('POST', '/v1/auth/token', null, $body)
            : $this->login($body);

        $this->assertProblem(ProblemType::InvalidBody, $response);
        self::assertSame([], $this->churchTools->calls());
    }

    /**
     * @return iterable<string, array{array<string, mixed>|string}>
     */
    public static function invalidBodies(): iterable
    {
        $valid = ['code' => self::CODE, 'codeVerifier' => self::VERIFIER, 'redirectUri' => self::REDIRECT_URI];
        foreach (array_keys($valid) as $field) {
            $missing = $valid;
            unset($missing[$field]);
            yield "$field missing" => [$missing];
            yield "$field empty" => [[$field => ''] + $valid];
            yield "$field a number" => [[$field => 1] + $valid];
            yield "$field null" => [[$field => null] + $valid];
            yield "$field 2049 characters" => [[$field => str_repeat('a', 2049)] + $valid];
        }
        yield 'unknown field' => [$valid + ['personId' => 5]];
        yield 'empty body' => ['{}'];
        yield 'list' => ['[]'];
    }

    public function testFieldsWith2048CharactersAreAccepted(): void
    {
        $code = str_repeat('c', 2048);
        $verifier = str_repeat('v', 2048);
        $redirectUri = self::REDIRECT_URI . str_repeat('p', 2048 - strlen(self::REDIRECT_URI));
        $this->churchTools->addAuthorizationCode($code, $verifier, $redirectUri, $token = self::churchToolsToken());
        $this->churchTools->addUser(Credential::bearerToken($token), self::PERSON, 'alice', [KvSchema::EXTENSION_KEY => ['view' => true]]);

        $response = $this->login(['code' => $code, 'codeVerifier' => $verifier, 'redirectUri' => $redirectUri]);

        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
    }

    // ---------------------------------------------------------------- AX-11

    public function testChurchToolsUnreachableIsUpstreamUnavailable(): void
    {
        $this->grant();
        $this->churchTools->failNext('exchangeAuthorizationCode', new UnavailableException('POST oauth/access_token: ChurchTools is unreachable (ConnectException).'));

        $this->assertProblem(ProblemType::UpstreamUnavailable, $this->login());
    }

    // ---------------------------------------------------------------- TK-14, other rules

    public function testManipulatedHostHeadersDontChangeTheIssuer(): void
    {
        $this->grant();

        $response = $this->login(headers: ['Host' => 'evil.example', 'X-Forwarded-Host' => 'evil.example']);

        self::assertSame(200, $response->getStatusCode());
        self::assertSame('ctpassstore-backend', $this->issuedClaims($response)['iss']);
        self::assertSame('ctpassstore-api', $this->issuedClaims($response)['aud']);
    }

    public function testLoginNeedsNoAccessTokenButOtherMethodsAre405(): void
    {
        $this->assertProblem(ProblemType::MethodNotAllowed, $this->request('GET', '/v1/auth/token'));
    }

    public function testASuccessfulLoginIsLogged(): void
    {
        $this->grant();

        $this->login();

        self::assertTrue($this->log->hasInfoThatContains('User ' . self::PERSON . ' logged in.'));
    }

    public function testTheLoginLogLineNamesTheAdminRoleWithoutSecrets(): void
    {
        $this->grant();
        $this->churchTools->addGroupMembership(self::PERSON, self::ADMIN_GROUP);

        $this->login();

        self::assertTrue($this->log->hasInfoThatContains('User ' . self::PERSON . ' logged in as admin.'));
        foreach ($this->log->getRecords() as $record) {
            self::assertStringNotContainsString(self::CODE, (string) $record['message']);
        }
    }

    public function testTheLoginLogLineOfAPlainUserHasNoRole(): void
    {
        $this->grant();

        $this->login();

        self::assertTrue($this->log->hasInfoThatContains('User ' . self::PERSON . ' logged in.'));
        self::assertFalse($this->log->hasInfoThatContains('as admin'));
    }

    // ---------------------------------------------------------------- AG-02, AG-03

    /**
     * @return iterable<string, array{list<array{int, string}>, bool}>
     */
    public static function memberships(): iterable
    {
        yield 'active in the admin group' => [[[self::ADMIN_GROUP, 'active']], true];
        yield 'active in another group too' => [[[7, 'active'], [self::ADMIN_GROUP, 'active']], true];
        yield 'no groups' => [[], false];
        yield 'waiting' => [[[self::ADMIN_GROUP, 'waiting']], false];
        yield 'requested' => [[[self::ADMIN_GROUP, 'requested']], false];
        yield 'to_delete' => [[[self::ADMIN_GROUP, 'to_delete']], false];
        yield 'active in another group only' => [[[13, 'active'], [112, 'active'], [1, 'active']], false];
    }

    /**
     * @param list<array{int, string}> $memberships
     */
    #[DataProvider('memberships')]
    public function testAdminOnlyWithAnActiveMembershipInTheAdminGroup(array $memberships, bool $admin): void
    {
        $this->grant();
        foreach ($memberships as [$groupId, $status]) {
            $this->churchTools->addGroupMembership(self::PERSON, $groupId, $status);
        }

        $response = $this->login();

        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame($admin, $this->json($response)['admin']);
        self::assertSame($admin, $this->issuedClaims($response)['admin'], 'The token carries the same role.');
        $groupCalls = array_values(array_filter($this->churchTools->calls(), static fn(array $c): bool => $c['method'] === 'activeGroupIds'));
        self::assertCount(1, $groupCalls);
        self::assertSame(['Bearer', self::PERSON], $groupCalls[0]['args'], "Asked with the user's own token, for the user.");
    }

    public function testAnAdminTokenFromTheLoginMayActOnOthers(): void
    {
        $this->grant();
        $this->churchTools->addGroupMembership(self::PERSON, self::ADMIN_GROUP);
        $this->seedEntry(self::OTHER);

        $token = (string) $this->json($this->login())['accessToken'];

        self::assertSame(200, $this->request('GET', '/v1/entries/' . self::OTHER, headers: ['Authorization' => 'Bearer ' . $token])->getStatusCode());
    }

    // ---------------------------------------------------------------- AG-02, AG-04 (API part)

    /**
     * @return iterable<string, array{array<string, mixed>}>
     */
    public static function noAdminGroup(): iterable
    {
        yield 'no groups' => [[KvSchema::ACCESS_GROUPS => []]];
        yield 'no groups.admins' => [[KvSchema::ACCESS_GROUPS => ['others' => [KvSchema::GROUP_ID => self::ADMIN_GROUP]]]];
        yield 'groupId missing' => [[KvSchema::ACCESS_GROUPS => [KvSchema::GROUP_ADMINS => []]]];
        yield 'groupId 0' => [[KvSchema::ACCESS_GROUPS => [KvSchema::GROUP_ADMINS => [KvSchema::GROUP_ID => 0]]]];
        yield 'groupId negative' => [[KvSchema::ACCESS_GROUPS => [KvSchema::GROUP_ADMINS => [KvSchema::GROUP_ID => -12]]]];
        yield 'groupId as string' => [[KvSchema::ACCESS_GROUPS => [KvSchema::GROUP_ADMINS => [KvSchema::GROUP_ID => '12']]]];
    }

    /**
     * @param array<string, mixed> $access
     */
    #[DataProvider('noAdminGroup')]
    public function testWithoutAValidAdminGroupNobodyIsAdminAndGroupsArentAsked(array $access): void
    {
        $this->setAccess($access);
        $this->grant();
        $this->churchTools->addGroupMembership(self::PERSON, self::ADMIN_GROUP);

        $response = $this->login();

        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
        self::assertFalse($this->json($response)['admin']);
        self::assertSame(0, $this->churchTools->countCalls(['activeGroupIds']));
    }

    public function testWithoutAnAccessValueNobodyIsAdminAndMachineClientsAreRefused(): void
    {
        $this->churchTools->clearValues($this->categoryIds[KvSchema::ACCESS_CATEGORY]);
        $this->forgetCache();

        $this->assertLoginWorksWithoutAdminsOrMachineClients();
    }

    public function testWithoutTheAccessCategoryNobodyIsAdminAndMachineClientsAreRefused(): void
    {
        $settings = $this->churchTools->storedValues($this->categoryIds[KvSchema::SETTINGS_CATEGORY])[0]['value'];
        $encryption = $this->churchTools->storedValues($this->categoryIds[KvSchema::ENCRYPTION_CATEGORY])[0]['value'];
        $this->churchTools->removeModule(KvSchema::EXTENSION_KEY);
        $this->categoryIds = $this->churchTools->addModule(KvSchema::EXTENSION_KEY, [KvSchema::SETTINGS_CATEGORY, KvSchema::ENCRYPTION_CATEGORY, KvSchema::PASSWORD_CATEGORY]);
        $this->churchTools->seedValue($this->categoryIds[KvSchema::SETTINGS_CATEGORY], (string) $settings);
        $this->churchTools->seedValue($this->categoryIds[KvSchema::ENCRYPTION_CATEGORY], (string) $encryption);
        $this->forgetCache();

        $this->assertLoginWorksWithoutAdminsOrMachineClients();
    }

    public function testAnUnreadableAccessCategoryDoesNotStopLoginsAndMakesNobodyAdmin(): void
    {
        $this->forgetCache();
        $this->churchTools->failNextRead($this->categoryIds[KvSchema::ACCESS_CATEGORY], new \CtPassStore\Infrastructure\ChurchTools\Exception\ServiceCredentialRejectedException('GET customdatavalues: ChurchTools answered 403.'));

        $this->assertLoginWorksWithoutAdminsOrMachineClients();
    }

    private function assertLoginWorksWithoutAdminsOrMachineClients(): void
    {
        $this->grant();
        $this->churchTools->addGroupMembership(self::PERSON, self::ADMIN_GROUP);

        $response = $this->login();

        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
        self::assertFalse($this->json($response)['admin']);
        self::assertSame(0, $this->churchTools->countCalls(['activeGroupIds']));
        $this->assertProblem(ProblemType::InvalidToken, $this->request('GET', '/v1/entries/' . self::USER, self::READER_CLIENT));
    }

    public function testGroupsAreAskedOnlyAfterTheViewCheck(): void
    {
        $this->grant(permissions: [KvSchema::EXTENSION_KEY => ['view' => false]]);
        $this->churchTools->addGroupMembership(self::PERSON, self::ADMIN_GROUP);

        $this->assertProblem(ProblemType::NoServiceAccess, $this->login());
        self::assertSame(0, $this->churchTools->countCalls(['activeGroupIds']));
    }

    // ---------------------------------------------------------------- AG-05

    /**
     * @return iterable<string, array{\Throwable}>
     */
    public static function unreadableGroups(): iterable
    {
        yield '404' => [new NotFoundException('GET persons/{id}/groups: ChurchTools answered 404.')];
        yield '403' => [new NotPermittedException('GET persons/{id}/groups: ChurchTools answered 403.')];
    }

    #[DataProvider('unreadableGroups')]
    public function testUnreadableGroupsMeanNoAdminAndAWarning(\Throwable $failure): void
    {
        $this->grant();
        $this->churchTools->addGroupMembership(self::PERSON, self::ADMIN_GROUP);
        $this->churchTools->failNext('activeGroupIds', $failure);

        $response = $this->login();

        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
        self::assertFalse($this->json($response)['admin']);
        self::assertFalse($this->issuedClaims($response)['admin']);
        self::assertTrue($this->log->hasWarningThatContains("Login: the admin group can't be read with the user's token; user " . self::PERSON . ' is treated as a user.'));
    }

    /**
     * @return iterable<string, array{\Throwable, ProblemType}>
     */
    public static function failingGroups(): iterable
    {
        yield '500' => [new UnavailableException('GET persons/{id}/groups: ChurchTools answered 500.'), ProblemType::UpstreamUnavailable];
        yield 'timeout' => [new UnavailableException('GET persons/{id}/groups: ChurchTools is unreachable (ConnectException).'), ProblemType::UpstreamUnavailable];
        yield '429' => [new RateLimitedException('GET persons/{id}/groups: ChurchTools answered 429.', 30), ProblemType::UpstreamRateLimited];
        yield '401' => [new NotAuthenticatedException('GET persons/{id}/groups: ChurchTools answered 401.'), ProblemType::UpstreamInvalid];
        yield 'malformed answer' => [new InvalidResponseException('GET persons/{id}/groups: a membership has no groupMemberStatus.'), ProblemType::UpstreamInvalid];
    }

    #[DataProvider('failingGroups')]
    public function testFailingGroupsIssueNoToken(\Throwable $failure, ProblemType $expected): void
    {
        $this->grant();
        $this->churchTools->addGroupMembership(self::PERSON, self::ADMIN_GROUP);
        $this->churchTools->failNext('activeGroupIds', $failure);

        $response = $this->login();

        $this->assertProblem($expected, $response);
        $this->assertNoTokenIssued($response);
    }

    // ---------------------------------------------------------------- AX-20

    public function testABrokenSettingsValueFailsTheLoginBeforeTheCodeIsUsed(): void
    {
        $this->grant();
        $this->churchTools->clearValues($this->categoryIds[KvSchema::SETTINGS_CATEGORY]);
        $this->forgetCache();

        $response = $this->login();

        $this->assertProblem(ProblemType::Misconfigured, $response);
        $this->assertNoTokenIssued($response);
        self::assertSame(0, $this->churchTools->countCalls(['exchangeAuthorizationCode']), 'The code stays usable for a retry.');
    }

    public function testAnOutageWhileLoadingTheSettingsFailsTheLoginBeforeTheCodeIsUsed(): void
    {
        $this->grant();
        $this->churchTools->failNext('getModuleByKey', new UnavailableException('GET custommodules/ctpassstore: ChurchTools is unreachable (ConnectException).'));

        $response = $this->login();

        $this->assertProblem(ProblemType::UpstreamUnavailable, $response);
        $this->assertNoTokenIssued($response);
        self::assertSame(0, $this->churchTools->countCalls(['exchangeAuthorizationCode']), 'The code stays usable for a retry.');
        // The outage is remembered for a short while (spec 6.2); afterwards the same code still works.
        $this->clock->advance(KvSettingsRepository::FAILURE_MIN_SECONDS + 1);
        $retry = $this->login();
        self::assertSame(200, $retry->getStatusCode(), (string) $retry->getBody());
    }
}
