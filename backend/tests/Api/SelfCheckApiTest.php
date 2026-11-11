<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Api;

use CtPassStore\Http\Problem\ProblemType;
use CtPassStore\Infrastructure\ChurchTools\Exception\NotFoundException;
use CtPassStore\Infrastructure\ChurchTools\Exception\UnavailableException;
use CtPassStore\Infrastructure\Kv\KvSchema;

/**
 * `GET /v1/test`: the admin self-check and its local checks (spec 4.8; catalog TS-01 to TS-07).
 */
final class SelfCheckApiTest extends ApiTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->churchTools->setOAuthClient(self::OAUTH_CLIENT_ID, self::OAUTH_CLIENT_SECRET);
    }

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
            ['Credentials file', 'Log folder', 'Cache folder', 'OAuth and token configuration', 'Settings', 'Public key', 'Password store readable', 'Service user rights', 'OAuth client'],
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

    /** TS-02 */
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

    /** TS-02: a disabled machine client is reported by its id. */
    public function testDisabledMachineClientIsReportedByClientId(): void
    {
        $this->setSettings(['machineClients' => [['id' => 'radius-door', 'name' => 'Door', 'publicKeys' => [], 'permissions' => ['entries:read']]]]);

        $response = $this->request('GET', '/v1/test', self::ADMIN);

        $this->assertOnlyFails('Settings', $response);
        self::assertStringContainsString('radius-door', $this->checks($response)['Settings']['message']);
    }

    /** TS-02: an unknown permission is reported by client id and value. */
    public function testUnknownPermissionIsReportedByClientAndValue(): void
    {
        $this->setSettings(['machineClients' => [['id' => 'radius-door', 'name' => 'Door', 'publicKeys' => [$this->machinePublicKey(self::READER_CLIENT)], 'permissions' => ['entries:write']]]]);

        $response = $this->request('GET', '/v1/test', self::ADMIN);

        $this->assertOnlyFails('Settings', $response);
        $message = $this->checks($response)['Settings']['message'];
        self::assertStringContainsString('radius-door', $message);
        self::assertStringContainsString('entries:write', $message);
    }

    /** The checks bypass the cache, so a fix shows at once (controller ruling). */
    public function testSettingsFixedInChurchToolsShowWithoutWaitingForTheCache(): void
    {
        $this->setSettings(['machineClients' => [['id' => 'radius-door', 'name' => 'Door', 'publicKeys' => [], 'permissions' => []]]]);
        $this->assertOnlyFails('Settings', $this->request('GET', '/v1/test', self::ADMIN));

        // Changed in ChurchTools only; the cache entries of the first request are still there.
        $categoryId = $this->categoryIds[KvSchema::SETTINGS_CATEGORY];
        $this->churchTools->clearValues($categoryId);
        $this->churchTools->seedValue($categoryId, json_encode(['adminUsers' => [self::ADMIN], 'backendUrl' => self::BACKEND_URL, 'passwordLength' => 12, KvSchema::SETTING_REQUIRE_PRIMARY_PASSWORD => false, KvSchema::SETTING_ALLOW_CUSTOM_PASSWORD => true, 'machineClients' => []], JSON_THROW_ON_ERROR));

        self::assertSame(200, $this->request('GET', '/v1/test', self::ADMIN)->getStatusCode());
    }

    /** TS-02 */
    public function testUnreadablePasswordStoreFails(): void
    {
        $this->churchTools->failNextRead($this->categoryIds[KvSchema::PASSWORD_CATEGORY], new NotFoundException('GET customdatavalues: ChurchTools answered 404.'));

        $this->assertOnlyFails('Password store readable', $this->request('GET', '/v1/test', self::ADMIN));
    }

    /** TS-03 */
    public function testAServiceUserWithAdministrativeRightsFails(): void
    {
        $this->churchTools->setServiceUserPermissions(['churchcore' => ['administer settings' => true]]);

        $response = $this->request('GET', '/v1/test', self::ADMIN);

        $this->assertOnlyFails('Service user rights', $response);
        self::assertStringContainsString('administer settings', $this->checks($response)['Service user rights']['message']);
    }

    /** TS-03 */
    public function testAServiceUserWithWriteAccessBeyondThePasswordStoreFails(): void
    {
        $this->churchTools->setServiceUserPermissions([KvSchema::EXTENSION_KEY => ['edit custom data' => [$this->categoryIds[KvSchema::SETTINGS_CATEGORY]]]]);

        $this->assertOnlyFails('Service user rights', $this->request('GET', '/v1/test', self::ADMIN));
    }

    /** TS-02 */
    public function testRejectedOAuthClientFails(): void
    {
        $this->churchTools->setOAuthClient(self::OAUTH_CLIENT_ID, 'another-secret');

        $response = $this->request('GET', '/v1/test', self::ADMIN);

        $this->assertOnlyFails('OAuth client', $response);
        self::assertStringContainsString('client ID or secret rejected', $this->checks($response)['OAuth client']['message']);
        self::assertStringNotContainsString(self::OAUTH_CLIENT_SECRET, (string) $response->getBody());
    }

    public function testOAuthClientCheckFailsWithTheReasonWhenChurchToolsIsDown(): void
    {
        $this->churchTools->failNext('exchangeAuthorizationCode', new UnavailableException('POST oauth/access_token: ChurchTools is unreachable (ConnectException).'));

        $this->assertOnlyFails('OAuth client', $this->request('GET', '/v1/test', self::ADMIN));
    }

    /** The check sends a made-up code with the configured redirect URI and prints no ciphertext. */
    public function testOAuthCheckUsesAMadeUpCodeAndNoCiphertextIsPrinted(): void
    {
        $body = (string) $this->request('GET', '/v1/test', self::ADMIN)->getBody();

        $exchange = array_values(array_filter($this->churchTools->calls(), static fn(array $c): bool => $c['method'] === 'exchangeAuthorizationCode'));
        self::assertCount(1, $exchange);
        self::assertSame('https://example.church.tools/ccm/ctpassstore/', $exchange[0]['args'][1]);
        self::assertDoesNotMatchRegularExpression('~[A-Za-z0-9+/]{300,}~', $body);
    }

    /**
     * @return list<array<string, mixed>> the values with the reserved personId 0 in the fake KV store
     */
    private function selfTestValues(): array
    {
        return array_values(array_filter(
            $this->storedEntries(),
            static fn(array $entry): bool => ($entry[KvSchema::ENTRY_PERSON_ID] ?? null) === 0,
        ));
    }

    /** TS-06 */
    public function testWriteUsesReservedPersonZeroAndCleansUp(): void
    {
        $this->seedEntry(self::USER, 'cmVhbA==');
        $before = $this->storedEntries();

        $response = $this->request('GET', '/v1/test?write=1', self::ADMIN);

        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame('ok', $this->checks($response)['Write round trip']['status']);
        $writes = array_values(array_filter(
            $this->churchTools->calls(),
            static fn(array $call): bool => $call['method'] === 'createValue',
        ));
        self::assertCount(1, $writes);
        $created = json_decode((string) $writes[0]['args'][2], true);
        self::assertSame(0, $created[KvSchema::ENTRY_PERSON_ID]);
        self::assertNotSame('', $created[KvSchema::ENTRY_CIPHERTEXT]);
        self::assertStringNotContainsString($created[KvSchema::ENTRY_CIPHERTEXT], (string) $response->getBody());
        self::assertSame([], $this->selfTestValues());
        self::assertSame($before, $this->storedEntries());
    }

    /** TS-06 */
    public function testWithoutWriteNothingIsWritten(): void
    {
        foreach (['/v1/test', '/v1/test?write=0', '/v1/test?write=true', '/v1/test?write=1&write=0', '/v1/test?write'] as $path) {
            $response = $this->request('GET', $path, self::ADMIN);

            self::assertArrayNotHasKey('Write round trip', $this->checks($response), $path);
        }
        self::assertSame(0, $this->churchTools->writeCount());
    }

    /** TS-06 */
    public function testDeletedEvenWhenReadBackFails(): void
    {
        $this->seedEntry(self::USER, 'cmVhbA==');
        $before = $this->storedEntries();
        $this->churchTools->failReadAfterNextCreate($this->categoryIds[KvSchema::PASSWORD_CATEGORY], new UnavailableException('ChurchTools is down.'));

        $response = $this->request('GET', '/v1/test?write=1', self::ADMIN);

        self::assertSame(207, $response->getStatusCode(), (string) $response->getBody());
        $check = $this->checks($response)['Write round trip'];
        self::assertSame('fail', $check['status']);
        self::assertStringContainsString('write round trip failed', $check['message']);
        self::assertSame(1, $this->churchTools->countCalls(['createValue']));
        self::assertSame(1, $this->churchTools->countCalls(['deleteValue']));
        self::assertSame([], $this->selfTestValues());
        self::assertSame($before, $this->storedEntries());
    }

    /** TS-06, TS-07 */
    public function testFailedDeleteIsReportedAndTheNextRunRemovesIt(): void
    {
        $this->churchTools->failNext('deleteValue', new UnavailableException('ChurchTools is down.'));

        $response = $this->request('GET', '/v1/test?write=1', self::ADMIN);

        self::assertSame(207, $response->getStatusCode(), (string) $response->getBody());
        $check = $this->checks($response)['Write round trip'];
        self::assertSame('fail', $check['status']);
        self::assertStringContainsString('The test value could not be deleted again', $check['message']);
        self::assertCount(1, $this->selfTestValues());

        $next = $this->request('GET', '/v1/test?write=1', self::ADMIN);

        self::assertSame(200, $next->getStatusCode(), (string) $next->getBody());
        self::assertSame([], $this->selfTestValues());
    }

    /** TS-07 */
    public function testLeftoverIsRemovedByTheNextRun(): void
    {
        $this->seedEntry(0, 'bGVmdG92ZXI=');
        $this->seedEntry(self::USER, 'cmVhbA==');

        // Until then it disturbs nobody (ST-22).
        self::assertSame(200, $this->request('GET', '/v1/test', self::ADMIN)->getStatusCode());
        self::assertCount(1, $this->selfTestValues());

        $response = $this->request('GET', '/v1/test?write=1', self::ADMIN);

        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame([], $this->selfTestValues());
        self::assertCount(1, $this->storedEntries());
    }
}
