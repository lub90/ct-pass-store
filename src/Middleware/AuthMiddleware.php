<?php

declare(strict_types=1);

namespace CtPassStore\Middleware;

use Psr\Http\Message\ServerRequestInterface as Request;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Server\RequestHandlerInterface as Handler;
use Psr\Http\Server\MiddlewareInterface;
use CtPassStore\Service\ChurchtoolsAuth;
use Monolog\Logger;

/**
 * Middleware that validates ChurchTools token and attaches user info to the request.
 */
class AuthMiddleware implements MiddlewareInterface
{

    private ChurchtoolsAuth $auth;
    private Logger $logger;

    public function __construct(ChurchtoolsAuth $auth, Logger $logger)
    {
        $this->auth = $auth;
        $this->logger = $logger;
    }

    public function process(Request $request, Handler $handler): Response
    {

        $token = $request->getHeaderLine('Authorization');


        if (empty($token)) {
            $this->logger?->warning('Unauthorized access attempt: Missing Authorization header!', ['ip' => $request->getServerParams()['REMOTE_ADDR']]);
            return $this->unauthorized($request, 'Missing Authorization header!');
        }

        $user = $this->auth->validateToken($token);

        if (!$user || !isset($user['id'])) {
            $this->logger?->warning('Unauthorized access attempt: Invalid ChurchTools token!', ['ip' => $request->getServerParams()['REMOTE_ADDR']]);
            return $this->unauthorized($request, 'Invalid ChurchTools token!');
        }

        // Attach user info to request attributes
        $request = $request->withAttribute('user', $user);

        return $handler->handle($request);
    }

    /**
     * Returns a 403 response with a JSON error message.
     */
    private function unauthorized(Request $request, string $reason): Response
    {
        $responseFactory = new \Slim\Psr7\Factory\ResponseFactory();
        $response = $responseFactory->createResponse(403);
        $response->getBody()->write(json_encode([
            'error' => 'Unauthorized',
            'reason' => $reason,
        ]));
        return $response->withHeader('Content-Type', 'application/json');
    }
}
