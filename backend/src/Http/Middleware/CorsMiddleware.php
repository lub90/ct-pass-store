<?php

declare(strict_types=1);

namespace CtPassStore\Http\Middleware;

use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface as Handler;

class CorsMiddleware implements MiddlewareInterface
{
    /**
     * @param list<string> $allowedOrigins
     */
    public function __construct(private readonly array $allowedOrigins) {}

    public function process(Request $request, Handler $handler): Response
    {
        $origin = $request->getHeaderLine('Origin');

        // Handle preflight OPTIONS request
        if ($request->getMethod() === 'OPTIONS') {
            $response = new \Slim\Psr7\Response();
            return $this->addCorsHeaders($response, $origin);
        }

        // Normal request → run next handler
        $response = $handler->handle($request);
        return $this->addCorsHeaders($response, $origin);
    }

    private function addCorsHeaders(Response $response, string $origin): Response
    {
        if (in_array($origin, $this->allowedOrigins, true)) {
            $response = $response->withHeader('Access-Control-Allow-Origin', $origin)
                ->withHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
                ->withHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
                ->withHeader('Access-Control-Allow-Credentials', 'true');
        }
        return $response;
    }
}
