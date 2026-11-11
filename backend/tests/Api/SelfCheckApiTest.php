<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Api;

use CtPassStore\Http\Problem\ProblemType;

/**
 * `GET /v1/test`: the admin self-check and its local checks (spec 4.8; catalog TS-01 to TS-07).
 */
final class SelfCheckApiTest extends ApiTestCase
{
    /**
     * @return array<string, array<string, mixed>> the tests of the response by name
     */
    private function checks(\Psr\Http\Message\ResponseInterface $response): array
    {
        $byName = [];
        foreach ($this->json($response)['tests'] as $test) {
            $byName[$test['name']] = $test;
        }

        return $byName;
    }

    /**
     * Asserts 207 with exactly this check failing.
     */
    private function assertOnlyFails(string $name, \Psr\Http\Message\ResponseInterface $response): void
    {
        self::assertSame(207, $response->getStatusCode(), (string) $response->getBody());
        $failed = array_keys(array_filter($this->checks($response), static fn(array $t): bool => $t['status'] === 'fail'));
        self::assertSame([$name], $failed);
    }

    /** TS-01 */
    public function testAdminGets200WithVersion(): void
    {
        $response = $this->request('GET', '/v1/test', self::ADMIN);

        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
        $body = $this->json($response);
        self::assertSame('0.1.0+test', $body['version']);
        self::assertIsString($body['summary']);
        self::assertSame(
            ['Credentials file', 'Log folder', 'Cache folder', 'OAuth and token configuration', 'Settings', 'Public key'],
            array_keys($this->checks($response)),
        );
        foreach ($this->checks($response) as $name => $test) {
            self::assertSame('ok', $test['status'], $name . ': ' . $test['message']);
        }
    }

    public function testNormalUserGets403(): void
    {
        $this->assertProblem(ProblemType::Forbidden, $this->request('GET', '/v1/test', self::USER));
    }

    /** TS-05 */
    public function testMachineClientGets403(): void
    {
        $this->assertProblem(ProblemType::Forbidden, $this->request('GET', '/v1/test', self::READER_CLIENT));
    }

    public function testBrokenSettingsAreReportedAs207(): void
    {
        // An admin can only get here with valid settings; a broken public key is the reachable failure.
        $this->setPublicKey('not a key');

        $this->assertOnlyFails('Public key', $this->request('GET', '/v1/test', self::ADMIN));
    }

    public function testRequiresAuthentication(): void
    {
        $this->assertProblem(ProblemType::MissingToken, $this->request('GET', '/v1/test'));
    }

    public function testCredentialsReadableByOthersFails(): void
    {
        chmod($this->credentialsPath, 0o604);

        $response = $this->request('GET', '/v1/test', self::ADMIN);

        $this->assertOnlyFails('Credentials file', $response);
        self::assertStringNotContainsString($this->credentialsPath, (string) $response->getBody());
    }

    public function testGroupReadableCredentialsPass(): void
    {
        chmod($this->credentialsPath, 0o640);

        self::assertSame(200, $this->request('GET', '/v1/test', self::ADMIN)->getStatusCode());
    }

    public function testUnwritableLogFolderFails(): void
    {
        chmod($this->logDir, 0o500);

        $this->assertOnlyFails('Log folder', $this->request('GET', '/v1/test', self::ADMIN));
    }

    public function testMissingLogFolderFails(): void
    {
        rmdir($this->logDir);

        $this->assertOnlyFails('Log folder', $this->request('GET', '/v1/test', self::ADMIN));
        mkdir($this->logDir, 0o700);
    }

    public function testCacheFolderWritableByOthersFails(): void
    {
        mkdir($this->cacheDir, 0o700);
        chmod($this->cacheDir, 0o770 | 0o002);

        $this->assertOnlyFails('Cache folder', $this->request('GET', '/v1/test', self::ADMIN));
    }

    public function testCacheFileLimitFails(): void
    {
        mkdir($this->cacheDir, 0o700);
        for ($i = 0; $i <= 10000; $i++) {
            touch($this->cacheDir . '/filler-' . $i);
        }

        $response = $this->request('GET', '/v1/test', self::ADMIN);

        $this->assertOnlyFails('Cache folder', $response);
        self::assertStringContainsString('files', $this->checks($response)['Cache folder']['message']);
        foreach (glob($this->cacheDir . '/filler-*') ?: [] as $file) {
            unlink($file);
        }
    }

    public function testCacheFolderReportsFileCount(): void
    {
        $response = $this->request('GET', '/v1/test', self::ADMIN);

        self::assertMatchesRegularExpression('/\d+ files/', $this->checks($response)['Cache folder']['message']);
    }

    public function testShortJwtSecretFails(): void
    {
        // The configuration is validated at startup; the check also covers a config built another way.
        $config = new \CtPassStore\Config\BackendConfig('https://example.church.tools/api', 'service-token', [self::ORIGIN], $this->credentialsPath, $this->cacheDir, self::OAUTH_CLIENT_ID, self::OAUTH_CLIENT_SECRET, 'short');

        $result = (new \CtPassStore\Infrastructure\SelfCheck\OAuthConfigurationCheck($config))->run();

        self::assertFalse($result->ok);
        self::assertStringNotContainsString('short', $result->message);
    }

    /** TS-04 */
    public function testResponseHasNoSecretsOrAbsolutePaths(): void
    {
        chmod($this->credentialsPath, 0o604);
        chmod($this->logDir, 0o500);

        $body = (string) $this->request('GET', '/v1/test', self::ADMIN)->getBody();

        foreach (['JWT_SECRET=', self::JWT_SECRET, self::OAUTH_CLIENT_SECRET, 'service-token', sys_get_temp_dir()] as $forbidden) {
            self::assertStringNotContainsString($forbidden, $body);
        }
    }
}
