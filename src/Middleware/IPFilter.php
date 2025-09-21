<?php

declare(strict_types=1);

namespace CtPassStore\Middleware;

use Psr\Http\Message\ServerRequestInterface as Request;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Server\RequestHandlerInterface as Handler;
use Psr\Http\Server\MiddlewareInterface;
use CtPassStore\Util\CIDRMatcher;
use Monolog\Logger;

/**
 * Middleware that restricts access based on client IP address.
 */
class IPFilter implements MiddlewareInterface
{
    /** @var string[] */
    private array $allowedCidrs;
    private Logger $logger;

    public function __construct(array $allowedCidrs, Logger $logger)
    {
        $this->allowedCidrs = $allowedCidrs;
        $this->logger = $logger;
    }

    public function process(Request $request, Handler $handler): Response
    {
        $ip = $request->getServerParams()['REMOTE_ADDR'] ?? '';

        foreach ($this->allowedCidrs as $cidr) {
            if (CIDRMatcher::match($ip, $cidr)) {
                return $handler->handle($request);
            }
        }

        $this->logger?->warning('Access attempt from invalid ip!', ['ip' => $ip]);


        $responseFactory = new \Slim\Psr7\Factory\ResponseFactory();
        $response = $responseFactory->createResponse(403);
        $response->getBody()->write(json_encode([
            'error' => 'Forbidden',
            'reason' => 'IP address not allowed',
        ]));
        return $response->withHeader('Content-Type', 'application/json');
    }
}
