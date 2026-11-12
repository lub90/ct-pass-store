<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Api;

use CtPassStore\Http\Problem\ProblemType;
use CtPassStore\Infrastructure\ChurchTools\Exception\UnavailableException;
use Psr\Http\Message\ResponseInterface;

/**
 * The web-cron endpoint `POST /v1/cleanup` (cleanup design 5; catalog WC-01 to WC-16).
 */
final class CleanupApiTest extends ApiTestCase
{
    private const TOKEN = 'b4d1c0ffee0123456789abcdef0123456789abcdef0123456789abcdef012345';
    private const GONE = 4711;
    private const ALSO_GONE = 4712;

    protected function setUp(): void
    {
        parent::setUp();
        $this->cleanupToken = self::TOKEN;
    }

    private function cleanup(string $query = '', ?string $token = self::TOKEN): ResponseInterface
    {
        return $this->request('POST', '/v1/cleanup' . $query, null, null, $token === null ? [] : ['Authorization' => 'Bearer ' . $token]);
    }

    private function callCount(): int
    {
        return count($this->churchTools->calls());
    }

    /**
     * @return list<int>
     */
    private function storedPersonIds(): array
    {
        $ids = array_map(static fn(array $entry): int => (int) $entry['personId'], $this->storedEntries());
        sort($ids);

        return $ids;
    }

    /** WC-01 */
    public function testOffWithoutTokenLooksLikeAnUnknownRoute(): void
    {
        foreach ([null, str_repeat('a', 42)] as $token) {
            $this->cleanupToken = $token;
            foreach (['POST', 'GET', 'PUT', 'DELETE', 'HEAD'] as $method) {
                $unknown = $this->request($method, '/v1/nope', null, null, ['Authorization' => 'Bearer ' . self::TOKEN]);
                foreach (['', '?apply=1', '?token=x'] as $query) {
                    $response = $this->request($method, '/v1/cleanup' . $query, null, null, ['Authorization' => 'Bearer ' . ($token ?? self::TOKEN)]);

                    self::assertSame(404, $response->getStatusCode(), $method);
                    self::assertSame($unknown->getStatusCode(), $response->getStatusCode(), $method);
                    self::assertSame($unknown->getHeaders(), $response->getHeaders(), $method);
                    self::assertSame(str_replace('/v1/nope', '/v1/cleanup', (string) $unknown->getBody()), (string) $response->getBody(), $method);
                }
            }
        }
        self::assertSame(0, $this->callCount());
    }

    /** WC-02 */
    public function testWrongOrMissingTokenIs401(): void
    {
        $this->seedEntry(self::GONE);
        $calls = $this->callCount();
        $cases = [
            'missing' => [],
            'wrong' => ['Authorization' => 'Bearer ' . strrev(self::TOKEN)],
            'prefix' => ['Authorization' => 'Bearer ' . substr(self::TOKEN, 0, 43)],
            'longer' => ['Authorization' => 'Bearer ' . self::TOKEN . 'x'],
            'basic' => ['Authorization' => 'Basic ' . self::TOKEN],
            'no scheme' => ['Authorization' => self::TOKEN],
            'two tokens' => ['Authorization' => 'Bearer ' . self::TOKEN . ', Bearer ' . self::TOKEN],
        ];
        foreach ($cases as $name => $headers) {
            $response = $this->request('POST', '/v1/cleanup?apply=1', null, null, $headers);

            $this->assertProblem(ProblemType::InvalidToken, $response);
            self::assertStringNotContainsString(self::TOKEN, (string) $response->getBody(), $name);
        }

        self::assertSame($calls, $this->callCount(), 'Nothing ran.');
        self::assertSame([self::GONE], $this->storedPersonIds());
        foreach ($this->log->getRecords() as $record) {
            self::assertStringNotContainsString(substr(self::TOKEN, 0, 20), $record['message'] . json_encode($record['context']));
        }
        self::assertTrue($this->log->hasWarningThatContains('cleanup'), 'The refusal is logged.');
    }

    /** WC-03 */
    public function testWrongTokensHitTheAddressLimit(): void
    {
        for ($i = 0; $i < 60; $i++) {
            $this->assertProblem(ProblemType::InvalidToken, $this->cleanup('', 'wrong-' . $i));
        }

        $response = $this->cleanup('', 'wrong-again');

        $this->assertProblem(ProblemType::TooManyAttempts, $response);
        self::assertNotSame('', $response->getHeaderLine('Retry-After'));
        // The right token isn't counted and passes even from the blocked address: a garbage sender behind the same
        // egress address can't lock out the real cron.
        self::assertSame(200, $this->cleanup()->getStatusCode());
        $this->assertProblem(ProblemType::TooManyAttempts, $this->cleanup('', 'wrong-after'));
        // Another address isn't affected.
        $this->clientIp = '198.51.100.9';
        $this->assertProblem(ProblemType::InvalidToken, $this->cleanup('', 'wrong'));
    }

