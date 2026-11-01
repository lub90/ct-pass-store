<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Api;

use CtPassStore\Application;
use CtPassStore\Http\Problem\ProblemType;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Slim\Psr7\Factory\ServerRequestFactory;

/**
 * Catalog CF-02 and CF-05: with a broken credentials.php every request, also a preflight, answers
 * 500 misconfigured without CORS headers.
 */
final class MisconfiguredApiTest extends TestCase
{
    /**
     * @return iterable<string, array{string, string}>
     */
    public static function requests(): iterable
    {
        yield 'GET entry' => ['GET', '/entries/1'];
        yield 'PUT entry' => ['PUT', '/entries/1'];
        yield 'unknown route' => ['GET', '/nothing'];
        yield 'preflight' => ['OPTIONS', '/entries/1'];
    }

    #[DataProvider('requests')]
    public function testEveryRequestIsMisconfiguredWithoutCorsHeaders(string $method, string $path): void
    {
        $request = (new ServerRequestFactory())->createServerRequest($method, 'https://backend.example.org' . $path)
            ->withHeader('Origin', 'https://example.church.tools')
            ->withHeader('Access-Control-Request-Method', 'PUT');

        $response = Application::misconfigured('CORS in credentials.php must be a non-empty list of origins.')->handle($request);

        self::assertSame(500, $response->getStatusCode());
        self::assertSame('application/problem+json', $response->getHeaderLine('Content-Type'));
        $body = json_decode((string) $response->getBody(), true);
        self::assertIsArray($body);
        self::assertSame(ProblemType::Misconfigured->uri(), $body['type']);
        self::assertStringContainsString('CORS', (string) $body['detail']);
        self::assertFalse($response->hasHeader('Access-Control-Allow-Origin'));
    }
}
