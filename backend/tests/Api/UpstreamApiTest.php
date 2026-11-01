<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Api;

use CtPassStore\Http\Problem\ProblemType;
use CtPassStore\Infrastructure\ChurchTools\Exception\ChurchToolsException;
use CtPassStore\Infrastructure\ChurchTools\Exception\InvalidResponseException;
use CtPassStore\Infrastructure\ChurchTools\Exception\RateLimitedException;
use CtPassStore\Infrastructure\ChurchTools\Exception\UnavailableException;
use CtPassStore\Infrastructure\Kv\KvSchema;
use PHPUnit\Framework\Attributes\DataProvider;

/**
 * How ChurchTools failures surface at every step of a request (spec 4.3, 5.6, 6.2). Catalog ER-06, PP-05, CC-04 at
 * the API level.
 */
final class UpstreamApiTest extends ApiTestCase
{
    /**
     * @return iterable<string, array{string, ChurchToolsException, ProblemType}>
     */
    public static function failuresPerStep(): iterable
    {
        // Authentication makes no ChurchTools call any more (spec 4.3); login failures are in LoginApiTest.
        yield 'module lookup rate limited' => ['getModuleByKey', new RateLimitedException('429', 60), ProblemType::UpstreamRateLimited];
        yield 'categories unreachable' => ['getCategories', new UnavailableException('down'), ProblemType::UpstreamUnavailable];
        yield 'module lookup unusable' => ['getModuleByKey', new InvalidResponseException('no JSON'), ProblemType::UpstreamInvalid];
        yield 'values incomplete (meta.count)' => ['getValues', new InvalidResponseException('meta.count'), ProblemType::UpstreamInvalid];
        yield 'values unreachable' => ['getValues', new UnavailableException('down'), ProblemType::UpstreamUnavailable];
    }

    #[DataProvider('failuresPerStep')]
    public function testFailuresMapToTheirProblemTypeAndWriteNothing(string $method, ChurchToolsException $failure, ProblemType $expected): void
    {
        $this->churchTools->failNext($method, $failure);

        $response = $this->request('PUT', '/v1/entries/' . self::USER, self::USER, ['secondaryPwd' => 'Custom-pass12!']);

        $this->assertProblem($expected, $response);
        self::assertSame(0, $this->churchTools->writeCount());
    }

    public function testRateLimitDuringThePrimaryPasswordCheckIsNotAWrongPassword(): void
    {
        $this->setSettings([KvSchema::SETTING_REQUIRE_PRIMARY_PASSWORD => true]);
        $this->churchTools->failNext('verifyLogin', new RateLimitedException('429', 90));

        $response = $this->request('PUT', '/v1/entries/' . self::USER, self::USER, ['primaryPwd' => $this->primaryPasswordOf(self::USER)]);

        $body = $this->assertProblem(ProblemType::UpstreamRateLimited, $response);
        self::assertSame('90', $response->getHeaderLine('Retry-After'));
        self::assertSame(90, $body['retryAfter']);
        self::assertSame(0, $this->churchTools->writeCount());
    }

    public function testRetryAfterHeaderAndMemberAgree(): void
    {
        $this->churchTools->failNext('getValues', new RateLimitedException('429', 60));

        $response = $this->request('GET', '/v1/entries/' . self::USER, self::USER);

        $body = $this->assertProblem(ProblemType::UpstreamRateLimited, $response);
        self::assertSame((string) $body['retryAfter'], $response->getHeaderLine('Retry-After'));
        self::assertGreaterThanOrEqual(60, $body['retryAfter']);
    }
}