    /** WC-04 */
    public function testBackendJwtIsNotAccepted(): void
    {
        $this->assertProblem(ProblemType::InvalidToken, $this->request('POST', '/v1/cleanup', self::ADMIN));
        $this->assertProblem(ProblemType::InvalidToken, $this->request('POST', '/v1/cleanup', self::READER_CLIENT));
    }

    /** WC-05 */
    public function testTokenInQueryIsRefused(): void
    {
        foreach (['?token=' . self::TOKEN, '?apply=1&token=x', '?token'] as $query) {
            $body = $this->assertProblem(ProblemType::InvalidBody, $this->cleanup($query));
            self::assertStringContainsString('Authorization header', (string) $body['detail']);
        }
        $this->assertProblem(ProblemType::InvalidBody, $this->cleanup('?token=' . self::TOKEN, null));
        self::assertSame(0, $this->churchTools->countCalls(['activePersonIds', 'personStatus']));
    }

    /** WC-06 */
    public function testInvalidApplyIsRefused(): void
    {
        $this->seedEntry(self::GONE);
        foreach (['?apply=0', '?apply=true', '?apply=', '?apply', '?apply[]=1', '?apply=1%20', '?apply=01'] as $query) {
            $this->assertProblem(ProblemType::InvalidBody, $this->cleanup($query));
        }
        self::assertSame(0, $this->churchTools->countCalls(['activePersonIds', 'personStatus']));
        self::assertSame([self::GONE], $this->storedPersonIds());
    }

    /** WC-07 */
    public function testDryRunDeletesNothing(): void
    {
        $this->seedEntry(self::USER);
        $this->seedEntry(self::GONE);
        $writes = $this->churchTools->writeCount();

        $response = $this->cleanup();

        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame('application/json', $response->getHeaderLine('Content-Type'));
        self::assertSame(
            ['applied' => false, 'complete' => true, 'checked' => 2, 'gone' => 1, 'deleted' => 0, 'failedDeletes' => 0, 'goneAdmins' => 0],
            $this->json($response),
        );
        self::assertSame($writes, $this->churchTools->writeCount());
        self::assertSame([self::USER, self::GONE], $this->storedPersonIds());
    }

    /** WC-08 */
    public function testApplyDeletes(): void
    {
        $this->seedEntry(self::USER);
        $this->seedEntry(self::GONE);
        $this->churchTools->addPerson(self::ALSO_GONE, archived: true);
        $this->seedEntry(self::ALSO_GONE);

        $response = $this->cleanup('?apply=1');

        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame(
            ['applied' => true, 'complete' => true, 'checked' => 3, 'gone' => 2, 'deleted' => 2, 'failedDeletes' => 0, 'goneAdmins' => 0],
            $this->json($response),
        );
        self::assertSame([self::USER], $this->storedPersonIds());
    }

    /** WC-09 */
    public function testBodyHasCountsOnly(): void
    {
        $this->setSettings(['adminUsers' => [self::ADMIN, 4713]]);
        $this->seedEntry(self::USER);
        $this->seedEntry(self::GONE);
        $this->seedEntry(self::ALSO_GONE);

        $response = $this->cleanup('?apply=1');

        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
        $body = (string) $response->getBody();
        self::assertSame(1, $this->json($response)['goneAdmins']);
        foreach ([self::USER, self::ADMIN, self::GONE, self::ALSO_GONE, 4713] as $id) {
            self::assertStringNotContainsString((string) $id, $body);
        }
    }

    /** WC-10 */
    public function testCooldown(): void
    {
        self::assertSame(200, $this->cleanup()->getStatusCode());
        $this->clock->advance(599);
        $calls = $this->callCount();

        $response = $this->cleanup('?apply=1');

        $body = $this->assertProblem(ProblemType::CleanupTooSoon, $response);
        self::assertSame('1', $response->getHeaderLine('Retry-After'));
        self::assertSame(1, $body['retryAfter']);
        self::assertSame($calls, $this->callCount());

        $this->clock->advance(1);
        self::assertSame(200, $this->cleanup('?apply=1')->getStatusCode());

        $response = $this->cleanup();
        $this->assertProblem(ProblemType::CleanupTooSoon, $response);
        self::assertSame('600', $response->getHeaderLine('Retry-After'));
    }

