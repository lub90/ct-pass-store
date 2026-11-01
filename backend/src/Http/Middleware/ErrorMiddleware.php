<?php

declare(strict_types=1);

namespace CtPassStore\Http\Middleware;

use CtPassStore\Application\Exception\AccessDeniedException;
use CtPassStore\Application\Exception\ApplicationException;
use CtPassStore\Application\Exception\CustomPasswordNotAllowedException;
use CtPassStore\Application\Exception\EntryNotFoundException;
use CtPassStore\Application\Exception\InvalidPrimaryPasswordException;
use CtPassStore\Application\Exception\PasswordRejectedException;
use CtPassStore\Application\Exception\PrimaryPasswordRequiredException;
use CtPassStore\Config\ConfigurationException;
use CtPassStore\Http\Problem\ProblemException;
use CtPassStore\Http\Problem\ProblemResponseFactory;
use CtPassStore\Http\Problem\ProblemType;
use CtPassStore\Infrastructure\ChurchTools\Exception\InvalidResponseException;
use CtPassStore\Infrastructure\ChurchTools\Exception\NotAuthenticatedException;
use CtPassStore\Infrastructure\ChurchTools\Exception\NotFoundException;
use CtPassStore\Infrastructure\ChurchTools\Exception\NotPermittedException;
use CtPassStore\Infrastructure\ChurchTools\Exception\RateLimitedException;
use CtPassStore\Infrastructure\ChurchTools\Exception\ServiceCredentialRejectedException;
use CtPassStore\Infrastructure\ChurchTools\Exception\UnavailableException;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;
use Psr\Log\LoggerInterface;
use Slim\Exception\HttpMethodNotAllowedException;
use Slim\Exception\HttpNotFoundException;

/**
 * Turns every exception into a problem details response (spec 4.9, 5.7). This is the only place where that
 * happens, so the answer is always `application/problem+json`, whatever the client accepts.
 */
final class ErrorMiddleware implements MiddlewareInterface
{
    public function __construct(private readonly LoggerInterface $logger) {}

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        try {
            return $handler->handle($request);
        } catch (\Throwable $e) {
            return ProblemResponseFactory::fromException($this->toProblem($e, $request));
        }
    }

    private function toProblem(\Throwable $e, ServerRequestInterface $request): ProblemException
    {
        return match (true) {
            $e instanceof ProblemException => $e,
            $e instanceof ApplicationException => self::fromApplication($e),
            $e instanceof HttpNotFoundException => new ProblemException(
                ProblemType::NotFound,
                'There is no endpoint ' . $request->getUri()->getPath() . '.',
            ),
            $e instanceof HttpMethodNotAllowedException => new ProblemException(
                ProblemType::MethodNotAllowed,
                'The endpoint doesn\'t support ' . $request->getMethod() . '.',
                headers: ['Allow' => implode(', ', $e->getAllowedMethods())],
            ),
            $e instanceof ConfigurationException => $this->logged($e, new ProblemException(ProblemType::Misconfigured, $e->getMessage())),
            $e instanceof ServiceCredentialRejectedException => $this->logged($e, new ProblemException(
                ProblemType::Misconfigured,
                'ChurchTools rejected the service user\'s token or permissions. Check CT_API_TOKEN in credentials.php and the service user\'s rights.',
            )),
            $e instanceof NotFoundException => $this->logged($e, new ProblemException(
                ProblemType::Misconfigured,
                'ChurchTools doesn\'t know the extension module or one of its categories. Check that the extension is installed and its setup completed.',
            )),
            $e instanceof RateLimitedException => $this->logged($e, new ProblemException(
                ProblemType::UpstreamRateLimited,
                'ChurchTools limits the number of requests. Try again later.',
                ['retryAfter' => $e->retryAfterSeconds],
                ['Retry-After' => (string) $e->retryAfterSeconds],
            )),
            $e instanceof UnavailableException => $this->logged($e, new ProblemException(
                ProblemType::UpstreamUnavailable,
                'ChurchTools is unreachable or answered with an error.',
            )),
            // A user call rejected where the code doesn't expect it: ChurchTools behaves differently than assumed.
            $e instanceof NotAuthenticatedException, $e instanceof NotPermittedException,
            $e instanceof InvalidResponseException => $this->logged($e, new ProblemException(
                ProblemType::UpstreamInvalid,
                'ChurchTools answered something the backend can\'t use.',
            )),
            default => $this->logged($e, new ProblemException(
                ProblemType::InternalError,
                'An unexpected error occurred. Details are in the backend log.',
            )),
        };
    }

    /**
     * Refused requests: the client gets the use case's message; the use cases log what's worth logging.
     */
    private static function fromApplication(ApplicationException $e): ProblemException
    {
        $type = match (true) {
            $e instanceof AccessDeniedException => ProblemType::Forbidden,
            $e instanceof EntryNotFoundException => ProblemType::EntryNotFound,
            $e instanceof PrimaryPasswordRequiredException => ProblemType::PrimaryPasswordRequired,
            $e instanceof InvalidPrimaryPasswordException => ProblemType::InvalidPrimaryPassword,
            $e instanceof CustomPasswordNotAllowedException => ProblemType::CustomPasswordNotAllowed,
            $e instanceof PasswordRejectedException => ProblemType::PasswordInvalid,
            default => throw new \LogicException('No problem type for ' . $e::class . '.', 0, $e),
        };

        return new ProblemException($type, $e->getMessage(), $e instanceof PasswordRejectedException ? ['violations' => $e->violations] : []);
    }

    private function logged(\Throwable $cause, ProblemException $problem): ProblemException
    {
        $this->logger->error($problem->type->value . ': ' . $cause->getMessage(), [
            'exception' => $cause::class,
            'file' => $cause->getFile() . ':' . $cause->getLine(),
            'trace' => self::traceWithoutArguments($cause),
        ]);

        return $problem;
    }

    /**
     * The stack trace without function arguments. `getTraceAsString()` may include arguments, and those can be
     * passwords or tokens (spec 6.3: no secrets in logs).
     *
     * @return list<string>
     */
    private static function traceWithoutArguments(\Throwable $e): array
    {
        $lines = [];
        foreach ($e->getTrace() as $frame) {
            $lines[] = sprintf(
                '%s:%s %s%s%s()',
                $frame['file'] ?? '[internal]',
                $frame['line'] ?? '?',
                $frame['class'] ?? '',
                $frame['type'] ?? '',
                $frame['function'],
            );
        }

        return $lines;
    }
}
