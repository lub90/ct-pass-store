<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Api;

use CtPassStore\Http\Problem\ProblemType;
use CtPassStore\Infrastructure\Kv\KvSchema;
use PHPUnit\Framework\Attributes\DataProvider;

/**
 * The authentication and authorization pipeline (spec 4.1, 4.3, 4.4a): catalog AZ-01, AZ-03 to AZ-10, AZ-12, PR-01,
 * MC-15 and the bearer header rules.
 */
final class AuthorizationApiTest extends ApiTestCase
{
    // ---------------------------------------------------------------- AZ-01, AZ-03, AZ-07, MC-15: the matrix

    /**
     * Spec 4.3 matrix. For machine clients, "own" doesn't exist: they're checked against person USER's entry.
     *
     * @return iterable<string, array{int|string, string, int, bool}>
     */
    public static function matrix(): iterable
    {
        $callers = [
            'user' => [self::USER, ['own' => true, 'other' => false], ['own' => true, 'other' => false]],
            'admin' => [self::ADMIN, ['own' => true, 'other' => true], ['own' => true, 'other' => true]],
            'machine with entries:read' => [self::READER_CLIENT, ['own' => true, 'other' => true], ['own' => false, 'other' => false]],
            'machine without permissions' => [self::NO_RIGHTS_CLIENT, ['own' => false, 'other' => false], ['own' => false, 'other' => false]],
        ];
        foreach ($callers as $name => [$caller, $read, $change]) {
            foreach (['own', 'other'] as $whose) {
                $target = match (true) {
                    $whose === 'own' && is_int($caller) => $caller,
                    $whose === 'own' => self::USER,
                    default => self::OTHER,
                };
                yield "$name, GET $whose" => [$caller, 'GET', $target, $read[$whose]];
                yield "$name, PUT $whose" => [$caller, 'PUT', $target, $change[$whose]];
                yield "$name, DELETE $whose" => [$caller, 'DELETE', $target, $change[$whose]];
            }
        }
    }

    #[DataProvider('matrix')]
    public function testAccessMatrix(int|string $caller, string $method, int $target, bool $allowed): void
    {
        $this->seedEntry($target, 'c2VlZA==');

        $response = $this->request($method, '/v1/entries/' . $target, $caller, $method === 'GET' ? null : []);

        if ($allowed) {
            self::assertContains($response->getStatusCode(), [200, 204], (string) $response->getBody());
        } else {
            $this->assertProblem(ProblemType::Forbidden, $response);
            self::assertSame(0, $this->churchTools->writeCount(), 'AZ-07: a 403 writes nothing.');
        }
    }

    // ---------------------------------------------------------------- AZ-12

    public function testAMachineClientNamedLikeAPersonHasNoOwnEntry(): void
    {
        $this->setSettings([KvSchema::SETTING_MACHINE_CLIENTS => [
            ['id' => '100', 'publicKeys' => [$this->machinePublicKey(self::NO_RIGHTS_CLIENT)], 'permissions' => []],
        ]]);
        $token = fn(): string => 'Bearer ' . $this->machineTokenOf('100', keyOf: self::NO_RIGHTS_CLIENT);

        $this->assertProblem(ProblemType::Forbidden, $this->request('GET', '/v1/entries/100', headers: ['Authorization' => $token()]));
        $this->assertProblem(ProblemType::Forbidden, $this->request('PUT', '/v1/entries/100', null, [], ['Authorization' => $token()]));
        self::assertSame(0, $this->churchTools->writeCount());
    }

    public function testAPersonWhoseIdEqualsAClientIdGetsNoneOfItsRights(): void
    {
        // Client "123" may read every entry. Person 123 is an ordinary user; the two are never compared (spec 4.3).
        $this->setSettings([KvSchema::SETTING_MACHINE_CLIENTS => [
            ['id' => '123', 'publicKeys' => [$this->machinePublicKey(self::READER_CLIENT)], 'permissions' => ['entries:read']],
        ]]);
        $this->seedEntry(self::OTHER);

        self::assertSame(200, $this->request('GET', '/v1/entries/' . self::OTHER, headers: ['Authorization' => 'Bearer ' . $this->machineTokenOf('123', keyOf: self::READER_CLIENT)])->getStatusCode(), 'The client itself may read.');
        $this->assertProblem(ProblemType::Forbidden, $this->request('GET', '/v1/entries/' . self::OTHER, 123));
        self::assertSame(204, $this->request('PUT', '/v1/entries/123', 123, ['secondaryPwd' => 'Custom-pass12!'])->getStatusCode(), 'Person 123 still owns entry 123.');
    }

