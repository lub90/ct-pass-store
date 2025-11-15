<?php




namespace CtPassStore\Tests\EndToEnd;

use PHPUnit\Framework\TestCase;
use CtPassStore\Tests\EndToEnd\ChurchToolsSandboxManager;
use CtPassStore\Tests\EndToEnd\BackendSandboxManager;

class TestAccessTest extends TestCase
{
    private static ChurchToolsSandboxManager $ctBackend;
    private static BackendSandboxManager $thisBackend;
    private string $endpoint = '/test';

    public static function setUpBeforeClass(): void {
        self::$ctBackend = new ChurchToolsSandboxManager();
        self::$thisBackend = new BackendSandboxManager();

        self::$ctBackend->start();
        self::$thisBackend->start();
    }

    /**
     * @dataProvider unauthorizedHeaderProvider
     */
    public function testUnauthorizedAccessReturns401(?string $authHeader): void
    {
        $client = new \GuzzleHttp\Client([
            'base_uri' => self::$thisBackend->getBaseUrl(),
            'http_errors' => false
        ]);

        $headers = [];
        if ($authHeader !== null) {
            $headers['Authorization'] = $authHeader;
        }

        $response = $client->get($this->endpoint, [
            'headers' => $headers
        ]);

        $this->assertEquals(401, $response->getStatusCode(), "Expected 401 for header: " . ($authHeader ?? 'none'));

        $body = json_decode((string)$response->getBody(), true);
        $this->assertIsArray($body);
        $this->assertArrayHasKey('error', $body);
        $this->assertArrayHasKey('message', $body);
        $this->assertIsString($body['error']);
        $this->assertIsString($body['message']);
    }

    public static function unauthorizedHeaderProvider(): array
    {
        $ct = new ChurchToolsSandboxManager();

        $tokens = array_merge(
            array_map(fn($u) => $u['token'], $ct->getNormalUsers()),
            array_map(fn($u) => $u['token'], $ct->getAdminUsers()),
            array_map(fn($u) => $u['token'], $ct->getReadAccessUsers())
        );

        $cases = [
            ['no header', null],
            ['empty header', ''],
            ['only prefix', 'Login'],
        ];

        foreach ($tokens as $token) {
            $cases[] = ['valid token without prefix', $token];
            $cases[] = ['valid token with extra prefix char', 'XLogin ' . $token];
        }

        return array_map(fn($c) => [$c[1]], $cases);
    }


    /**
     * @dataProvider forbiddenHeaderProvider
     */
    public function testForbiddenAccessReturns403(string $authHeader): void
    {
        $client = new \GuzzleHttp\Client([
            'base_uri' => self::$thisBackend->getBaseUrl(),
            'http_errors' => false
        ]);

        $response = $client->get($this->endpoint, [
            'headers' => ['Authorization' => $authHeader]
        ]);

        $this->assertEquals(403, $response->getStatusCode(), "Expected 403 for header: $authHeader");

        $body = json_decode((string)$response->getBody(), true);
        $this->assertIsArray($body);
        $this->assertArrayHasKey('error', $body);
        $this->assertArrayHasKey('message', $body);
        $this->assertIsString($body['error']);
        $this->assertIsString($body['message']);
    }


    public static function forbiddenHeaderProvider(): array
    {
        $ct = new ChurchToolsSandboxManager();

        $unauthorizedTokens = array_map(fn($u) => $u['token'], $ct->getUnauthorizedUsers());
        // TODO: Test
        $invalidTokens = array_map(fn($u) => $u['token'], $ct->getInvalidAccessTokens());

        $validTokens = array_merge(
            array_map(fn($u) => $u['token'], $ct->getNormalUsers()),
            array_map(fn($u) => $u['token'], $ct->getAdminUsers()),
            array_map(fn($u) => $u['token'], $ct->getReadAccessUsers())
        );

        $cases = [];

        // 1. Valid tokens from unauthorized users
        foreach ($unauthorizedTokens as $token) {
            $cases[] = ['Login ' . $token];
        }

        // 2. Invalid tokens (correct prefix)
        foreach ($invalidTokens as $token) {
            $cases[] = ['Login ' . $token];
        }

        // 3. Valid tokens with whitespace inserted
        foreach ($validTokens as $token) {
            $cases[] = ['Login ' . substr($token, 0, 3) . ' ' . substr($token, 3)];
            $cases[] = ['Login ' . substr($token, 0, 1) . '  ' . substr($token, 1)];
        }

        // 4. Valid tokens with extra characters at beginning or end
        foreach ($validTokens as $token) {
            $cases[] = ['Login X' . $token];
            $cases[] = ['Login ' . $token . 'X'];
        }

        return $cases;
    }



    public static function tearDownAfterClass(): void
    {
        self::$thisBackend->stop();
        self::$ctBackend->stop();
    }


}