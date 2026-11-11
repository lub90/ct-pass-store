<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Api;

use CtPassStore\Http\Problem\ProblemType;
use CtPassStore\Kernel;
use PHPUnit\Framework\Attributes\DataProvider;
use Psr\Http\Message\ResponseInterface;

/**
 * HTTP behavior shared by every route (spec 4.1, 4.2): security headers, exact CORS, the HTTPS check at the PHP level
 * and `405` for methods the API doesn't define. Catalog HT-02 to HT-09, EP-06, HP-02, RX-07.
 */
final class HttpHeadersApiTest extends ApiTestCase
{
    private const FOREIGN = 'https://evil.example';

    /**
     * The `Access-Control-*` headers of a response.
     *
     * @return array<string, list<string>>
     */
    private static function corsHeaders(ResponseInterface $response): array
    {
        return array_filter(
            $response->getHeaders(),
            static fn(string $name): bool => str_starts_with(strtolower($name), 'access-control-'),
            ARRAY_FILTER_USE_KEY,
        );
    }

    private function preflight(string $origin, string $path = '/v1/entries/10', string $method = 'PUT'): ResponseInterface
    {
        return $this->request('OPTIONS', $path, headers: [
            'Origin' => $origin,
            'Access-Control-Request-Method' => $method,
            'Access-Control-Request-Headers' => 'authorization, content-type',
        ]);
    }

    // ---------------------------------------------------------------- HT-02, HT-06 exact origins (spec 4.2)

    /**
     * @return iterable<string, array{string}>
     */
    public static function notAllowedOrigins(): iterable
    {
        // HT-02
        yield 'foreign' => [self::FOREIGN];
        yield 'null' => ['null'];
        yield 'lookalike' => ['https://example.church.tools.evil.com'];
        // HT-06
        yield 'other scheme' => ['http://example.church.tools'];
        yield 'other port' => ['https://example.church.tools:8443'];
        yield 'explicit default port' => ['https://example.church.tools:443'];
        yield 'trailing slash' => ['https://example.church.tools/'];
        yield 'path' => ['https://example.church.tools/api'];
        yield 'subdomain' => ['https://sub.example.church.tools'];
    }

    #[DataProvider('notAllowedOrigins')]
    public function testOriginsThatArentExactlyAllowedGetNoCorsHeaders(string $origin): void
    {
        $this->seedEntry(self::USER);

        $response = $this->request('GET', '/v1/entries/' . self::USER, self::USER, headers: ['Origin' => $origin]);
        self::assertSame(200, $response->getStatusCode());
        self::assertSame([], self::corsHeaders($response));

        self::assertSame([], self::corsHeaders($this->preflight($origin)), 'Preflight');
    }

    // ---------------------------------------------------------------- HT-03, HT-07 preflight (spec 4.2)

    public function testPreflightFromAnAllowedOriginNeedsNoToken(): void
    {
        $response = $this->preflight(self::ORIGIN);

        self::assertSame(204, $response->getStatusCode());
        self::assertSame('', (string) $response->getBody());
        self::assertSame(self::ORIGIN, $response->getHeaderLine('Access-Control-Allow-Origin'));
        self::assertSame('GET, POST, PUT, DELETE, OPTIONS', $response->getHeaderLine('Access-Control-Allow-Methods'));
        self::assertSame('Authorization, Content-Type', $response->getHeaderLine('Access-Control-Allow-Headers'));
        self::assertSame('600', $response->getHeaderLine('Access-Control-Max-Age'));
    }

    /**
     * HT-07: a preflight never runs an endpoint, whatever the origin, path or announced method.
     */
    public function testPreflightNeverRunsTheEndpoint(): void
    {
        $this->seedEntry(self::USER);

        foreach ([self::ORIGIN, self::FOREIGN] as $origin) {
            foreach ([['/v1/entries/10', 'PUT'], ['/v1/entries/10', 'DELETE'], ['/v1/auth/token', 'POST'], ['/v1/test', 'GET']] as [$path, $method]) {
                $response = $this->preflight($origin, $path, $method);
                self::assertSame(204, $response->getStatusCode(), "$origin $method $path");
                self::assertSame('', (string) $response->getBody());
            }
        }

        self::assertSame([], $this->churchTools->calls(), 'A preflight costs no ChurchTools call and writes nothing.');
        self::assertCount(1, $this->storedEntries());
    }

    public function testPreflightFromAForeignOriginGetsNoAllowHeaders(): void
    {
        self::assertSame([], self::corsHeaders($this->preflight(self::FOREIGN)));
    }

    // ---------------------------------------------------------------- HT-08 allowed-origin headers (spec 4.2)

