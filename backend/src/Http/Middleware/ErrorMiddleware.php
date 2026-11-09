<?php

declare(strict_types=1);

namespace CtPassStore\Http\Middleware;

use CtPassStore\Application\Failure\Failure;
use CtPassStore\Http\Problem\ProblemException;
use CtPassStore\Http\Problem\ProblemMapping;
use CtPassStore\Http\Problem\ProblemResponseFactory;
use CtPassStore\Http\Problem\ProblemType;
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
            $e instanceof Failure => $this->fromFailure($e),
            $e instanceof HttpNotFoundException => new ProblemException(
                ProblemType::NotFound,
                'There is no endpoint ' . $request->getUri()->getPath() . '.',
            ),
            $e instanceof HttpMethodNotAllowedException => new ProblemException(
                ProblemType::MethodNotAllowed,
                'The endpoint doesn\'t support ' . $request->getMethod() . '.',
                headers: ['Allow' => implode(', ', $e->getAllowedMethods())],
            ),
            default => $this->logged($e, new ProblemException(
                ProblemType::InternalError,
                'An unexpected error occurred. Details are in the backend log.',
            )),
        };
    }

    /**
     * Refusals (4xx) are answered with the failure's own text and logged where they happen; failures of the backend or
     * of ChurchTools (5xx) are logged here, with their reason.
     */
    private function fromFailure(Failure $e): ProblemException
    {
        $reason = $e->reason();
        $type = ProblemMapping::type($reason);
        $extensions = $e->extensions();
        $headers = [];
        $retryAfter = $e->retryAfterSeconds();
        if ($retryAfter !== null) {
            $extensions['retryAfter'] = $retryAfter;
            $headers['Retry-After'] = (string) $retryAfter;
        }
        $problem = new ProblemException($type, $e->publicDetail() ?? ProblemMapping::fixedDetail($reason), $extensions, $headers);

        return $type->status() >= 500 ? $this->logged($e, $problem, $reason->value) : $problem;
    }

    private function logged(\Throwable $cause, ProblemException $problem, ?string $reason = null): ProblemException
    {
        $this->logger->error($problem->type->value . ': ' . $cause->getMessage(), [
            'reason' => $reason,
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