    /** WC-11 */
    public function testFailedRunStillStartsTheCooldown(): void
    {
        $this->seedEntry(self::GONE);
        $this->churchTools->failNext('activePersonIds', new UnavailableException('POST persons: unreachable.'));

        $this->assertProblem(ProblemType::UpstreamUnavailable, $this->cleanup('?apply=1'));
        $calls = $this->callCount();

        $this->assertProblem(ProblemType::CleanupTooSoon, $this->cleanup('?apply=1'));
        self::assertSame($calls, $this->callCount());
        self::assertSame([self::GONE], $this->storedPersonIds());
    }

    /** WC-12 */
    public function testRunningIs409(): void
    {
        $this->seedEntry(self::GONE);
        @mkdir($this->cacheDir, 0o700, true);
        $held = fopen($this->cacheDir . '/cleanup.lock', 'c');
        self::assertNotFalse($held);
        self::assertTrue(flock($held, LOCK_EX));
        try {
            $calls = $this->callCount();
            $this->assertProblem(ProblemType::CleanupRunning, $this->cleanup('?apply=1'));
            self::assertSame($calls, $this->callCount());
        } finally {
            flock($held, LOCK_UN);
            fclose($held);
        }

        $this->assertProblem(ProblemType::CleanupTooSoon, $this->cleanup('?apply=1'));
        self::assertSame([self::GONE], $this->storedPersonIds());
    }

    /** WC-13 */
    public function testDeadlineGivesIncomplete(): void
    {
        $this->seedEntry(self::GONE);
        $this->seedEntry(self::ALSO_GONE);
        $this->churchTools->beforeNext('personStatus', fn() => $this->clock->advance(21));

        $response = $this->cleanup('?apply=1');

        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame(
            ['applied' => true, 'complete' => false, 'checked' => 2, 'gone' => 1, 'deleted' => 1, 'failedDeletes' => 0, 'goneAdmins' => 0],
            $this->json($response),
        );
        self::assertCount(1, $this->storedEntries());
    }

    /** WC-14 */
    public function testUnopenableLockFileIs500WithoutDetails(): void
    {
        // A folder where the lock file should be: fopen() fails.
        mkdir($this->cacheDir . '/cleanup.lock', 0o700, true);
        try {
            $response = $this->cleanup('?apply=1');

            $body = (string) $response->getBody();
            $this->assertProblem(ProblemType::InternalError, $response);
            self::assertStringNotContainsString('cleanup.lock', $body);
            self::assertStringNotContainsString($this->cacheDir, $body);
        } finally {
            rmdir($this->cacheDir . '/cleanup.lock');
        }

        // After a normal run the lock is free again.
        $this->clock->advance(600);
        self::assertSame(200, $this->cleanup()->getStatusCode());
        $probe = fopen($this->cacheDir . '/cleanup.lock', 'c');
        self::assertNotFalse($probe);
        self::assertTrue(flock($probe, LOCK_EX | LOCK_NB), 'The lock is released after the run.');
        fclose($probe);
    }

    /** WC-15 */
    public function testOnlyPost(): void
    {
        foreach (['GET', 'PUT', 'DELETE'] as $method) {
            $response = $this->request($method, '/v1/cleanup', null, null, ['Authorization' => 'Bearer ' . self::TOKEN]);

            $this->assertProblem(ProblemType::MethodNotAllowed, $response);
            self::assertSame('POST', $response->getHeaderLine('Allow'));
        }
        // HEAD is refused like on every route (spec 4.1); off, every method is 404 (WC-01).
        self::assertSame(405, $this->request('HEAD', '/v1/cleanup')->getStatusCode());
    }

    /** WC-16 */
    public function testCooldownStoreFailsClosed(): void
    {
        self::assertSame(200, $this->cleanup()->getStatusCode());
        $records = glob($this->cacheDir . '/sec-*.json') ?: [];
        self::assertCount(1, $records, 'Only the cooldown record is written.');
        file_put_contents($records[0], '{"broken": true}');
        $this->clock->advance(600);
        $calls = $this->callCount();

        $this->assertProblem(ProblemType::Misconfigured, $this->cleanup('?apply=1'));
        self::assertSame($calls, $this->callCount());
    }
}