    // ---------------------------------------------------------------- AZ-04, AZ-05

    public function testAdminRightsFollowTheCurrentSettings(): void
    {
        $token = $this->tokenOf(self::USER);
        $asUser = ['Authorization' => 'Bearer ' . $token];

        $this->assertProblem(ProblemType::Forbidden, $this->request('GET', '/v1/entries/' . self::OTHER, headers: $asUser));

        $this->setSettings(['adminUsers' => [self::USER]]);
        $this->seedEntry(self::OTHER);
        self::assertSame(200, $this->request('GET', '/v1/entries/' . self::OTHER, headers: $asUser)->getStatusCode(), 'AZ-05: no new login needed.');

        $this->setSettings(['adminUsers' => []]);
        // AZ-04: the token is still valid, but the rights are gone.
        $this->assertProblem(ProblemType::Forbidden, $this->request('GET', '/v1/entries/' . self::OTHER, headers: $asUser));
    }

    // ---------------------------------------------------------------- AZ-06

    public function testAuthenticationMakesNoChurchToolsCall(): void
    {
        $this->seedEntry(self::USER);

        $this->request('GET', '/v1/entries/' . self::USER, self::USER);
        $this->request('GET', '/v1/entries/' . self::OTHER, self::READER_CLIENT);

        self::assertSame(0, $this->churchTools->countCalls(['whoami', 'globalPermissions', 'verifyLogin', 'exchangeAuthorizationCode']));
    }

    // ---------------------------------------------------------------- AZ-08, bearer header rules (spec 4.3.2)

    /**
     * @return iterable<string, array{string}>
     */
    public static function invalidHeaders(): iterable
    {
        yield 'Login scheme' => ['Login some-login-token'];
        yield 'Basic scheme' => ['Basic dXNlcjpwYXNz'];
        yield 'no scheme' => ['TOKEN'];
        yield 'empty token' => ['Bearer '];
        yield 'only scheme' => ['Bearer'];
        yield 'two spaces' => ['Bearer  TOKEN'];
        yield 'whitespace in token' => ['Bearer TOK EN'];
        yield 'tab in token' => ["Bearer TOK\tEN"];
        yield 'comma-joined' => ['Bearer TOKEN, Bearer TOKEN'];
        // A trailing space isn't listed: HTTP strips optional whitespace around field values (RFC 9110 5.5).
        yield 'not a JWT' => ['Bearer abc.def'];
        yield 'scheme with colon' => ['Bearer: TOKEN'];
        yield 'scheme typo' => ['Bearers TOKEN'];
        yield 'scheme without space' => ['BearerTOKEN'];
    }

    #[DataProvider('invalidHeaders')]
    public function testInvalidAuthorizationHeaders(string $header): void
    {
        $header = str_replace('TOKEN', $this->tokenOf(self::USER), $header);

        $response = $this->request('GET', '/v1/entries/' . self::USER, headers: ['Authorization' => $header]);

        $this->assertProblem(ProblemType::InvalidToken, $response);
    }

    public function testTheSchemeIsCaseInsensitive(): void
    {
        $this->seedEntry(self::USER);

        foreach (['bearer', 'BEARER', 'Bearer', 'bEaReR'] as $scheme) {
            $response = $this->request('GET', '/v1/entries/' . self::USER, headers: ['Authorization' => $scheme . ' ' . $this->tokenOf(self::USER)]);
            self::assertSame(200, $response->getStatusCode(), $scheme);
        }
    }

