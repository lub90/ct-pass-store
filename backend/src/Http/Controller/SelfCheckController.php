<?php

declare(strict_types=1);

namespace CtPassStore\Http\Controller;

use CtPassStore\Infrastructure\Kv\KvSettingsRepository;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Throwable;

/**
 * `GET /test`. Phase 4 (plan item 4.2) extends the checks and restricts access to admins.
 */
final class SelfCheckController
{
    public function __construct(
        private readonly KvSettingsRepository $settings,
        private readonly string $credentialsPath,
    ) {}

    public function get(Request $request, Response $response): Response
    {
        $allPassed = true;

        $tests = [];

        try {
            $credentialsPath = $this->credentialsPath;

            if (!file_exists($credentialsPath)) {
                throw new \RuntimeException('credentials.php file does not exist.');
            }

            $perms = fileperms($credentialsPath);

            // Check if file is readable only by owner (0600 or stricter)
            $isStrict = ($perms & 0x1FF) <= 0o600;

            if (!$isStrict) {
                $allPassed = false;
                throw new \RuntimeException(sprintf(
                    'credentials.php file permissions too loose: %o. Expected 0600 or stricter.',
                    $perms & 0x1FF
                ));
            }

            $tests[] = [
                'name' => 'credentials.php file permission check',
                'status' => 'ok',
                'message' => 'credentials.php file has secure permissions (0600 or stricter).',
            ];
        } catch (Throwable $e) {
            $allPassed = false;
            $tests[] = [
                'name' => 'credentials.php file permission check',
                'status' => 'fail',
                'message' => $e->getMessage(),
            ];
        }

        $checks = [
            'Extension settings' => fn() => $this->settings->settings(),
            'Public key' => fn() => $this->settings->publicKey(),
        ];

        foreach ($checks as $name => $check) {
            try {
                $check();
                $tests[] = [
                    'name' => $name,
                    'status' => 'ok',
                    'message' => "$name can be loaded.",
                ];
            } catch (Throwable $e) {
                $allPassed = false;
                $tests[] = [
                    'name' => $name,
                    'status' => 'fail',
                    'message' => $e->getMessage(),
                ];
            }
        }

        $summary = $allPassed
            ? 'All backend self-tests passed successfully.'
            : 'Backend self-test completed with failures.';

        $statusCode = $allPassed ? 200 : 207;

        $response->getBody()->write(json_encode([
            'summary' => $summary,
            'tests' => $tests,
        ], JSON_PRETTY_PRINT));

        return $response
            ->withHeader('Content-Type', 'application/json')
            ->withStatus($statusCode);
    }
}
