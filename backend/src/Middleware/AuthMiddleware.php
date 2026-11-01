<?php

declare(strict_types=1);

namespace CtPassStore\Middleware;

use CtPassStore\ChurchTools\Exception\NotAuthenticatedException;
use CtPassStore\ChurchTools\Exception\NotPermittedException;
use CtPassStore\Config\AppConfig;
use CtPassStore\Http\Problem\ProblemException;
use CtPassStore\Http\Problem\ProblemType;
use CtPassStore\Service\ChurchtoolsAuth;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface as Handler;
use Psr\Log\LoggerInterface;

/**
 * Validates the ChurchTools login token and attaches the authenticated person to the request.
 *
 * Only "ChurchTools doesn't accept this token" gives 401. If ChurchTools can't be asked, the ChurchTools exception
 * propagates and the error middleware answers 502/503 (spec 4.3). Bearer tokens replace this in plan item 3.4.
 */
class AuthMiddleware implements MiddlewareInterface
{
    private const AUTH_HEADER_PREFIX = 'Login ';

    public function __construct(
        private readonly ChurchtoolsAuth $auth,
        private readonly LoggerInterface $logger,
    ) {}

    public function process(Request $request, Handler $handler): Response
    {
        $header = $request->getHeaderLine('Authorization');
        $ip = (string) ($request->getServerParams()['REMOTE_ADDR'] ?? '');

        if ($header === '') {
            $this->logger->warning('Unauthorized access attempt: missing Authorization header.', ['ip' => $ip]);
            throw new ProblemException(ProblemType::MissingToken, 'The request needs an Authorization header.');
        }

        if (!str_starts_with($header, self::AUTH_HEADER_PREFIX)) {
            $this->logger->warning('Unauthorized access attempt: wrong Authorization scheme.', ['ip' => $ip]);
            throw new ProblemException(ProblemType::InvalidToken, 'The Authorization header must use the scheme ' . trim(self::AUTH_HEADER_PREFIX) . '.');
        }

        $token = substr($header, strlen(self::AUTH_HEADER_PREFIX));

        try {
            $user = $this->auth->validateToken($token);
        } catch (NotAuthenticatedException|NotPermittedException|\InvalidArgumentException) {
            $user = null;
        }
        if ($user === null || $user->id < 1) {
            $this->logger->warning('Unauthorized access attempt: invalid ChurchTools token.', ['ip' => $ip]);
            throw new ProblemException(ProblemType::InvalidToken, 'ChurchTools doesn\'t accept the token.');
        }

        if (!$this->auth->hasAccessRights($token)) {
            $this->logger->warning("Forbidden access attempt: user {$user->id} has no access to the service.", ['ip' => $ip]);
            throw new ProblemException(ProblemType::NoServiceAccess, 'You don\'t have the right to use the CtPassStore extension.');
        }

        return $handler->handle($request->withAttribute(AppConfig::USER_ATTRIBUTE, $user));
    }
}
