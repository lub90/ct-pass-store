<?php

declare(strict_types=1);

namespace CtPassStore\Http\Controller;

use CtPassStore\Application\Port\SettingsRepository;
use CtPassStore\Application\SelfCheck\SelfCheck;
use CtPassStore\Domain\PersonPrincipal;
use CtPassStore\Http\Middleware\AuthMiddleware;
use CtPassStore\Http\Problem\ProblemException;
use CtPassStore\Http\Problem\ProblemType;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * `GET /v1/test`: the admin self-check (spec 4.8). Only admins; the check happens before anything runs.
 */
final class SelfCheckController
{
    public function __construct(
        private readonly SettingsRepository $settings,
        private readonly SelfCheck $selfCheck,
        private readonly string $version,
    ) {}

    public function get(Request $request, Response $response): Response
    {
        $principal = $request->getAttribute(AuthMiddleware::PRINCIPAL);
        if (!$principal instanceof PersonPrincipal || !$this->settings->settings()->isAdmin($principal->id)) {
            throw new ProblemException(ProblemType::Forbidden, 'Only admins can run the self-check.');
        }

        $result = $this->selfCheck->run();
        $summary = $result['passed']
            ? 'All backend self-tests passed successfully.'
            : 'Backend self-test completed with failures.';

        $response->getBody()->write(json_encode([
            'version' => $this->version,
            'summary' => $summary,
            'tests' => $result['tests'],
        ], JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));

        return $response
            ->withHeader('Content-Type', 'application/json')
            ->withStatus($result['passed'] ? 200 : 207);
    }
}
