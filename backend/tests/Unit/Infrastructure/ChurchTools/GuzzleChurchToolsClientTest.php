<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Infrastructure\ChurchTools;

use CtPassStore\Infrastructure\ChurchTools\Credential;
use CtPassStore\Infrastructure\ChurchTools\Exception\ChurchToolsException;
use CtPassStore\Infrastructure\ChurchTools\Exception\InvalidResponseException;
use CtPassStore\Infrastructure\ChurchTools\Exception\NotAuthenticatedException;
use CtPassStore\Infrastructure\ChurchTools\Exception\NotFoundException;
use CtPassStore\Infrastructure\ChurchTools\Exception\NotPermittedException;
use CtPassStore\Infrastructure\ChurchTools\Exception\OAuthClientRejectedException;
use CtPassStore\Infrastructure\ChurchTools\Exception\OAuthCodeRejectedException;
use CtPassStore\Infrastructure\ChurchTools\Exception\RateLimitedException;
use CtPassStore\Infrastructure\ChurchTools\Exception\ServiceCredentialRejectedException;
use CtPassStore\Infrastructure\ChurchTools\Exception\UnavailableException;
use CtPassStore\Infrastructure\ChurchTools\GuzzleChurchToolsClient;
use CtPassStore\Infrastructure\ChurchTools\LoginResult;
use GuzzleHttp\Client;
use GuzzleHttp\Exception\ConnectException;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\Request;
use GuzzleHttp\Psr7\Response;
use GuzzleHttp\RequestOptions;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Psr\Http\Message\RequestInterface;

/**
 * Catalog section 5 (CC-01 to CC-16) and ST-12.
 */
final class GuzzleChurchToolsClientTest extends TestCase
{
    private const SERVICE_TOKEN = 'service-token-SECRET-1234';
    private const USER_TOKEN = 'user-token-SECRET-5678';
    private const PASSWORD = 'primary-password-SECRET-9';
    private const NOW = 1_800_000_000;

    /** @var list<array{request: RequestInterface, options: array<string, mixed>}> */
    private array $history = [];

    private MockHandler $mock;

    private function client(string $apiUrl = 'https://example.church.tools/api'): GuzzleChurchToolsClient
    {
        $this->history = [];
        $this->mock = new MockHandler();
        $stack = HandlerStack::create($this->mock);
        $stack->push(Middleware::history($this->history));

        return new GuzzleChurchToolsClient(
            $apiUrl,
            Credential::loginToken(self::SERVICE_TOKEN),
            http: new Client(GuzzleChurchToolsClient::guzzleOptions($apiUrl) + ['handler' => $stack]),
            now: static fn(): int => self::NOW,
        );
    }

    /**
     * @param array<mixed>|string $body
     * @param array<string, string> $headers
     */
    private function respond(int $status, array|string $body = [], array $headers = []): void
    {
        $this->mock->append(new Response(
            $status,
            $headers + ['Content-Type' => 'application/json'],
            is_string($body) ? $body : json_encode($body, JSON_THROW_ON_ERROR),
        ));
    }

    private function lastRequest(): RequestInterface
    {
        self::assertNotEmpty($this->history);

        return $this->history[array_key_last($this->history)]['request'];
    }

    // ---------------------------------------------------------------- CC-01 URLs

    /**
     * @return iterable<string, array{string}>
     */
    public static function baseUrls(): iterable
    {
        yield 'without trailing slash' => ['https://example.church.tools/api'];
        yield 'with trailing slash' => ['https://example.church.tools/api/'];
    }

    #[DataProvider('baseUrls')]
    public function testApiPathIsNeverDropped(string $apiUrl): void
    {
        $client = $this->client($apiUrl);
        $this->respond(200, ['data' => [], 'meta' => ['count' => 0]]);

        $client->getValues(7, 13);

        self::assertSame(
            'https://example.church.tools/api/custommodules/7/customdatacategories/13/customdatavalues',
            (string) $this->lastRequest()->getUri(),
        );
    }

    /**
     * @return iterable<string, array{int}>
     */
    public static function unknownModuleStatuses(): iterable
    {
        yield '404' => [404];
        yield '400 validation.integer (real ChurchTools)' => [400];
    }

