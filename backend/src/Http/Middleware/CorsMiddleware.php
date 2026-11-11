<?php

declare(strict_types=1);

namespace CtPassStore\Http\Middleware;

use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface as Handler;

/**
 * CORS for the configured origins (spec 4.2).
 *
 * The `Origin` header is compared exactly with the `CORS` list and echoed back; `*` and `Access-Control-Allow-Credentials`
 * are never sent (bearer tokens, no cookies). Preflights (`OPTIONS`) are answered here with `204`, before any other
 * check, and never reach an endpoint. Every response varies by `Origin`.
 */
final class CorsMiddleware implements MiddlewareInterface
{
    /**
     * @param list<string> $allowedOrigins
     */
    public function __construct(private readonly array $allowedOrigins) {}

    public function process(Request $request, Handler $handler): Response
    {
        $response = $request->getMethod() === 'OPTIONS'
            ? new \Slim\Psr7\Response(204)
            : $handler->handle($request);

        return $this->withCorsHeaders($response, $request->getHeaderLine('Origin'));
    }

    private function withCorsHeaders(Response $response, string $origin): Response
    {
        $response = $response->withAddedHeader('Vary', 'Origin');
        if (!in_array($origin, $this->allowedOrigins, true)) {
            return $response;
        }

        return $response->withHeader('Access-Control-Allow-Origin', $origin)
            ->withHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
            ->withHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
            ->withHeader('Access-Control-Max-Age', '600');
    }
}
