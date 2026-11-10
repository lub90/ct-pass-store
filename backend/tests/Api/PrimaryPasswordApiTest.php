<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Api;

use CtPassStore\Http\Problem\ProblemType;
use CtPassStore\Infrastructure\ChurchTools\Exception\UnavailableException;
use CtPassStore\Infrastructure\Kv\KvSchema;
use Psr\Http\Message\ResponseInterface;

/**
 * The primary password check with its rate limit (spec 4.6, 5.5, 6.3): catalog PP-06 to PP-20.
 */
final class PrimaryPasswordApiTest extends ApiTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->setSettings([KvSchema::SETTING_REQUIRE_PRIMARY_PASSWORD => true]);
    }

    private function change(int $caller, string $primary, ?int $target = null, string $method = 'PUT'): ResponseInterface
    {
        $body = $method === 'PUT' ? ['primaryPwd' => $primary, 'secondaryPwd' => 'Custom-pass12!'] : ['primaryPwd' => $primary];

        return $this->request($method, '/v1/entries/' . ($target ?? $caller), $caller, $body);
    }

    private function failTimes(int $caller, int $times, ?int $target = null): void
    {
        for ($i = 0; $i < $times; $i++) {
            $this->assertProblem(ProblemType::InvalidPrimaryPassword, $this->change($caller, 'wrong-password', $target));
        }
    }

    private function correct(int $caller): string
    {
        return $this->primaryPasswordOf($caller);
    }

    private function loginCalls(): int
    {
        return $this->churchTools->countCalls(['verifyLogin']);
    }

    // ---------------------------------------------------------------- PP-06, PP-20

    public function testTheFifthFailureBlocksEvenTheCorrectPasswordWithoutAskingChurchTools(): void
    {
        $this->failTimes(self::USER, 4);
        self::assertSame(204, $this->change(self::USER, $this->correct(self::USER))->getStatusCode(), 'Four failures don\'t block.');

        $this->failTimes(self::USER, 5);
        $calls = $this->loginCalls();

        $response = $this->change(self::USER, $this->correct(self::USER));

        $body = $this->assertProblem(ProblemType::TooManyAttempts, $response);
        self::assertSame('900', $response->getHeaderLine('Retry-After'));
        self::assertSame(900, $body['retryAfter']);
        self::assertSame($calls, $this->loginCalls(), 'ChurchTools isn\'t asked during a block.');
    }

    public function testRetryAfterGivesTheRemainingSeconds(): void
    {
        $this->failTimes(self::USER, 5);

        $this->clock->advance(600);
        $response = $this->change(self::USER, $this->correct(self::USER));

        self::assertSame('300', $response->getHeaderLine('Retry-After'));
        self::assertSame(300, $this->assertProblem(ProblemType::TooManyAttempts, $response)['retryAfter']);
    }

    // ---------------------------------------------------------------- PP-13, PP-19

    public function testTheBlockEndsFifteenMinutesAfterTheFifthFailure(): void
    {
        $this->failTimes(self::USER, 5);

        $this->clock->advance(899);
        $this->assertProblem(ProblemType::TooManyAttempts, $this->change(self::USER, $this->correct(self::USER)));

        $this->clock->advance(1);
        self::assertSame(204, $this->change(self::USER, $this->correct(self::USER))->getStatusCode());
    }

    public function testAttemptsDuringABlockDontExtendIt(): void
    {
        $this->failTimes(self::USER, 5);
        $calls = $this->loginCalls();

        for ($i = 0; $i < 10; $i++) {
            $this->clock->advance(60);
            $this->assertProblem(ProblemType::TooManyAttempts, $this->change(self::USER, 'wrong-password'));
        }
        self::assertSame($calls, $this->loginCalls());

        $this->clock->advance(300);
        self::assertSame(204, $this->change(self::USER, $this->correct(self::USER))->getStatusCode());
    }

    public function testACorrectPasswordResetsTheCounter(): void
    {
        $this->failTimes(self::USER, 4);
        self::assertSame(204, $this->change(self::USER, $this->correct(self::USER))->getStatusCode());

        $this->failTimes(self::USER, 4);
        self::assertSame(204, $this->change(self::USER, $this->correct(self::USER))->getStatusCode(), 'Eight failures in total, never five in a row.');
    }

    public function testAfterABlockTheCountStartsOver(): void
    {
        $this->failTimes(self::USER, 5);
        $this->clock->advance(900);

        $this->failTimes(self::USER, 1);
        self::assertSame(204, $this->change(self::USER, $this->correct(self::USER))->getStatusCode());
    }

    // ---------------------------------------------------------------- PP-18

    public function testTheWindowSlides(): void
    {
        for ($i = 0; $i < 5; $i++) {
            $this->failTimes(self::USER, 1);
            $this->clock->advance(240);
        }

        // The first failure is 20 minutes old: only four count.
        self::assertSame(204, $this->change(self::USER, $this->correct(self::USER))->getStatusCode());
    }

    // ---------------------------------------------------------------- PP-14, PP-07, PP-16

    public function testFailuresCountAgainstTheCallerNotTheTarget(): void
    {
        $this->failTimes(self::ADMIN, 5, self::USER);

        $this->assertProblem(ProblemType::TooManyAttempts, $this->change(self::ADMIN, $this->correct(self::ADMIN)));
        self::assertSame(204, $this->change(self::USER, $this->correct(self::USER))->getStatusCode(), 'The target isn\'t blocked.');
    }

    public function testThePersonsAreCountedSeparately(): void
    {
        $this->failTimes(self::USER, 5);

        self::assertSame(204, $this->change(self::OTHER, $this->correct(self::OTHER))->getStatusCode());
    }

    public function testPutAndDeleteShareTheCounter(): void
    {
        $this->failTimes(self::USER, 3);
        $this->assertProblem(ProblemType::InvalidPrimaryPassword, $this->change(self::USER, 'wrong-password', method: 'DELETE'));
        $this->assertProblem(ProblemType::InvalidPrimaryPassword, $this->change(self::USER, 'wrong-password', method: 'DELETE'));

        $this->assertProblem(ProblemType::TooManyAttempts, $this->change(self::USER, $this->correct(self::USER), method: 'DELETE'));
        $this->assertProblem(ProblemType::TooManyAttempts, $this->change(self::USER, $this->correct(self::USER)));
    }

    // ---------------------------------------------------------------- PP-15

    /**
     * Only outages withdraw an attempt. A 429 or an answer the backend doesn't understand means ChurchTools got the
     * attempt, so it counts: otherwise a lockout answered with 429 would let every attempt through (PP-15a).
     *
     * @return iterable<string, array{\Throwable, ProblemType}>
     */
    public static function answersThatCount(): iterable
    {
        yield 'rate limited (429)' => [new \CtPassStore\Infrastructure\ChurchTools\Exception\RateLimitedException('POST login: 429.', 60), ProblemType::UpstreamRateLimited];
        yield 'unexpected answer' => [new \CtPassStore\Infrastructure\ChurchTools\Exception\InvalidResponseException('POST login: odd.'), ProblemType::UpstreamInvalid];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('answersThatCount')]
    public function testAttemptsAnsweredWithAnErrorStillCount(\Throwable $answer, ProblemType $problem): void
    {
        for ($i = 0; $i < 5; $i++) {
            $this->churchTools->failNext('verifyLogin', $answer);
            $this->assertProblem($problem, $this->change(self::USER, 'wrong-password'));
        }
        $calls = $this->loginCalls();

        $this->assertProblem(ProblemType::TooManyAttempts, $this->change(self::USER, $this->correct(self::USER)));
        self::assertSame($calls, $this->loginCalls());
    }

    /**
     * Q13 and spec 5.5.3: only the known statuses mean "correct". An unknown one is never a pass.
     */
    public function testAnUnknownLoginStatusIsNeverAPass(): void
    {
        $this->churchTools->addLogin('user', $this->correct(self::USER), self::USER, 'somethingNew');

        $this->assertProblem(ProblemType::UpstreamInvalid, $this->change(self::USER, $this->correct(self::USER)));
        self::assertSame(0, $this->churchTools->writeCount());
    }

    public function testUsernamesDontGoIntoTheLog(): void
    {
        $this->change(self::USER, 'wrong-password');
        $this->churchTools->addLogin('user', $this->correct(self::USER), 999);
        $this->change(self::USER, $this->correct(self::USER));

        foreach ($this->log->getRecords() as $record) {
            self::assertStringNotContainsString("user 'user'", (string) $record['message']);
            self::assertDoesNotMatchRegularExpression('/\\buser user\\b/', (string) $record['message']);
        }
        self::assertTrue($this->log->hasInfoThatContains('failed for person 10'));
    }

    public function testChurchToolsErrorsDontCountAsFailures(): void
    {
        $this->failTimes(self::USER, 4);
        for ($i = 0; $i < 3; $i++) {
            $this->churchTools->failNext('verifyLogin', new UnavailableException('POST login: ChurchTools answered 503.'));
            $this->assertProblem(ProblemType::UpstreamUnavailable, $this->change(self::USER, 'wrong-password'));
        }

        self::assertSame(204, $this->change(self::USER, $this->correct(self::USER))->getStatusCode());
    }

    // ---------------------------------------------------------------- PP-09

    public function testWithoutTheSettingChurchToolsIsNotAsked(): void
    {
        $this->setSettings([KvSchema::SETTING_REQUIRE_PRIMARY_PASSWORD => false]);

        self::assertSame(204, $this->request('PUT', '/v1/entries/' . self::USER, self::USER, ['secondaryPwd' => 'Custom-pass12!'])->getStatusCode());
        self::assertSame(0, $this->loginCalls());
    }

    // ---------------------------------------------------------------- PP-17, PP-11

    public function testAPasswordOfAReassignedUsernameCountsAsWrong(): void
    {
        // The username "user" now belongs to person 999; the token still says person 10.
        $this->churchTools->addLogin('user', $this->correct(self::USER), 999);

        $this->assertProblem(ProblemType::InvalidPrimaryPassword, $this->change(self::USER, $this->correct(self::USER)));
        self::assertTrue($this->log->hasWarningThatContains('check for person 10 returned person 999'));
        self::assertSame(0, $this->churchTools->writeCount());
    }

    /**
     * Q13: a pending second factor doesn't make a correct password wrong.
     */
    public function testTwoFactorUsersWithTheCorrectPasswordPass(): void
    {
        foreach (['totp', 'twoFactorSetup'] as $status) {
            $this->churchTools->addLogin('user', $this->correct(self::USER), self::USER, $status);

            self::assertSame(204, $this->change(self::USER, $this->correct(self::USER))->getStatusCode(), $status);
            $this->assertProblem(ProblemType::InvalidPrimaryPassword, $this->change(self::USER, 'wrong-password'));
        }
    }

    // ---------------------------------------------------------------- PP-08

    public function testThePrimaryPasswordAppearsNowhere(): void
    {
        $secret = 'Wrong-but-secret-PRIMARY-123';
        $responses = [];
        for ($i = 0; $i < 6; $i++) {
            $responses[] = $this->change(self::USER, $secret);
        }

        foreach ($responses as $response) {
            self::assertStringNotContainsString($secret, (string) $response->getBody());
            self::assertStringNotContainsString($secret, json_encode($response->getHeaders(), JSON_THROW_ON_ERROR));
        }
        foreach ($this->log->getRecords() as $record) {
            self::assertStringNotContainsString($secret, json_encode([$record['message'], $record['context']], JSON_THROW_ON_ERROR));
        }
        foreach (glob($this->cacheDir . '/*') ?: [] as $file) {
            self::assertStringNotContainsString($secret, (string) file_get_contents($file));
        }
    }

    public function testAnUnusableCounterStoreFailsClosed(): void
    {
        file_put_contents($this->cacheDir, 'a file where the folder should be');
        try {
            $this->assertProblem(ProblemType::Misconfigured, $this->change(self::USER, $this->correct(self::USER)));
            self::assertSame(0, $this->churchTools->writeCount());
        } finally {
            unlink($this->cacheDir);
        }
    }

    /**
     * RX-05: requests that aren't authenticated never create a primary password counter file. The rejected token does
     * count against its address (spec 6.3): one bucket (record and lock), however many requests come.
     */
    public function testUnauthenticatedRequestsCreateNoCounterFiles(): void
    {
        foreach (['Bearer abc.def.ghi', 'Basic eDp5', ''] as $header) {
            $this->request('PUT', '/v1/entries/' . self::USER, null, ['primaryPwd' => 'x'], $header === '' ? [] : ['Authorization' => $header]);
        }

        self::assertLessThanOrEqual(2, count(glob($this->cacheDir . '/*') ?: []));
    }

    // ---------------------------------------------------------------- ED-04

    public function testDeleteNeedsTheCorrectPrimaryPasswordAndDeletesNothingOtherwise(): void
    {
        $this->seedEntry(self::USER);

        $this->assertProblem(ProblemType::PrimaryPasswordRequired, $this->request('DELETE', '/v1/entries/' . self::USER, self::USER, []));
        $this->assertProblem(ProblemType::PrimaryPasswordRequired, $this->request('DELETE', '/v1/entries/' . self::USER, self::USER, ['primaryPwd' => '']));
        $this->assertProblem(ProblemType::InvalidPrimaryPassword, $this->change(self::USER, 'wrong-password', method: 'DELETE'));
        self::assertCount(1, $this->storedEntries(), 'Nothing deleted in the error cases.');
        self::assertSame(0, $this->churchTools->writeCount());

        self::assertSame(204, $this->change(self::USER, $this->correct(self::USER), method: 'DELETE')->getStatusCode());
        self::assertSame([], $this->storedEntries());
    }
}
