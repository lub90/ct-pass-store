<?php




namespace CtPassStore\Tests\EndToEnd;

use PHPUnit\Framework\TestCase;
use \GuzzleHttp\Client;
use CtPassStore\Tests\EndToEnd\ChurchToolsSandboxManager;
use CtPassStore\Tests\EndToEnd\BackendSandboxManager;

abstract class AccessTestPrototype extends TestCase
{
    private static ChurchToolsSandboxManager $ctBackend;
    private static BackendSandboxManager $thisBackend;

    protected const string AUTH_HEADER_PREFIX = 'Login ';


    public static function setUpBeforeClass(): void {
        self::$ctBackend = new ChurchToolsSandboxManager();
        self::$thisBackend = new BackendSandboxManager();

        self::$ctBackend->start();
        self::$thisBackend->start();
    }

    public static function tearDownAfterClass(): void
    {
        self::$thisBackend->stop();
        self::$ctBackend->stop();
    }

    abstract public function getEndpoint(): string;

    abstract public function getMethods(): array;

    protected function getClient(): Client
    {
        return new Client([
            'base_uri' => self::$thisBackend->getBaseUrl(),
            'http_errors' => false,
        ]);
    }

    /**
     * @dataProvider invalidAuthHeaderProvider
     */
    public function testInvalidAuthHeaderReturns401(?string $authHeader): void
    {
        foreach($this->getMethods() as $method) {
            $this->invalidAuthHeaderReturns401PerMethod($method, $authHeader);
        }
    }

    protected function invalidAuthHeaderReturns401PerMethod(string $method, ?string $authHeader): void {
        $client = $this->getClient();

        $headers = [];
        if ($authHeader !== null) {
            $headers['Authorization'] = $authHeader;
        }

        $response = $client->request($method, $this->getEndpoint(), [
            'headers' => $headers
        ]);

        $this->assertSame(401, $response->getStatusCode(), "Expected 401 for method $method and for header: " . ($authHeader ?? 'none'));

        $body = json_decode((string)$response->getBody(), true);
        $this->assertIsArray($body);
        $this->assertArrayHasKey('error', $body);
        $this->assertArrayHasKey('message', $body);
        $this->assertIsString($body['error']);
        $this->assertIsString($body['message']);
    }

    public static function invalidAuthHeaderProvider(): array
    {
        $ct = new ChurchToolsSandboxManager();

        $tokens = array_merge(
            array_map(fn($u) => $u['token'], $ct->getNormalUsers()),
            array_map(fn($u) => $u['token'], $ct->getAdminUsers()),
            array_map(fn($u) => $u['token'], $ct->getReadAccessUsers())
        );

        $cases = [
            'no header' => [null],
            'empty header' => [''],
            'whitespace-only header' => [' '],
            'only prefix' => [self::AUTH_HEADER_PREFIX],
        ];

        foreach ($tokens as $token) {
            $cases['valid token without prefix ' . $token] = [$token];
            $cases['valid token with extra prefix char ' . $token] = ['X' . self::AUTH_HEADER_PREFIX . $token];
        }

        return $cases;
    }


    /**
     * @dataProvider invalidTokenProvider
     */
    public function testInvalidTokenReturns401(string $authHeader): void
    {
        foreach($this->getMethods() as $method) {
            $this->invalidTokenReturns401PerMethod($method, $authHeader);
        }
    }

    protected function invalidTokenReturns401PerMethod(string $method, string $authHeader): void {
        $client = $this->getClient();

        $response = $client->request($method, $this->getEndpoint(), [
            'headers' => ['Authorization' => $authHeader]
        ]);

        $this->assertSame(401, $response->getStatusCode(), "Expected 401 for method $method and for header: $authHeader");

        $body = json_decode((string)$response->getBody(), true);
        $this->assertIsArray($body);
        $this->assertArrayHasKey('error', $body);
        $this->assertArrayHasKey('message', $body);
        $this->assertIsString($body['error']);
        $this->assertIsString($body['message']);
    }


    public static function invalidTokenProvider(): array
    {
        $ct = new ChurchToolsSandboxManager();

        $unauthorizedTokens = array_map(fn($u) => $u['token'], $ct->getUnauthorizedUsers());
        $invalidTokens = array_map(fn($u) => $u['token'], $ct->getInvalidAccessTokens());

        $validTokens = array_merge(
            array_map(fn($u) => $u['token'], $ct->getNormalUsers()),
            array_map(fn($u) => $u['token'], $ct->getAdminUsers()),
            array_map(fn($u) => $u['token'], $ct->getReadAccessUsers())
        );

        $cases = [];

        // 1. Valid tokens from unauthorized users
        foreach ($unauthorizedTokens as $token) {
            $cases['unauthorized user token ' . $token] = [self::AUTH_HEADER_PREFIX . $token];
        }

        // 2. Invalid tokens (correct prefix)
        foreach ($invalidTokens as $token) {
            $cases['invalid token' . $token] = [self::AUTH_HEADER_PREFIX . $token];
        }

        // 3. Valid tokens with whitespace inserted
        foreach ($validTokens as $token) {
            $cases['valid token with whitespace 1 ' . $token] = [self::AUTH_HEADER_PREFIX . substr($token, 0, 3) . ' ' . substr($token, 3)];
            $cases['valid token with whitespace 2 ' . $token] = [self::AUTH_HEADER_PREFIX . substr($token, 0, 1) . '  ' . substr($token, 1)];
        }

        // 4. Valid tokens with extra characters at beginning or end
        foreach ($validTokens as $token) {
            $cases['valid tokens with extra character at beginning ' . $token] = [self::AUTH_HEADER_PREFIX . 'X' . $token];
            $cases['valid tokens with extra character at end ' . $token] = [self::AUTH_HEADER_PREFIX . $token . 'X'];
        }

        return $cases;
    }


}