<?php

declare(strict_types=1);

namespace CtPassStore\Http\Middleware;

use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;
use Slim\Exception\HttpMethodNotAllowedException;
use Slim\Routing\RouteContext;

/**
 * Answers `HEAD` with `405` and the route's `Allow` header (spec 4.1). Slim routes `HEAD` to the `GET` handler when no
 * `HEAD` route exists; this runs right after routing, so that handler never runs. An unknown path is `404` already.
 */
final class HeadNotAllowedMiddleware implements MiddlewareInterface
{
    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        if ($request->getMethod() === 'HEAD') {
            $exception = new HttpMethodNotAllowedException($request);
            $exception->setAllowedMethods(RouteContext::fromRequest($request)->getRoutingResults()->getAllowedMethods());

            throw $exception;
        }

        return $handler->handle($request);
    }
}
