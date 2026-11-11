<?php

declare(strict_types=1);

namespace CtPassStore\Http\Middleware;

use CtPassStore\Http\Problem\ProblemResponseFactory;
use CtPassStore\Http\Problem\ProblemType;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * Rejects plain HTTP with `400 https-required` (spec 4.1, Q17), for hosts that ignore `.htaccess`.
 *
 * The condition is exactly the one of the `.htaccess` redirect: the server variable `HTTPS` is missing, empty or `off`
 * (any case). So a host where the redirect works never gets this answer from PHP (Review Focus 4). Forwarding headers
 * such as `X-Forwarded-Proto` are ignored, like everywhere (spec 6.3).
 */
final class HttpsOnlyMiddleware implements MiddlewareInterface
{
    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        $https = $request->getServerParams()['HTTPS'] ?? '';
        if (!is_string($https) || $https === '' || strtolower($https) === 'off') {
            return ProblemResponseFactory::create(ProblemType::HttpsRequired, 'The backend only answers over HTTPS. Use its https:// URL.');
        }

        return $handler->handle($request);
    }
}
