<?php

declare(strict_types=1);

namespace CtPassStore\Http\Middleware;

use CtPassStore\Application\Auth\AddressLimit;
use CtPassStore\Application\Auth\Authenticator;
use CtPassStore\Application\Exception\InvalidTokenException;
use CtPassStore\Application\Exception\TokenExpiredException;
use CtPassStore\Application\Exception\TooManyAttemptsException;
use CtPassStore\Application\Port\AddressLimiter;
use CtPassStore\Http\Problem\ProblemException;
use CtPassStore\Http\Problem\ProblemType;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface as Handler;
use Psr\Log\LoggerInterface;

/**
 * Requires `Authorization: Bearer <token>` and attaches the authenticated principal (person or machine client) to the
 * request (spec 4.3). Makes no ChurchTools call.
 */
final class AuthMiddleware implements MiddlewareInterface
{
    /** The request attribute that holds the authenticated Principal. */
    public const PRINCIPAL = 'principal';

    public function __construct(
        private readonly Authenticator $authenticator,
        private readonly AddressLimiter $limiter,
        private readonly LoggerInterface $logger,
    ) {}

    public function process(Request $request, Handler $handler): Response
    {
        // Always REMOTE_ADDR: forwarding headers can't be trusted on shared hosting (spec 6.3).
        $ip = (string) ($request->getServerParams()['REMOTE_ADDR'] ?? '');
        $headers = $request->getHeader('Authorization');

        if ($headers === []) {
            $this->logger->warning('Unauthorized access attempt: missing Authorization header.', ['ip' => $ip]);
            throw new ProblemException(ProblemType::MissingToken, 'The request needs an Authorization header with a bearer token.');
        }

        // One header with the scheme in any case, a single space and a token without whitespace or commas
        // (spec 4.3.2). Several headers or a comma-joined value are never guessed at.
        if (count($headers) !== 1 || preg_match('/^bearer ([^\s,]+)\z/i', $headers[0], $match) !== 1) {
            $this->logger->warning('Unauthorized access attempt: the Authorization header isn\'t a single bearer token.', ['ip' => $ip]);
            // Rejected with 401 invalid-token like a forged token, so it counts the same (spec 6.3).
            $this->countRejection($ip, new ProblemException(ProblemType::InvalidToken, 'The Authorization header must be "Bearer <token>".'));
        }

        try {
            $principal = $this->authenticator->authenticate($match[1]);
        } catch (InvalidTokenException|TokenExpiredException $e) {
            $this->logger->warning('Unauthorized access attempt: ' . ($e instanceof TokenExpiredException ? 'expired token.' : 'invalid token.'), ['ip' => $ip]);
            if ($e instanceof InvalidTokenException) {
                $this->countRejection($ip, $e);
            }
            throw $e;
        }

        return $handler->handle($request->withAttribute(self::PRINCIPAL, $principal));
    }

    /**
     * Only a rejected token counts against the address, and only after verification: a valid token never touches the
     * limiter, so one address's garbage can't lock out others behind the same bucket (spec 6.3). A blocked address
     * gets 429 instead of 401.
     */
    private function countRejection(string $ip, \Throwable $rejection): never
    {
        try {
            $this->limiter->hit(AddressLimit::RejectedToken, $ip);
        } catch (TooManyAttemptsException $blocked) {
            $this->logger->warning('Too many rejected tokens from this address.', ['ip' => $ip]);
            throw $blocked;
        }

        throw $rejection;
    }
}