    public function testAllowedOriginsGetNoCredentialsAndNeverAWildcard(): void
    {
        $this->seedEntry(self::USER);
        $responses = [
            'GET' => $this->request('GET', '/v1/entries/' . self::USER, self::USER, headers: ['Origin' => self::ORIGIN]),
            'error' => $this->request('GET', '/v1/entries/' . self::USER, headers: ['Origin' => self::ORIGIN]),
            'preflight' => $this->preflight(self::ORIGIN),
        ];

        foreach ($responses as $case => $response) {
            self::assertSame(self::ORIGIN, $response->getHeaderLine('Access-Control-Allow-Origin'), $case);
            self::assertSame('Authorization, Content-Type', $response->getHeaderLine('Access-Control-Allow-Headers'), $case);
            self::assertFalse($response->hasHeader('Access-Control-Allow-Credentials'), $case);
            foreach (self::corsHeaders($response) as $name => $values) {
                self::assertNotContains('*', $values, "$case: $name");
            }
        }
    }

    // ---------------------------------------------------------------- HT-09 Vary (spec 4.2)

    public function testEveryResponseVariesByOrigin(): void
    {
        $this->seedEntry(self::USER);
        $responses = [
            'allowed origin' => $this->request('GET', '/v1/entries/' . self::USER, self::USER, headers: ['Origin' => self::ORIGIN]),
            'foreign origin' => $this->request('GET', '/v1/entries/' . self::USER, self::USER, headers: ['Origin' => self::FOREIGN]),
            'no origin' => $this->request('GET', '/v1/entries/' . self::USER, self::USER),
            'error' => $this->request('GET', '/v1/nothing'),
            'preflight' => $this->preflight(self::ORIGIN),
            'foreign preflight' => $this->preflight(self::FOREIGN),
            'plain http' => $this->send($this->serverRequest('GET', '/v1/entries/' . self::USER, ['HTTPS' => null])),
        ];

        foreach ($responses as $case => $response) {
            self::assertSame(['Origin'], $response->getHeader('Vary'), $case);
        }
    }

    // ---------------------------------------------------------------- HT-04, EP-06 security headers (spec 4.1)

    private static function assertSecurityHeaders(ResponseInterface $response, string $case): void
    {
        self::assertSame(['no-store'], $response->getHeader('Cache-Control'), $case);
        self::assertSame(['nosniff'], $response->getHeader('X-Content-Type-Options'), $case);
    }

    public function testEveryResponseCarriesTheSecurityHeaders(): void
    {
        $this->seedEntry(self::USER);
        $entry = '/v1/entries/' . self::USER;
        $responses = [
            200 => $this->request('GET', $entry, self::USER),
            204 => $this->request('PUT', $entry, self::USER, ['secondaryPwd' => 'Custom-pass12!']),
            400 => $this->request('GET', '/v1/entries/abc', self::USER),
            401 => $this->request('GET', $entry),
            404 => $this->request('GET', '/v1/nothing'),
            405 => $this->request('PATCH', $entry, self::USER),
        ];
        $this->setSettings(['passwordLength' => 3]);
        $responses[500] = $this->request('PUT', $entry, self::USER, []);

        foreach ($responses as $status => $response) {
            self::assertSame($status, $response->getStatusCode(), (string) $response->getBody());
            self::assertSecurityHeaders($response, "$status");
        }
        self::assertSecurityHeaders($this->preflight(self::ORIGIN), 'preflight');
        self::assertSecurityHeaders($this->preflight(self::FOREIGN), 'foreign preflight');
        self::assertSecurityHeaders($this->send($this->serverRequest('GET', $entry, ['HTTPS' => 'off'])), 'plain http');
    }

    public function testTheMisconfiguredAppCarriesTheSecurityHeaders(): void
    {
        foreach (['GET', 'OPTIONS'] as $method) {
            $response = Kernel::misconfigured('CORS is broken.')->handle($this->serverRequest($method, '/v1/entries/1'));

            self::assertSame(500, $response->getStatusCode());
            self::assertSecurityHeaders($response, $method);
        }
    }

    /**
     * EP-06: the generated password is never cached.
     */
    public function testTheGeneratedPasswordIsNotCached(): void
    {
        $response = $this->request('PUT', '/v1/entries/' . self::USER, self::USER, []);

        self::assertSame(200, $response->getStatusCode());
        self::assertArrayHasKey('secondaryPwd', $this->json($response));
        self::assertSame('no-store', $response->getHeaderLine('Cache-Control'));
    }

    // ---------------------------------------------------------------- HT-05 HTTPS (spec 4.1, Review Focus 4)

    /**
     * Exactly the values for which `.htaccess` redirects (`%{HTTPS}` is `off`): the server param is missing, empty or
     * `off` in any case.
     *
     * @return iterable<string, array{string|null}>
     */
    public static function plainHttp(): iterable
    {
        yield 'missing' => [null];
        yield 'empty' => [''];
        yield 'off' => ['off'];
        yield 'OFF' => ['OFF'];
        yield 'Off' => ['Off'];
    }

