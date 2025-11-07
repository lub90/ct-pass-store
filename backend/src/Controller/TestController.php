<?php

declare(strict_types=1);

namespace CtPassStore\Controller;

use CtPassStore\Service\BaseService;
use Psr\Log\LoggerInterface;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use CtPassStore\Service\ServiceSettings;
use Slim\Psr7\Factory\ResponseFactory;
use Throwable;

class TestController extends BaseService
{
    private ServiceSettings $settings;

    public function __construct(ServiceSettings $settings, LoggerInterface $logger)
    {
        parent::__construct($logger);

        $this->settings = $settings;
    }

    public function get(Request $request, Response $response): Response
    {
        $tests = [];

        // List of methods to test
        $methods = [
            'requirePasswordForPasswordChange',
            'allowCustomPasswords',
            'adminUsers',
            'readAccessUsers',
            'pwdLength',
        ];

        $allPassed = true;

        foreach ($methods as $method) {
            try {
                $result = $this->settings->{$method}();
                $tests[] = [
                    'name' => "ServiceSettings::{$method}()",
                    'status' => 'ok',
                    'message' => "Settings object for {$method} can be accessed.",
                ];
            } catch (Throwable $e) {
                $allPassed = false;
                $tests[] = [
                    'name' => "ServiceSettings::{$method}()",
                    'status' => 'fail',
                    'message' => $e->getMessage(),
                ];
            }
        }


        try {
            $envPath = dirname(__DIR__, 2) . '/.env';
            $perms = fileperms($envPath);

            // Check if file is readable only by owner (0600 or stricter)
            $isStrict = ($perms & 0x1FF) <= 0o600;

            if (!$isStrict) {
                throw new \RuntimeException(sprintf(
                    '.env file permissions too loose: %o. Expected 0600 or stricter.',
                    $perms & 0x1FF
                ));
            }

            $tests[] = [
                'name' => '.env file permission check',
                'status' => 'ok',
                'message' => '.env file has secure permissions (0600 or stricter).',
            ];
        } catch (Throwable $e) {
            $allPassed = false;
            $tests[] = [
                'name' => '.env file permission check',
                'status' => 'fail',
                'message' => $e->getMessage(),
            ];
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
