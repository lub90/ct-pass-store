<?php

declare(strict_types=1);

namespace CtPassStore\Middleware;

use Psr\Http\Message\ServerRequestInterface as Request;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Server\RequestHandlerInterface as Handler;
use Psr\Http\Server\MiddlewareInterface;
use CtPassStore\Service\ChurchtoolsAuth;
use CtPassStore\Config\AppConfig;
use Monolog\Logger;
use ChurchTools\ApiException;

/**
 * Middleware that validates ChurchTools token and attaches user info to the request.
 */
class AuthMiddleware implements MiddlewareInterface
{

    private const AUTH_HEADER_PREFIX = "Login ";

    private ChurchtoolsAuth $auth;
    private Logger $logger;

    public function __construct(ChurchtoolsAuth $auth, Logger $logger)
    {
        $this->auth = $auth;
        $this->logger = $logger;
    }

    public function process(Request $request, Handler $handler): Response
    {
        $requestHeader = $request->getHeaderLine('Authorization')  ?? '';

        if (empty($requestHeader)) {
            $this->logger?->warning('Unauthorized access attempt: Missing Authorization header!', ['ip' => $request->getServerParams()['REMOTE_ADDR']]);
            return $this->unauthorized($request, 'Missing Authorization header!');
        }

        if (!str_starts_with($requestHeader, AuthMiddleware::AUTH_HEADER_PREFIX)) {
            $this->logger?->warning('Unauthorized access attempt: Invalid or missing Login prefix in Authorization header!', [
                'ip' => $request->getServerParams()['REMOTE_ADDR']
            ]);
            return $this->unauthorized($request, 'Request header must startwith ' . AuthMiddleware::AUTH_HEADER_PREFIX);
        }

        $token = str_replace(AuthMiddleware::AUTH_HEADER_PREFIX, "", $requestHeader);

        

        // Check if we are able to login via the provided token
        $user = null;
        try {
            $user = $this->auth->validateToken($token);
        } catch (ApiException $e) {
            // Do nothing, because user becomes null and we fire the unathorized access part below
        }
        if (($user == null) || ($user->getId() == null) || ($user->getId() < 1)) {
            $this->logger?->warning('Unauthorized access attempt: Invalid ChurchTools token!', ['ip' => $request->getServerParams()['REMOTE_ADDR']]);
            return $this->unauthorized($request, 'Invalid ChurchTools token!');
        }

        // Check if the user has the right to access the service
        if (!$this->auth->hasAccessRights($token)) {
            $this->logger?->warning("Forbidden access attempt: User {$user->getId()} is not allowed to access the service!", ['ip' => $request->getServerParams()['REMOTE_ADDR']]);
            return $this->forbidden($request, 'User is not allowed to access the service!');
        }

        // Attach user info to request attributes
        $request = $request->withAttribute(AppConfig::USER_ATTRIBUTE, $user);

        return $handler->handle($request);
    }

    /**
     * Returns a 403 response with a JSON error message.
     */
    private function unauthorized(Request $request, string $reason): Response
    {
        return $this->accessDenied($request, 401, $reason);
    }

    private function forbidden(Request $request, string $reason): Response
    {
        return $this->accessDenied($request, 403, $reason);
    }

    private function accessDenied(Request $request, int $code, string $reason): Response
    {
        $responseFactory = new \Slim\Psr7\Factory\ResponseFactory();
        $response = $responseFactory->createResponse($code);
        $response->getBody()->write(json_encode([
            'error' => 'Unauthorized',
            'message' => $reason,
        ]));
        return $response->withHeader('Content-Type', 'application/json');
    }
}
