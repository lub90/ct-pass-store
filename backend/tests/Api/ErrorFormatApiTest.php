<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Api;

use CtPassStore\Http\Problem\ProblemType;
use CtPassStore\Infrastructure\ChurchTools\Exception\ChurchToolsException;
use CtPassStore\Infrastructure\ChurchTools\Exception\InvalidResponseException;
use CtPassStore\Infrastructure\ChurchTools\Exception\NotFoundException;
use CtPassStore\Infrastructure\ChurchTools\Exception\RateLimitedException;
use CtPassStore\Infrastructure\ChurchTools\Exception\ServiceCredentialRejectedException;
use CtPassStore\Infrastructure\ChurchTools\Exception\UnavailableException;
use CtPassStore\Infrastructure\Kv\KvSchema;
use PHPUnit\Framework\Attributes\DataProvider;

/**
 * The error format (spec 4.9) and the order of checks (spec 4.1). Catalog ER-01, ER-04, ER-05, ER-06, ER-07, IN-07,
 * PR-01 (route before authentication), IJ-04, HT-10, PP-05.
 */
final class ErrorFormatApiTest extends ApiTestCase
{
    // ---------------------------------------------------------------- routing before authentication (PR-01, IN-07)

    /**
     * @return iterable<string, array{int|null}>
     */
    public static function withAndWithoutToken(): iterable
    {
        yield 'without token' => [null];
        yield 'with token' => [self::USER];
    }

    #[DataProvider('withAndWithoutToken')]
    public function testUnknownRouteIs404(?int $asPerson): void
    {
        $response = $this->request('GET', '/nothing-here', $asPerson);

        $this->assertProblem(ProblemType::NotFound, $response);
        self::assertSame(0, $this->churchTools->countCalls(['whoami', 'globalPermissions']));
    }

    #[DataProvider('withAndWithoutToken')]
    public function testWrongMethodIs405WithAllowHeader(?int $asPerson): void
    {
        $response = $this->request('POST', '/v1/entries/' . self::USER, $asPerson);

        $this->assertProblem(ProblemType::MethodNotAllowed, $response);
        $allowed = array_map('trim', explode(',', $response->getHeaderLine('Allow')));
        sort($allowed);
        self::assertSame(['DELETE', 'GET', 'PUT'], $allowed);
        self::assertSame(0, $this->churchTools->writeCount());
    }

    public function testMethodOverrideHeadersAreIgnored(): void
    {
        $this->seedEntry(self::USER);

        $response = $this->request('GET', '/v1/entries/' . self::USER, self::USER, headers: ['X-HTTP-Method-Override' => 'DELETE']);

        self::assertSame(200, $response->getStatusCode());
        self::assertSame(0, $this->churchTools->writeCount());
    }

    public function testRejectedRequestsDontCallChurchToolsAtAll(): void
    {
        $this->request('GET', '/v1/entries/' . self::USER);
        $this->request('GET', '/nothing-here');
        $this->request('POST', '/v1/entries/' . self::USER);

        self::assertSame([], $this->churchTools->calls(), 'Requests rejected before authentication must not cost ChurchTools calls.');
    }

    // ---------------------------------------------------------------- format (ER-01, ER-07, IJ-04)

    public function testSuccessfulResponsesAreNotProblemDetails(): void
    {
        $this->seedEntry(self::USER);

        $response = $this->request('GET', '/v1/entries/' . self::USER, self::USER);

        self::assertSame(200, $response->getStatusCode());
        self::assertSame('application/json', $response->getHeaderLine('Content-Type'));
    }

    public function testErrorsAreProblemDetailsEvenWhenHtmlIsAccepted(): void
    {
        $response = $this->request('GET', '/<script>alert(1)</script>', headers: ['Accept' => 'text/html']);

        $body = $this->assertProblem(ProblemType::NotFound, $response);
        self::assertStringNotContainsString('<html', (string) $response->getBody());
        self::assertStringContainsString('script', (string) $body['detail'], 'The path may appear in the detail, JSON-encoded.');
    }

    // ---------------------------------------------------------------- ChurchTools failures (ER-04, ER-05, ER-06, PP-05)

