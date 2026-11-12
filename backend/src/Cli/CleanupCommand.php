<?php

declare(strict_types=1);

namespace CtPassStore\Cli;

use CtPassStore\Application\Cleanup\CleanupLock;
use CtPassStore\Application\Cleanup\CleanupLockUnavailableException;
use CtPassStore\Application\Cleanup\CleanupOrphans;
use CtPassStore\Application\Cleanup\CleanupReport;
use CtPassStore\Application\Exception\ConfigurationException;
use CtPassStore\Application\Exception\PersonsNotReadableException;
use CtPassStore\Application\Failure\Failure;
use Psr\Log\LoggerInterface;
use Psr\Log\LogLevel;

/**
 * `php bin/cleanup.php [--apply]` (cleanup design 4). Dry run by default. Exit codes: 0 done, 1 done but an admin
 * is gone or a delete failed, 2 aborted or misused. Output names person IDs only; every printed line is also logged.
 */
final class CleanupCommand
{
    public function __construct(
        private readonly CleanupOrphans $cleanup,
        private readonly CleanupLock $lock,
        private readonly LoggerInterface $logger,
    ) {}

    /**
     * @param list<string> $arguments
     * @param resource $out
     * @param resource $err
     */
    public function run(array $arguments, $out, $err): int
    {
        if ($arguments !== [] && $arguments !== ['--apply']) {
            $this->line($err, 'Usage: php bin/cleanup.php [--apply]', LogLevel::ERROR);

            return 2;
        }
        $apply = $arguments === ['--apply'];

        try {
            $acquired = $this->lock->tryAcquire();
        } catch (CleanupLockUnavailableException) {
            $this->line($err, 'Cannot open the lock file cache/cleanup.lock; check that cache/ exists and is writable by this user.', LogLevel::ERROR);

            return 2;
        }
        if (!$acquired) {
            $this->line($err, 'Another cleanup is running.', LogLevel::ERROR);

            return 2;
        }
        try {
            $report = $this->cleanup->run($apply);
        } catch (PersonsNotReadableException|ConfigurationException $e) {
            $this->line($err, $e->getMessage(), LogLevel::ERROR);

            return 2;
        } catch (Failure $e) {
            $this->line($err, 'Aborted, nothing was deleted: ' . $e->getMessage(), LogLevel::ERROR);

            return 2;
        } finally {
            $this->lock->release();
        }

        $this->print($report, $out, $err);

        return $report->exitCode();
    }

    /**
     * @param resource $out
     * @param resource $err
     */
    private function print(CleanupReport $report, $out, $err): void
    {
        foreach ($report->gone as $person) {
            if (!$report->applied) {
                $this->line($out, "would delete entry of person {$person->value} (dry run)");
            } elseif (!isset($report->failedDeletes[$person->value])) {
                $this->line($out, "deleted entry of person {$person->value}");
            }
        }
        foreach ($report->goneAdmins as $person) {
            $this->line($err, "adminUsers contains person {$person->value}, who is deleted or archived; remove them in the extension settings", LogLevel::WARNING);
        }
        foreach ($report->failedDeletes as $personId => $message) {
            $this->line($err, "could not delete the entry of person {$personId}: {$message}; the next run retries it", LogLevel::WARNING);
        }

        $count = $report->applied ? $report->deletedCount() : count($report->gone);
        $this->line($out, sprintf(
            'checked %d %s, %s %d %s%s',
            $report->checked,
            $report->checked === 1 ? 'person' : 'persons',
            $report->applied ? 'deleted' : 'would delete',
            $count,
            $count === 1 ? 'entry' : 'entries',
            $report->applied ? '' : ' (dry run)',
        ));
    }

    /**
     * @param resource $stream
     */
    private function line($stream, string $text, string $level = LogLevel::INFO): void
    {
        fwrite($stream, $text . "\n");
        $this->logger->log($level, $text);
    }
}
