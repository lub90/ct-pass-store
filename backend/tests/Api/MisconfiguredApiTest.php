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
        yield 'GET entry' => ['GET', '/v1/entries/1'];
        yield 'PUT entry' => ['PUT', '/v1/entries/1'];
        yield 'unknown route' => ['GET', '/nothing'];
        yield 'preflight' => ['OPTIONS', '/v1/entries/1'];
    }

    #[DataProvider('requests')]
    public function testEveryRequestIsMisconfiguredWithoutCorsHeaders(string $method, string $path): void
    {
        $request = (new ServerRequestFactory())->createServerRequest($method, 'https://backend.example.org' . $path)
            ->withHeader('Origin', 'https://example.church.tools')
            ->withHeader('Access-Control-Request-Method', 'PUT');

        // A real credentials.php whose CORS key is broken, loaded the way public/index.php loads it.
        $credentials = (string) tempnam(sys_get_temp_dir(), 'ctps-broken-');
        file_put_contents($credentials, "<?php return ['CT_API_URL' => 'https://example.church.tools/api', 'CT_API_TOKEN' => 'x', 'CORS' => '*'];");
        $previous = ini_set('error_log', '/dev/null');
        try {
            $response = Application::bootstrap($credentials, sys_get_temp_dir(), '/dev/null')->handle($request);
        } finally {
            ini_set('error_log', (string) $previous);
            unlink($credentials);
        }

        self::assertSame(500, $response->getStatusCode());
        self::assertSame('application/problem+json', $response->getHeaderLine('Content-Type'));
        $body = json_decode((string) $response->getBody(), true);
        self::assertIsArray($body);
        self::assertSame(ProblemType::Misconfigured->uri(), $body['type']);
        self::assertStringContainsString('CORS', (string) $body['detail']);
        self::assertFalse($response->hasHeader('Access-Control-Allow-Origin'));
    }

    public function testAMissingCredentialsFileIsMisconfigured(): void
    {
        $previous = ini_set('error_log', '/dev/null');
        try {
            $response = Application::bootstrap(sys_get_temp_dir() . '/no-such-credentials.php', sys_get_temp_dir(), '/dev/null')
                ->handle((new ServerRequestFactory())->createServerRequest('GET', 'https://backend.example.org/v1/entries/1'));
        } finally {
            ini_set('error_log', (string) $previous);
        }

        self::assertSame(500, $response->getStatusCode());
        $body = json_decode((string) $response->getBody(), true);
        self::assertIsArray($body);
        self::assertStringContainsString('credentials.php is missing', (string) $body['detail']);
    }
}
