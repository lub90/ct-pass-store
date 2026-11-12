<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\SelfCheck;

use CtPassStore\Application\Failure\Failure;
use CtPassStore\Application\GoneAdmins;
use CtPassStore\Application\Port\SettingsRepository;
use CtPassStore\Application\SelfCheck\Check;
use CtPassStore\Application\SelfCheck\CheckOutcome;
use Psr\Log\LoggerInterface;

/**
 * Every person in `adminUsers` still exists and isn't archived (cleanup design 3.7). Messages name person IDs only.
 */
final class AdminUsersCheck implements Check
{
    public function __construct(
        private readonly SettingsRepository $settings,
        private readonly GoneAdmins $goneAdmins,
        private readonly LoggerInterface $logger,
    ) {}

    public function name(): string
    {
        return 'Admin users';
    }

    public function run(): CheckOutcome
    {
        try {
            $gone = $this->goneAdmins->find($this->settings->settings());
        } catch (Failure $e) {
            // Failure messages on this path are log-safe: ChurchTools ones name method, path and status, the settings
            // ones name keys and categories. None carries a token.
            $this->logger->error('The admin users could not be checked: ' . $e->getMessage(), ['exception' => $e::class]);

            return CheckOutcome::fail('The persons in adminUsers can\'t be checked right now; see the log.');
        }

        if ($gone === []) {
            return CheckOutcome::ok('Every person in adminUsers exists.');
        }
        $ids = implode(', ', array_map(static fn($id): string => (string) $id, $gone));

        return CheckOutcome::fail(
            count($gone) === 1
                ? "adminUsers contains person $ids, who is deleted or archived; remove them in the extension settings."
                : "adminUsers contains persons $ids, who are deleted or archived; remove them in the extension settings.",
        );
    }
}