    #[DataProvider('unknownModuleStatuses')]
    public function testUnknownModuleKeyIsNotFound(int $status): void
    {
        $client = $this->client();
        $this->respond($status, ['message' => 'validation.integer']);

        $this->expectException(NotFoundException::class);
        $client->getModuleByKey('ctpassstore');
    }

    public function testA400OnOtherCallsIsNotNotFound(): void
    {
        $client = $this->client();
        $this->respond(400, ['message' => 'bad']);

        $this->expectException(InvalidResponseException::class);
        $client->getCategories(7);
    }

    public function testModuleKeyIsValidatedBeforeItGoesIntoTheUrl(): void
    {
        $client = $this->client();

        $this->expectException(\InvalidArgumentException::class);
        $client->getModuleByKey('../permissions/global');
    }

    public function testNonPositiveIdsAreRejectedBeforeAnyRequest(): void
    {
        $client = $this->client();

        try {
            $client->deleteValue(7, 13, 0);
            self::fail('Expected an exception.');
        } catch (\InvalidArgumentException) {
            self::assertSame([], $this->history);
        }
    }

    // ---------------------------------------------------------------- CC-02, CC-12 credentials

    public function testKvCallsUseTheServiceCredentialAndOnlyAuthenticated(): void
    {
        $client = $this->client();
        $this->respond(200, ['data' => ['id' => 7]]);

        $client->getModuleByKey('ctpassstore');

        $request = $this->lastRequest();
        self::assertSame('Login ' . self::SERVICE_TOKEN, $request->getHeaderLine('Authorization'));
        self::assertSame('1', $request->getHeaderLine('X-OnlyAuthenticated'));
        self::assertSame('https://example.church.tools/api/custommodules/ctpassstore', (string) $request->getUri());
    }

    public function testUserCallsUseTheUserCredentialAndNeverTheServiceCredential(): void
    {
        $client = $this->client();
        $this->respond(200, ['data' => ['id' => 5]]);
        $this->respond(200, ['data' => ['ctpassstore' => ['view' => true]]]);

        $client->whoami(Credential::bearerToken(self::USER_TOKEN));
        $client->globalPermissions(Credential::bearerToken(self::USER_TOKEN));

        foreach ($this->history as $entry) {
            self::assertSame('Bearer ' . self::USER_TOKEN, $entry['request']->getHeaderLine('Authorization'));
            self::assertSame('1', $entry['request']->getHeaderLine('X-OnlyAuthenticated'));
        }
    }

    public function testLoginSendsNoAuthorizationHeader(): void
    {
        $client = $this->client();
        $this->respond(200, ['data' => ['personId' => 5, 'status' => 'success', 'message' => 'ok', 'location' => null]]);

        $client->verifyLogin('jdoe', self::PASSWORD);

        $request = $this->lastRequest();
        self::assertFalse($request->hasHeader('Authorization'));
        self::assertSame('POST', $request->getMethod());
        self::assertSame(['username' => 'jdoe', 'password' => self::PASSWORD], json_decode((string) $request->getBody(), true));
    }

    // ---------------------------------------------------------------- CC-03, CC-13 envelope

