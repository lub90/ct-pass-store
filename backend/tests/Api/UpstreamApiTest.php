<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Api;

use CtPassStore\ChurchTools\Exception\ChurchToolsException;
use CtPassStore\ChurchTools\Exception\InvalidResponseException;
use CtPassStore\ChurchTools\Exception\NotAuthenticatedException;
use CtPassStore\ChurchTools\Exception\NotPermittedException;
use CtPassStore\ChurchTools\Exception\RateLimitedException;
use CtPassStore\ChurchTools\Exception\UnavailableException;
use CtPassStore\Config\AppConfig;
use CtPassStore\Http\Problem\ProblemType;
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
        yield 'token rejected at whoami' => ['whoami', new NotAuthenticatedException('401'), ProblemType::InvalidToken];
        yield 'token rejected at permissions' => ['globalPermissions', new NotAuthenticatedException('401'), ProblemType::InvalidToken];
        yield 'permissions forbidden' => ['globalPermissions', new NotPermittedException('403'), ProblemType::NoServiceAccess];
        yield 'whoami unreachable' => ['whoami', new UnavailableException('down'), ProblemType::UpstreamUnavailable];
        yield 'permissions unreachable' => ['globalPermissions', new UnavailableException('down'), ProblemType::UpstreamUnavailable];
        yield 'whoami rate limited' => ['whoami', new RateLimitedException('429', 60), ProblemType::UpstreamRateLimited];
        yield 'module lookup unusable' => ['getModuleByKey', new InvalidResponseException('no JSON'), ProblemType::UpstreamInvalid];
        yield 'values incomplete (meta.count)' => ['getValues', new InvalidResponseException('meta.count'), ProblemType::UpstreamInvalid];
        yield 'values unreachable' => ['getValues', new UnavailableException('down'), ProblemType::UpstreamUnavailable];
    }

    #[DataProvider('failuresPerStep')]
    public function testFailuresMapToTheirProblemTypeAndWriteNothing(string $method, ChurchToolsException $failure, ProblemType $expected): void
    {
        $this->churchTools->failNext($method, $failure);

        $response = $this->request('PUT', '/entries/' . self::USER, self::USER, [AppConfig::REQUEST_SECONDARY_PWD_FIELD => 'Custom-pass12!']);

        $this->assertProblem($expected, $response);
        self::assertSame(0, $this->churchTools->writeCount());
    }

    public function testRateLimitDuringThePrimaryPasswordCheckIsNotAWrongPassword(): void
    {
        $this->setSettings([AppConfig::CT_REQUIRE_PWD_FOR_PWD_CHANGE_FIELD_NAME => true]);
        $this->churchTools->failNext('verifyLogin', new RateLimitedException('429', 90));

        $response = $this->request('PUT', '/entries/' . self::USER, self::USER, [AppConfig::REQUEST_PRIMARY_PWD_FIELD => $this->primaryPasswordOf(self::USER)]);

        $body = $this->assertProblem(ProblemType::UpstreamRateLimited, $response);
        self::assertSame('90', $response->getHeaderLine('Retry-After'));
        self::assertSame(90, $body['retryAfter']);
        self::assertSame(0, $this->churchTools->writeCount());
    }

    public function testRetryAfterHeaderAndMemberAgree(): void
    {
        $this->churchTools->failNext('getValues', new RateLimitedException('429', 60));

        $response = $this->request('GET', '/entries/' . self::USER, self::USER);

        $body = $this->assertProblem(ProblemType::UpstreamRateLimited, $response);
        self::assertSame((string) $body['retryAfter'], $response->getHeaderLine('Retry-After'));
        self::assertGreaterThanOrEqual(60, $body['retryAfter']);
    }
}