    /**
     * @return iterable<string, array{ChurchToolsException, ProblemType}>
     */
    public static function churchToolsFailures(): iterable
    {
        yield 'unreachable' => [new UnavailableException('GET custommodules: unreachable.'), ProblemType::UpstreamUnavailable];
        yield 'unusable answer' => [new InvalidResponseException('GET custommodules: not JSON.'), ProblemType::UpstreamInvalid];
    }

    /**
     * Authentication needs no ChurchTools call any more (spec 4.3); ChurchTools failures during the request are
     * upstream problems, never 401.
     */
    #[DataProvider('churchToolsFailures')]
    public function testChurchToolsFailuresAreNot401(ChurchToolsException $failure, ProblemType $expected): void
    {
        $this->churchTools->failNext('getModuleByKey', $failure);

        $response = $this->request('GET', '/v1/entries/' . self::USER, self::USER);

        $this->assertProblem($expected, $response);
    }

    public function testRateLimitIs503WithRetryAfter(): void
    {
        $this->churchTools->failNext('getValues', new RateLimitedException('GET values: 429.', 120));

        $response = $this->request('GET', '/v1/entries/' . self::USER, self::USER);

        $body = $this->assertProblem(ProblemType::UpstreamRateLimited, $response);
        self::assertSame('120', $response->getHeaderLine('Retry-After'));
        self::assertSame(120, $body['retryAfter']);
    }

    public function testRejectedServiceUserIsMisconfigured(): void
    {
        $this->churchTools->failNext('getValues', new ServiceCredentialRejectedException('GET values: 403.'));

        $body = $this->assertProblem(ProblemType::Misconfigured, $this->request('GET', '/v1/entries/' . self::USER, self::USER));

        self::assertStringContainsString('service user', (string) $body['detail']);
        self::assertStringNotContainsString('service-token', (string) $body['detail'], 'The detail names the key, never its value.');
    }

    public function testMissingModuleIsMisconfigured(): void
    {
        $this->churchTools->failNext('getModuleByKey', new NotFoundException('GET custommodules/ctpassstore: 404.'));

        $response = $this->request('GET', '/v1/entries/' . self::USER, self::USER);

        $this->assertProblem(ProblemType::Misconfigured, $response);
        self::assertNotSame(ProblemType::EntryNotFound->uri(), $this->json($response)['type'], 'A missing module must never look like "no password".');
    }

    public function testMissingSettingsAreMisconfigured(): void
    {
        $this->churchTools->clearValues($this->categoryIds[KvSchema::SETTINGS_CATEGORY]);

        $body = $this->assertProblem(ProblemType::Misconfigured, $this->request('GET', '/v1/entries/' . self::OTHER, self::USER));

        self::assertStringContainsString('settings', (string) $body['detail']);
    }

    public function testChurchToolsFailureDuringThePrimaryPasswordCheckIsNotAWrongPassword(): void
    {
        $this->setSettings([KvSchema::SETTING_REQUIRE_PRIMARY_PASSWORD => true]);
        $this->churchTools->failNext('verifyLogin', new UnavailableException('POST login: unreachable.'));

        $response = $this->request('PUT', '/v1/entries/' . self::USER, self::USER, ['primaryPwd' => $this->primaryPasswordOf(self::USER)]);

        $this->assertProblem(ProblemType::UpstreamUnavailable, $response);
        self::assertSame(0, $this->churchTools->writeCount());
    }

    public function testUnexpectedErrorsAreGenericAndLoggedWithoutArguments(): void
    {
        $this->churchTools->failNext('getValues', new \LogicException('Bug in /var/www/secret/path.php with Custom-pass12!'));

        $response = $this->request('GET', '/v1/entries/' . self::USER, self::USER);

        $body = $this->assertProblem(ProblemType::InternalError, $response);
        $raw = (string) $response->getBody();
        foreach (['LogicException', '/var/www', 'Custom-pass12!', '#0'] as $leak) {
            self::assertStringNotContainsString($leak, $raw);
        }
        self::assertStringContainsString('log', (string) $body['detail']);

        $errors = array_filter($this->log->getRecords(), static fn(array $r): bool => $r['level_name'] === 'ERROR');
        self::assertCount(1, $errors);
        $error = array_values($errors)[0];
        self::assertSame(\LogicException::class, $error['context']['exception']);
        self::assertIsArray($error['context']['trace']);
        self::assertNotEmpty($error['context']['trace']);
        foreach ($error['context']['trace'] as $frame) {
            self::assertMatchesRegularExpression('/^\S+:\S+ \S+\(\)$/', $frame, 'Trace frames carry no arguments.');
        }
    }