    public function testSeveralAuthorizationHeadersAreRejected(): void
    {
        $request = (new \Slim\Psr7\Factory\ServerRequestFactory())
            ->createServerRequest('GET', 'https://backend.example.org/v1/entries/' . self::USER, ['REMOTE_ADDR' => self::CLIENT_IP])
            ->withHeader('Authorization', 'Bearer ' . $this->tokenOf(self::USER))
            ->withAddedHeader('Authorization', 'Bearer ' . $this->tokenOf(self::ADMIN));

        $this->assertProblem(ProblemType::InvalidToken, $this->send($request));
    }

    public function testInvalidTokensAreLoggedWithTheClientIp(): void
    {
        $this->request('GET', '/v1/entries/' . self::USER, headers: ['Authorization' => 'Bearer abc.def.ghi']);

        $records = array_filter($this->log->getRecords(), static fn(array $r): bool => str_contains((string) $r['message'], 'Unauthorized'));
        self::assertNotEmpty($records);
        self::assertSame(self::CLIENT_IP, array_values($records)[0]['context']['ip']);
    }

    /**
     * IJ-07: forwarding headers are never trusted; the logged IP is always REMOTE_ADDR (spec 6.3).
     */
    public function testForwardingHeadersDontChangeTheLoggedIp(): void
    {
        $this->request('GET', '/v1/entries/' . self::USER, headers: [
            'Authorization' => 'Bearer abc.def.ghi',
            'X-Forwarded-For' => '198.51.100.1',
            'X-Real-IP' => '198.51.100.2',
            'Forwarded' => 'for=198.51.100.3',
        ]);

        $ips = array_map(static fn(array $r): mixed => $r['context']['ip'] ?? null, $this->log->getRecords());
        self::assertContains(self::CLIENT_IP, $ips);
        self::assertSame([], array_filter($ips, static fn(mixed $ip): bool => is_string($ip) && str_starts_with($ip, '198.51.100.')));
    }

    // ---------------------------------------------------------------- AZ-09, TK-15 at the API

    public function testAnExpiredUserTokenIsTokenExpired(): void
    {
        $token = $this->tokenOf(self::USER);
        $this->clock->advance(900 + 31);

        $this->assertProblem(ProblemType::TokenExpired, $this->request('GET', '/v1/entries/' . self::USER, headers: ['Authorization' => 'Bearer ' . $token]));
    }

    public function testAnExpiredMachineTokenIsTokenExpired(): void
    {
        $now = $this->clock->timestamp();
        $token = $this->machineTokenOf(self::READER_CLIENT, ['iat' => $now - 100, 'exp' => $now - 40]);

        $this->assertProblem(ProblemType::TokenExpired, $this->request('GET', '/v1/entries/' . self::USER, headers: ['Authorization' => 'Bearer ' . $token]));
    }

    // ---------------------------------------------------------------- machine tokens at the API (MC-09, MC-20)

    public function testAMachineTokenWorksOnlyOnce(): void
    {
        $this->seedEntry(self::USER);
        $header = ['Authorization' => 'Bearer ' . $this->machineTokenOf(self::READER_CLIENT)];

        self::assertSame(200, $this->request('GET', '/v1/entries/' . self::USER, headers: $header)->getStatusCode());
        $this->assertProblem(ProblemType::InvalidToken, $this->request('GET', '/v1/entries/' . self::USER, headers: $header));
    }

    public function testWithoutBackendUrlMachinesAreRefusedButUsersAreNot(): void
    {
        $this->setSettings(['backendUrl' => null]);
        $this->seedEntry(self::USER);

        $this->assertProblem(ProblemType::Misconfigured, $this->request('GET', '/v1/entries/' . self::USER, self::READER_CLIENT));
        self::assertSame(200, $this->request('GET', '/v1/entries/' . self::USER, self::USER)->getStatusCode());
    }