    public function testDataEnvelopeIsUnwrapped(): void
    {
        $client = $this->client();
        $this->respond(200, ['data' => ['id' => 5, 'cmsUserId' => 'jdoe'], 'meta' => ['simulatingUserId' => null]]);

        self::assertSame(['id' => 5, 'cmsUserId' => 'jdoe'], $client->whoami(Credential::bearerToken(self::USER_TOKEN)));
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function unusableBodies(): iterable
    {
        yield 'no data member' => ['{"meta": {}}'];
        yield 'data null' => ['{"data": null}'];
        yield 'data is a list' => ['{"data": [1, 2]}'];
        yield 'data is a string' => ['{"data": "x"}'];
        yield 'HTML' => ['<html><body>Login</body></html>'];
        yield 'empty body' => [''];
        yield 'JSON list' => ['[{"data": {}}]'];
    }

    #[DataProvider('unusableBodies')]
    public function testUnusableBodiesAreInvalidResponsesNeverEmptyData(string $body): void
    {
        $client = $this->client();
        $this->respond(200, $body);

        $this->expectException(InvalidResponseException::class);
        $client->whoami(Credential::bearerToken(self::USER_TOKEN));
    }

    public function testCategoryListMustBeAListOfObjects(): void
    {
        $client = $this->client();
        $this->respond(200, ['data' => ['id' => 1]]);

        $this->expectException(InvalidResponseException::class);
        $client->getCategories(7);
    }

    // ---------------------------------------------------------------- ST-12 meta.count

    public function testValuesAreReturnedWhenMetaCountMatches(): void
    {
        $client = $this->client();
        $values = [['id' => 1, 'dataCategoryId' => 13, 'value' => '{}'], ['id' => 2, 'dataCategoryId' => 13, 'value' => '{}']];
        $this->respond(200, ['data' => $values, 'meta' => ['count' => 2]]);

        self::assertSame($values, $client->getValues(7, 13));
    }

    public function testAnEmptyCategoryIsValid(): void
    {
        $client = $this->client();
        $this->respond(200, ['data' => [], 'meta' => ['count' => 0]]);

        self::assertSame([], $client->getValues(7, 13));
    }

    /**
     * @return iterable<string, array{array<string, mixed>}>
     */
    public static function incompleteValueResponses(): iterable
    {
        $one = [['id' => 1, 'dataCategoryId' => 13, 'value' => '{}']];
        yield 'count larger than the list' => [['data' => $one, 'meta' => ['count' => 2]]];
        yield 'count smaller than the list' => [['data' => $one, 'meta' => ['count' => 0]]];
        yield 'count missing' => [['data' => $one]];
        yield 'meta missing, empty list' => [['data' => []]];
        yield 'count as a string' => [['data' => $one, 'meta' => ['count' => '1']]];
    }

    public function testMetaCountAsAFloatIsNotAccepted(): void
    {
        $client = $this->client();
        $this->respond(200, '{"data": [{"id": 1, "dataCategoryId": 13, "value": "{}"}], "meta": {"count": 1.0}}');

        $this->expectException(InvalidResponseException::class);
        $client->getValues(7, 13);
    }

    /**
     * @param array<string, mixed> $body
     */
    #[DataProvider('incompleteValueResponses')]
    public function testIncompleteValueListsAreNeverTreatedAsComplete(array $body): void
    {
        $client = $this->client();
        $this->respond(200, $body);

        $this->expectException(InvalidResponseException::class);
        $client->getValues(7, 13);
    }

    // ---------------------------------------------------------------- writes

    public function testCreateValueSendsTheValueAndReturnsTheNewId(): void
    {
        $client = $this->client();
        $this->respond(201, ['data' => ['id' => 42, 'dataCategoryId' => 13, 'value' => '{"a":1}']]);

        self::assertSame(42, $client->createValue(7, 13, '{"a":1}'));

        $request = $this->lastRequest();
        self::assertSame('POST', $request->getMethod());
        self::assertSame(['dataCategoryId' => 13, 'value' => '{"a":1}'], json_decode((string) $request->getBody(), true));
    }

    public function testCreateValueWithoutAnIdInTheResponseIsInvalid(): void
    {
        $client = $this->client();
        $this->respond(201, ['data' => ['dataCategoryId' => 13]]);

        $this->expectException(InvalidResponseException::class);
        $client->createValue(7, 13, '{}');
    }

    public function testUpdateAndDeleteAddressExactlyTheGivenValue(): void
    {
        $client = $this->client();
        $this->respond(200, ['data' => ['id' => 42]]);
        $this->respond(204, '');

        $client->updateValue(7, 13, 42, '{"b":2}');
        $client->deleteValue(7, 13, 42);

        self::assertSame('PUT', $this->history[0]['request']->getMethod());
        self::assertSame(['id' => 42, 'dataCategoryId' => 13, 'value' => '{"b":2}'], json_decode((string) $this->history[0]['request']->getBody(), true));
        self::assertSame('DELETE', $this->history[1]['request']->getMethod());
        self::assertStringEndsWith('/customdatacategories/13/customdatavalues/42', (string) $this->history[1]['request']->getUri());
    }

    // ---------------------------------------------------------------- CC-04, CC-05 error mapping

    /**
     * @return iterable<string, array{int, class-string<ChurchToolsException>}>
     */
    public static function userCallErrors(): iterable
    {
        yield '401' => [401, NotAuthenticatedException::class];
        yield '403' => [403, NotPermittedException::class];
        yield '404' => [404, NotFoundException::class];
        yield '429' => [429, RateLimitedException::class];
        yield '500' => [500, UnavailableException::class];
        yield '503' => [503, UnavailableException::class];
        yield '302 (redirects are not followed)' => [302, InvalidResponseException::class];
        yield '400' => [400, InvalidResponseException::class];
        yield '418' => [418, InvalidResponseException::class];
    }

    /**
     * @param class-string<ChurchToolsException> $expected
     */
    #[DataProvider('userCallErrors')]
    public function testUserCallErrorsAreMappedByStatus(int $status, string $expected): void
    {
        $client = $this->client();
        $this->respond($status, ['message' => 'nope'], $status === 302 ? ['Location' => 'https://evil.example/steal'] : []);

        $this->expectException($expected);
        $client->whoami(Credential::bearerToken(self::USER_TOKEN));
    }

    /**
     * @return iterable<string, array{int}>
     */
    public static function rejectedServiceStatuses(): iterable
    {
        yield '401' => [401];
        yield '403' => [403];
    }

    #[DataProvider('rejectedServiceStatuses')]
    public function testRejectedServiceCredentialIsAConfigurationProblem(int $status): void
    {
        $client = $this->client();
        $this->respond($status, ['message' => 'nope']);

        $this->expectException(ServiceCredentialRejectedException::class);
        $client->getCategories(7);
    }

    public function testNetworkErrorsAreUnavailable(): void
    {
        $client = $this->client();
        $this->mock->append(new ConnectException('cURL error 28: timeout for Authorization: Login ' . self::SERVICE_TOKEN, new Request('GET', 'x')));

        try {
            $client->getCategories(7);
            self::fail('Expected an exception.');
        } catch (UnavailableException $e) {
            self::assertStringNotContainsString(self::SERVICE_TOKEN, $e->getMessage());
        }
    }

    public function testNetworkErrorsNameTheCurlErrorNumber(): void
    {
        $client = $this->client();
        $this->mock->append(new ConnectException('cURL error 6: Could not resolve host', new Request('GET', 'x'), null, ['errno' => 6]));

        try {
            $client->getCategories(7);
            self::fail('Expected an exception.');
        } catch (UnavailableException $e) {
            self::assertStringContainsString('ConnectException, cURL error 6', $e->getMessage());
            self::assertStringNotContainsString('resolve host', $e->getMessage(), "Guzzle's own message isn't passed on.");
        }
    }

    // ---------------------------------------------------------------- OAuth code exchange (spec 4.4.2)

    private const CLIENT_SECRET = 'oauth-client-SECRET-77';
    private const CODE = 'auth-code-SECRET-88';
    private const VERIFIER = 'pkce-verifier-SECRET-99';

    private function exchange(GuzzleChurchToolsClient $client): string
    {
        return $client->exchangeAuthorizationCode('client-id', self::CLIENT_SECRET, self::CODE, 'https://example.church.tools/ccm/ctpassstore/', self::VERIFIER);
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function apiUrls(): iterable
    {
        yield 'without slash' => ['https://example.church.tools/api'];
        yield 'with slash' => ['https://example.church.tools/api/'];
    }

    #[DataProvider('apiUrls')]
    public function testTheCodeExchangeGoesToTheInstanceRoot(string $apiUrl): void
    {
        $client = $this->client($apiUrl);
        $this->respond(200, ['token_type' => 'Bearer', 'expires_in' => 3600, 'access_token' => 'ct-access-token', 'refresh_token' => 'ct-refresh-token']);

        self::assertSame('ct-access-token', $this->exchange($client));

        $request = $this->lastRequest();
        self::assertSame('POST', $request->getMethod());
        self::assertSame('https://example.church.tools/oauth/access_token', (string) $request->getUri());
        self::assertSame('application/x-www-form-urlencoded', $request->getHeaderLine('Content-Type'));
        self::assertFalse($request->hasHeader('Authorization'), 'The service user\'s token is never sent to the OAuth server.');
        parse_str((string) $request->getBody(), $form);
        self::assertSame([
            'grant_type' => 'authorization_code',
            'client_id' => 'client-id',
            'client_secret' => self::CLIENT_SECRET,
            'redirect_uri' => 'https://example.church.tools/ccm/ctpassstore/',
            'code' => self::CODE,
            'code_verifier' => self::VERIFIER,
        ], $form);
    }

    /**
     * AX-09 at the client: only the access token leaves the client; the refresh token is dropped right here.
     */
    public function testTheRefreshTokenNeverLeavesTheClient(): void
    {
        $client = $this->client();
        $this->respond(200, ['token_type' => 'Bearer', 'expires_in' => 3600, 'access_token' => 'ct-access-token', 'refresh_token' => 'ct-REFRESH-token-secret']);

        $result = $this->exchange($client);

        self::assertSame('ct-access-token', $result);
        self::assertStringNotContainsString('REFRESH', $result);
    }

    /**
     * @param array<string, mixed>|string $body
     * @param class-string<\Throwable> $exception
     */
    #[DataProvider('exchangeErrors')]
    public function testCodeExchangeErrors(int $status, array|string $body, string $exception): void
    {
        $client = $this->client();
        $this->respond($status, $body);

        try {
            $this->exchange($client);
            self::fail('Expected ' . $exception);
        } catch (\Throwable $e) {
            self::assertInstanceOf($exception, $e);
            foreach ([self::CLIENT_SECRET, self::CODE, self::VERIFIER] as $secret) {
                self::assertStringNotContainsString($secret, $e->getMessage());
            }
        }
    }

    /**
     * @return iterable<string, array{int, array<string, mixed>|string, class-string<\Throwable>}>
     */
    public static function exchangeErrors(): iterable
    {
        yield 'invalid_grant' => [400, ['error' => 'invalid_grant', 'error_description' => 'The authorization code has expired'], OAuthCodeRejectedException::class];
        yield 'invalid_request' => [400, ['error' => 'invalid_request', 'hint' => 'Check the code_verifier ' . self::VERIFIER], OAuthCodeRejectedException::class];
        yield '400 without JSON' => [400, 'Bad Request', OAuthCodeRejectedException::class];
        yield 'invalid_client 401' => [401, ['error' => 'invalid_client'], OAuthClientRejectedException::class];
        yield 'invalid_client 400' => [400, ['error' => 'invalid_client'], OAuthClientRejectedException::class];
        yield '401 without JSON' => [401, '', OAuthClientRejectedException::class];
        yield 'error code with odd characters' => [400, ['error' => "x\n" . self::CODE], OAuthCodeRejectedException::class];
        yield '429' => [429, [], RateLimitedException::class];
        yield '500' => [500, [], UnavailableException::class];
        yield 'no access_token' => [200, ['token_type' => 'Bearer'], InvalidResponseException::class];
        yield 'empty access_token' => [200, ['access_token' => ''], InvalidResponseException::class];
        yield 'not JSON' => [200, 'nope', InvalidResponseException::class];
    }

    // ---------------------------------------------------------------- CC-06 no secrets in messages

    public function testExceptionMessagesNeverContainSecrets(): void
    {
        $client = $this->client();
        $statuses = [401, 403, 404, 429, 500, 302, 400];
        foreach ($statuses as $status) {
            $this->respond($status, ['message' => 'echo ' . self::USER_TOKEN . ' ' . self::SERVICE_TOKEN]);
        }

        foreach ($statuses as $status) {
            try {
                $client->whoami(Credential::bearerToken(self::USER_TOKEN));
                self::fail("Expected an exception for $status.");
            } catch (ChurchToolsException $e) {
                self::assertStringNotContainsString(self::USER_TOKEN, $e->getMessage());
                self::assertStringNotContainsString(self::SERVICE_TOKEN, $e->getMessage());
                self::assertStringNotContainsString('echo', $e->getMessage(), 'Response bodies must not be copied into messages.');
            }
        }
    }

    public function testCredentialsNeverRevealTheirSecret(): void
    {
        $credential = Credential::bearerToken(self::USER_TOKEN);

        self::assertStringNotContainsString(self::USER_TOKEN, (string) $credential);
        self::assertStringNotContainsString(self::USER_TOKEN, print_r($credential, true));
        self::assertStringNotContainsString(self::USER_TOKEN, var_export($credential, true));
        self::assertStringNotContainsString(self::USER_TOKEN, print_r((array) $credential, true));
        self::assertStringNotContainsString(self::USER_TOKEN, json_encode(get_object_vars($credential), JSON_THROW_ON_ERROR));
        ob_start();
        var_dump($credential);
        self::assertStringNotContainsString(self::USER_TOKEN, (string) ob_get_clean());
        self::assertSame('Bearer ' . self::USER_TOKEN, $credential->authorizationHeader());

        $this->expectException(\LogicException::class);
        serialize($credential);
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function invalidTokens(): iterable
    {
        yield 'empty' => [''];
        yield 'space' => ['abc def'];
        yield 'newline (header injection)' => ["abc\r\nX-Evil: 1"];
    }

    #[DataProvider('invalidTokens')]
    public function testCredentialsRejectEmptyTokensAndWhitespace(string $token): void
    {
        $this->expectException(\InvalidArgumentException::class);
        Credential::loginToken($token);
    }

    // ---------------------------------------------------------------- login

    public function testSuccessfulLoginReturnsPersonAndStatus(): void
    {
        $client = $this->client();
        $this->respond(200, ['data' => ['personId' => 5, 'status' => 'success', 'message' => 'ok', 'location' => null]]);

        $result = $client->verifyLogin('jdoe', self::PASSWORD);

        self::assertEquals(new LoginResult(5, LoginResult::STATUS_SUCCESS), $result);
        self::assertTrue($result?->isComplete());
    }

    public function testPendingSecondFactorIsReportedNotHidden(): void
    {
        $client = $this->client();
        $this->respond(200, ['data' => ['personId' => 5, 'status' => 'totp', 'message' => 'TOTP needed', 'location' => '?q=twofactor']]);

        $result = $client->verifyLogin('jdoe', self::PASSWORD);

        self::assertSame(LoginResult::STATUS_TOTP, $result?->status);
        self::assertFalse($result->isComplete());
    }

    /**
     * @return iterable<string, array{int}>
     */
    public static function rejectedLoginStatuses(): iterable
    {
        yield '400' => [400];
        yield '401' => [401];
        yield '403' => [403];
    }

    #[DataProvider('rejectedLoginStatuses')]
    public function testRejectedCredentialsGiveNull(int $status): void
    {
        $client = $this->client();
        $this->respond($status, ['message' => 'Wrong credentials']);

        self::assertNull($client->verifyLogin('jdoe', self::PASSWORD));
    }

    /**
     * @return iterable<string, array{int, class-string<ChurchToolsException>}>
     */
    public static function failedLoginCalls(): iterable
    {
        yield 'server error' => [500, UnavailableException::class];
        yield 'rate limited' => [429, RateLimitedException::class];
    }

    /**
     * @param class-string<ChurchToolsException> $expected
     */
    #[DataProvider('failedLoginCalls')]
    public function testLoginFailuresAreNeverAWrongPassword(int $status, string $expected): void
    {
        $client = $this->client();
        $this->respond($status, '');

        $this->expectException($expected);
        $client->verifyLogin('jdoe', self::PASSWORD);
    }

    /**
     * @return iterable<string, array{array<string, mixed>}>
     */
    public static function malformedLoginResults(): iterable
    {
        yield 'no person ID' => [['data' => ['status' => 'success']]];
        yield 'person ID as a string' => [['data' => ['personId' => '5', 'status' => 'success']]];
        yield 'person ID 0' => [['data' => ['personId' => 0, 'status' => 'success']]];
        yield 'anonymous person' => [['data' => ['personId' => -1, 'status' => 'success']]];
        yield 'no status' => [['data' => ['personId' => 5]]];
    }

    /**
     * @param array<string, mixed> $body
     */
    #[DataProvider('malformedLoginResults')]
    public function testMalformedLoginResultsAreInvalid(array $body): void
    {
        $client = $this->client();
        $this->respond(200, $body);

        $this->expectException(InvalidResponseException::class);
        $client->verifyLogin('jdoe', self::PASSWORD);
    }

    // ---------------------------------------------------------------- CC-07, CC-08, CC-09, CC-15 transport

    public function testTransportOptionsAreSafe(): void
    {
        $options = GuzzleChurchToolsClient::guzzleOptions('https://example.church.tools/api', 3.5);

        self::assertTrue($options[RequestOptions::VERIFY]);
        self::assertFalse($options[RequestOptions::ALLOW_REDIRECTS]);
        self::assertFalse($options[RequestOptions::COOKIES]);
        self::assertSame(3.5, $options[RequestOptions::TIMEOUT]);
        self::assertSame(3.5, $options[RequestOptions::CONNECT_TIMEOUT]);
    }

    public function testTimeoutReachesTheRequest(): void
    {
        $client = $this->client();
        $this->respond(200, ['data' => []]);

        $client->getCategories(7);

        self::assertSame(GuzzleChurchToolsClient::DEFAULT_TIMEOUT_SECONDS, $this->history[0]['options'][RequestOptions::TIMEOUT]);
    }

    public function testCookiesAreNeitherStoredNorSent(): void
    {
        $client = $this->client();
        $this->respond(200, ['data' => []], ['Set-Cookie' => 'ChurchToolsV2=abc; Path=/']);
        $this->respond(200, ['data' => []]);

        $client->getCategories(7);
        $client->getCategories(7);

        self::assertFalse($this->history[1]['request']->hasHeader('Cookie'));
    }

    /**
     * @return iterable<string, array{int}>
     */
    public static function noRetryStatuses(): iterable
    {
        yield '429' => [429];
        yield '500' => [500];
        yield '302' => [302];
    }

    #[DataProvider('noRetryStatuses')]
    public function testThereIsExactlyOneRequestAndNoRetry(int $status): void
    {
        $client = $this->client();
        $this->respond($status, '', $status === 302 ? ['Location' => 'https://evil.example/'] : []);
        $this->respond(200, ['data' => []]);

        try {
            $client->getCategories(7);
            self::fail('Expected an exception.');
        } catch (ChurchToolsException) {
            self::assertCount(1, $this->history);
        }
    }

    // ---------------------------------------------------------------- CC-16 Retry-After

    /**
     * @return iterable<string, array{string|null, int}>
     */
    public static function retryAfterValues(): iterable
    {
        yield 'seconds above the minimum' => ['120', 120];
        yield 'seconds below the minimum' => ['5', 60];
        yield 'zero' => ['0', 60];
        yield 'HTTP date 300 s ahead' => [gmdate('D, d M Y H:i:s', self::NOW + 300) . ' GMT', 300];
        yield 'HTTP date in the past' => [gmdate('D, d M Y H:i:s', self::NOW - 300) . ' GMT', 60];
        yield 'missing' => [null, 60];
        yield 'garbage' => ['soon', 60];
        yield 'negative' => ['-30', 60];
        yield 'several values' => ['120, 30', 60];
    }

    #[DataProvider('retryAfterValues')]
    public function testRetryAfterIsParsedAndNeverBelowTheMinimum(?string $header, int $expected): void
    {
        $client = $this->client();
        $this->mock->append(new Response(429, $header === null ? [] : ['Retry-After' => $header], ''));

        try {
            $client->getCategories(7);
            self::fail('Expected an exception.');
        } catch (RateLimitedException $e) {
            self::assertSame($expected, $e->retryAfterSeconds);
        }
    }
}