    // ---------------------------------------------------------------- CORS on errors (HT-10)

    public function testErrorResponsesCarryCorsHeadersForAllowedOrigins(): void
    {
        $response = $this->request('GET', '/v1/entries/' . self::USER, headers: ['Origin' => self::ORIGIN]);

        $this->assertProblem(ProblemType::MissingToken, $response);
        self::assertSame(self::ORIGIN, $response->getHeaderLine('Access-Control-Allow-Origin'));
    }

    public function testErrorResponsesCarryNoCorsHeadersForForeignOrigins(): void
    {
        $response = $this->request('GET', '/v1/entries/' . self::USER, headers: ['Origin' => 'https://evil.example']);

        $this->assertProblem(ProblemType::MissingToken, $response);
        self::assertFalse($response->hasHeader('Access-Control-Allow-Origin'));
    }

    /**
     * IN-08: no error response writes to ChurchTools, whatever the reason.
     */
    public function testNoErrorResponseWritesAnything(): void
    {
        $entry = '/v1/entries/' . self::USER;
        $cases = [
            'missing token' => fn() => $this->request('PUT', $entry, null, ['secondaryPwd' => 'Custom-pass12!']),
            'invalid token' => fn() => $this->request('DELETE', $entry, headers: ['Authorization' => 'Bearer abc.def.ghi']),
            'expired token' => function () use ($entry) {
                $token = $this->tokenOf(self::USER);
                $this->clock->advance(1000);
                $response = $this->request('DELETE', $entry, headers: ['Authorization' => 'Bearer ' . $token]);
                $this->clock->advance(-1000);

                return $response;
            },
            'machine client writing' => fn() => $this->request('PUT', $entry, self::READER_CLIENT, []),
            'invalid id' => fn() => $this->request('PUT', '/v1/entries/07', self::USER, []),
            'invalid body' => fn() => $this->rawRequest('PUT', $entry, self::USER, '{"secondaryPwd": 1}'),
            'unsupported media type' => fn() => $this->rawRequest('PUT', $entry, self::USER, 'x', ['Content-Type' => 'text/plain']),
            'payload too large' => fn() => $this->rawRequest('PUT', $entry, self::USER, str_repeat(' ', 20_000)),
            'forbidden' => fn() => $this->request('DELETE', '/v1/entries/' . self::OTHER, self::USER, []),
            'password invalid' => fn() => $this->request('PUT', $entry, self::USER, ['secondaryPwd' => 'short']),
            'unknown route' => fn() => $this->request('PUT', '/v1/nothing', self::USER, []),
            'wrong method' => fn() => $this->request('PATCH', $entry, self::USER, []),
            'custom password not allowed' => function () use ($entry) {
                $this->setSettings([KvSchema::SETTING_ALLOW_CUSTOM_PASSWORD => false]);
                $response = $this->request('PUT', $entry, self::USER, ['secondaryPwd' => 'Custom-pass12!']);
                $this->setSettings([]);

                return $response;
            },
            'primary password required, missing and wrong' => function () use ($entry) {
                $this->setSettings([KvSchema::SETTING_REQUIRE_PRIMARY_PASSWORD => true]);
                $this->request('PUT', $entry, self::USER, []);
                $response = $this->request('DELETE', $entry, self::USER, ['primaryPwd' => 'wrong']);
                $this->setSettings([]);

                return $response;
            },
            'broken settings' => function () use ($entry) {
                $this->setSettings(['passwordLength' => 3]);
                $response = $this->request('PUT', $entry, self::USER, []);
                $this->setSettings([]);

                return $response;
            },
            'ChurchTools down while reading' => function () use ($entry) {
                $this->churchTools->failNext('getValues', new UnavailableException('down'));

                return $this->request('PUT', $entry, self::USER, []);
            },
        ];

        $this->seedEntry(self::USER);
        $this->seedEntry(self::OTHER);
        foreach ($cases as $name => $send) {
            $response = $send();
            self::assertGreaterThanOrEqual(400, $response->getStatusCode(), $name);
            self::assertSame(0, $this->churchTools->writeCount(), "$name wrote to ChurchTools.");
        }
        self::assertCount(2, $this->storedEntries());
    }
}