    public function testAnInvalidBackendUrlRefusesMachinesButNotUsers(): void
    {
        $this->setSettings(['backendUrl' => 'http://backend.example.org/ctpassstore', 'adminUsers' => [self::ADMIN]]);
        $this->seedEntry(self::OTHER);

        $this->assertProblem(ProblemType::Misconfigured, $this->request('GET', '/v1/entries/' . self::OTHER, self::READER_CLIENT));
        self::assertSame(200, $this->request('GET', '/v1/entries/' . self::OTHER, self::ADMIN)->getStatusCode(), 'Admins still work.');
        self::assertSame(204, $this->request('PUT', '/v1/entries/' . self::USER, self::USER, ['secondaryPwd' => 'Custom-pass12!'])->getStatusCode(), 'Users still change their entry.');
    }

    public function testADisabledClientGets401AndTheLogSaysWhy(): void
    {
        $token = $this->machineTokenOf(self::READER_CLIENT);
        $this->setSettings([KvSchema::SETTING_MACHINE_CLIENTS => [
            ['id' => self::READER_CLIENT, 'publicKeys' => [], 'permissions' => ['entries:read']],
        ]]);

        $this->assertProblem(ProblemType::InvalidToken, $this->request('GET', '/v1/entries/' . self::USER, headers: ['Authorization' => 'Bearer ' . $token]));
        self::assertTrue($this->log->hasWarningThatContains('Machine client ct-radius is disabled: publicKeys must be a non-empty list.'));
    }

    public function testAnUnusableReplayCacheRefusesMachines(): void
    {
        file_put_contents($this->cacheDir, 'a file where the folder should be');
        try {
            $this->assertProblem(ProblemType::Misconfigured, $this->request('GET', '/v1/entries/' . self::USER, self::READER_CLIENT));
        } finally {
            unlink($this->cacheDir);
        }
    }

    // ---------------------------------------------------------------- AZ-10, /v1 (Q20)

    /**
     * @return iterable<string, array{string, string}>
     */
    public static function protectedEndpoints(): iterable
    {
        yield 'GET entry' => ['GET', '/v1/entries/' . self::USER];
        yield 'PUT entry' => ['PUT', '/v1/entries/' . self::USER];
        yield 'DELETE entry' => ['DELETE', '/v1/entries/' . self::USER];
        yield 'self-check' => ['GET', '/v1/test'];
    }

    #[DataProvider('protectedEndpoints')]
    public function testEveryEndpointExceptLoginNeedsAToken(string $method, string $path): void
    {
        $this->assertProblem(ProblemType::MissingToken, $this->request($method, $path));
    }

    public function testMachineClientsCantRunTheSelfCheck(): void
    {
        $this->assertProblem(ProblemType::Forbidden, $this->request('GET', '/v1/test', self::READER_CLIENT));
    }

    /**
     * @return iterable<string, array{string, string}>
     */
    public static function oldPaths(): iterable
    {
        yield 'GET entry' => ['GET', '/entries/' . self::USER];
        yield 'PUT entry' => ['PUT', '/entries/' . self::USER];
        yield 'self-check' => ['GET', '/test'];
        yield 'login without prefix' => ['POST', '/auth/token'];
    }

    #[DataProvider('oldPaths')]
    public function testOldPathsWithoutPrefixAreUnknown(string $method, string $path): void
    {
        $this->assertProblem(ProblemType::NotFound, $this->request($method, $path, self::USER));
    }

    // ---------------------------------------------------------------- PR-01 order of checks (spec 4.1)

    public function testOrderOfChecks(): void
    {
        $this->assertProblem(ProblemType::NotFound, $this->request('GET', '/v1/nothing'));
        $this->assertProblem(ProblemType::MethodNotAllowed, $this->request('PATCH', '/v1/entries/' . self::USER));
        $this->assertProblem(ProblemType::MissingToken, $this->request('GET', '/v1/entries/abc'));
        $this->assertProblem(ProblemType::InvalidId, $this->request('GET', '/v1/entries/abc', self::USER));
        $this->assertProblem(ProblemType::InvalidBody, $this->rawRequest('PUT', '/v1/entries/' . self::OTHER, self::USER, '{"nope": 1}'));
        $this->assertProblem(ProblemType::Forbidden, $this->request('PUT', '/v1/entries/' . self::OTHER, self::USER, []));
    }

}
