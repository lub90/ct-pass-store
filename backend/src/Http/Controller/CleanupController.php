<?php

declare(strict_types=1);

namespace CtPassStore\Http\Controller;

use CtPassStore\Application\Auth\AddressLimit;
use CtPassStore\Application\Cleanup\CleanupCooldown;
use CtPassStore\Application\Cleanup\CleanupLock;
use CtPassStore\Application\Cleanup\CleanupOrphans;
use CtPassStore\Application\Exception\CleanupRunningException;
use CtPassStore\Application\Exception\TooManyAttemptsException;
use CtPassStore\Application\Port\AddressLimiter;
use CtPassStore\Application\Port\Clock;
use CtPassStore\Http\Problem\ProblemException;
use CtPassStore\Http\Problem\ProblemType;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Log\LoggerInterface;

/**
 * `POST /v1/cleanup`: the web cron (cleanup design 5). Outside the JWT authentication: it accepts only
 * `CLEANUP_TOKEN`, and that token opens nothing else.
 *
 * Registered only when `CLEANUP_TOKEN` is usable; otherwise the path is unknown (`404`, design 5.1).
 *
 * Order of the checks (design 5.3): query → token → address limit (rejected tokens only) → cooldown →
 * lock → run. The response holds counts only; person IDs go to the log.
 */
final class CleanupController
{
    /** The run stops starting lookups this many seconds after the request came in (design 5.3, C9). */
    public const DEADLINE_SECONDS = 20;

    public function __construct(
        #[\SensitiveParameter]
        private readonly string $token,
        private readonly CleanupOrphans $cleanup,
        private readonly CleanupLock $lock,
        private readonly CleanupCooldown $cooldown,
        private readonly AddressLimiter $limiter,
        private readonly Clock $clock,
        private readonly LoggerInterface $logger,
    ) {}

    public function run(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $deadline = $this->clock->now()->modify('+' . self::DEADLINE_SECONDS . ' seconds');

        $query = $request->getQueryParams();
        if (array_key_exists('token', $query)) {
            throw new ProblemException(ProblemType::InvalidBody, 'Send the token in the Authorization header, never in the URL.');
        }
        $apply = $query['apply'] ?? null;
        if ($apply !== null && $apply !== '1') {
            throw new ProblemException(ProblemType::InvalidBody, 'apply accepts only the value 1.');
        }
        $apply = $apply === '1';

        $this->authenticate($request);

        $this->cooldown->start();
        if (!$this->lock->tryAcquire()) {
            $this->logger->info('Web-cron cleanup refused: another cleanup is running.');
            throw new CleanupRunningException('Another cleanup is running.');
        }
        try {
            $report = $this->cleanup->run($apply, $deadline);
        } finally {
            $this->lock->release();
        }

        $response->getBody()->write(json_encode([
            'applied' => $report->applied,
            'complete' => $report->isComplete(),
            'checked' => $report->checked,
            'gone' => count($report->gone),
            'deleted' => $report->deletedCount(),
            'failedDeletes' => count($report->failedDeletes),
            'goneAdmins' => count($report->goneAdmins),
        ], JSON_THROW_ON_ERROR));

        return $response->withHeader('Content-Type', 'application/json')->withStatus(200);
    }

    /**
     * Exactly one `Authorization: Bearer <CLEANUP_TOKEN>`, compared in constant time. Anything else is `401
     * invalid-token` and counts against the address (spec 6.3); a blocked address gets `429` instead. The right token
     * never touches the limiter, as in AuthMiddleware.
     */
    private function authenticate(ServerRequestInterface $request): void
    {
        // Always REMOTE_ADDR: forwarding headers can't be trusted on shared hosting (spec 6.3).
        $ip = (string) ($request->getServerParams()['REMOTE_ADDR'] ?? '');
        $headers = $request->getHeader('Authorization');
        $given = count($headers) === 1 && preg_match('/^bearer ([^\s,]+)\z/i', $headers[0], $match) === 1 ? $match[1] : '';
        if ($given !== '' && hash_equals($this->token, $given)) {
            return;
        }

        $this->logger->warning('Unauthorized web-cron cleanup call: missing or wrong token.', ['ip' => $ip]);
        try {
            $this->limiter->hit(AddressLimit::RejectedToken, $ip);
        } catch (TooManyAttemptsException $blocked) {
            $this->logger->warning('Too many rejected tokens from this address.', ['ip' => $ip]);
            throw $blocked;
        }

        throw new ProblemException(ProblemType::InvalidToken, 'The request needs the header "Authorization: Bearer <CLEANUP_TOKEN>".');
    }
}