    #[DataProvider('plainHttp')]
    public function testHttpsMissingIsRejected(?string $https): void
    {
        $this->seedEntry(self::USER);
        $requests = [
            $this->serverRequest('GET', '/v1/entries/' . self::USER, ['HTTPS' => $https])->withHeader('Authorization', 'Bearer ' . $this->tokenOf(self::USER)),
            $this->serverRequest('DELETE', '/v1/entries/' . self::USER, ['HTTPS' => $https])->withHeader('Authorization', 'Bearer ' . $this->tokenOf(self::USER)),
            $this->serverRequest('POST', '/v1/auth/token', ['HTTPS' => $https]),
            $this->serverRequest('GET', '/v1/nothing', ['HTTPS' => $https]),
        ];

        foreach ($requests as $request) {
            $response = $this->send($request->withHeader('Origin', self::ORIGIN));
            $this->assertProblem(ProblemType::HttpsRequired, $response);
            self::assertSame(self::ORIGIN, $response->getHeaderLine('Access-Control-Allow-Origin'), 'The extension can read the problem.');
        }
        self::assertSame([], $this->churchTools->calls(), 'Nothing reaches ChurchTools over plain HTTP.');
        self::assertCount(1, $this->storedEntries());
    }

    /**
     * Every value for which `.htaccess` doesn't redirect is accepted, so a host where the redirect works never gets
     * `400` from PHP.
     *
     * @return iterable<string, array{string}>
     */
    public static function https(): iterable
    {
        yield 'on' => ['on'];
        yield 'ON' => ['ON'];
        yield '1' => ['1'];
    }

    #[DataProvider('https')]
    public function testHttpsOnIsAccepted(string $https): void
    {
        $this->seedEntry(self::USER);
        $request = $this->serverRequest('GET', '/v1/entries/' . self::USER, ['HTTPS' => $https])
            ->withHeader('Authorization', 'Bearer ' . $this->tokenOf(self::USER));

        self::assertSame(200, $this->send($request)->getStatusCode());
    }

    // ---------------------------------------------------------------- HP-02 methods (spec 4.1)

    /**
     * @return iterable<string, array{string, string, string}>
     */
    public static function undefinedMethods(): iterable
    {
        foreach (['HEAD', 'PATCH', 'TRACE'] as $method) {
            yield "$method entry" => [$method, '/v1/entries/10', 'GET, PUT, DELETE'];
            yield "$method test" => [$method, '/v1/test', 'GET'];
            yield "$method token" => [$method, '/v1/auth/token', 'POST'];
        }
    }

    #[DataProvider('undefinedMethods')]
    public function testUndefinedMethodsAreNotAllowed(string $method, string $path, string $allow): void
    {
        $this->seedEntry(self::USER);

        $response = $this->request($method, $path, self::ADMIN, headers: ['Content-Type' => 'application/json']);

        if ($method === 'HEAD') {
            // A HEAD response never has a body (Slim drops it), so only status and headers can be checked.
            self::assertSame(405, $response->getStatusCode());
            self::assertSame('application/problem+json', $response->getHeaderLine('Content-Type'));
            self::assertSame('', (string) $response->getBody());
        } else {
            $this->assertProblem(ProblemType::MethodNotAllowed, $response);
        }
        self::assertSame($allow, $response->getHeaderLine('Allow'));
        self::assertSame(0, $this->churchTools->writeCount());
        self::assertSame([], $this->churchTools->calls(), 'The endpoint never ran.');
    }

    public function testHeadOnAnUnknownRouteIsNotFound(): void
    {
        $response = $this->request('HEAD', '/v1/nothing', self::USER);

        self::assertSame(404, $response->getStatusCode());
        self::assertSame('application/problem+json', $response->getHeaderLine('Content-Type'));
    }

    // ---------------------------------------------------------------- RX-07 long header and path (spec 4.1)

    public function testAVeryLongAuthorizationHeaderOrPathIsRejectedCleanly(): void
    {
        $warnings = [];
        set_error_handler(static function (int $level, string $message) use (&$warnings): bool {
            $warnings[] = $message;

            return true;
        });
        try {
            $longHeader = $this->request('GET', '/v1/entries/' . self::USER, headers: ['Authorization' => 'Bearer ' . str_repeat('a', 64 * 1024)]);
            $longPath = $this->request('GET', '/v1/' . str_repeat('a', 64 * 1024), self::USER);
        } finally {
            restore_error_handler();
        }

        $this->assertProblem(ProblemType::InvalidToken, $longHeader);
        $this->assertProblem(ProblemType::NotFound, $longPath);
        self::assertSame([], $warnings, 'No PHP warning, notice or deprecation.');
        // The rejected token is logged as a warning, like any other; nothing is an error and no record repeats the input.
        foreach ($this->log->getRecords() as $record) {
            self::assertLessThan(\Monolog\Logger::ERROR, $record['level'], (string) $record['message']);
            self::assertStringNotContainsString(str_repeat('a', 256), $record['message'] . json_encode($record['context'], JSON_THROW_ON_ERROR));
        }
    }
}
