<?php

declare(strict_types=1);

namespace CtPassStore\Application\SelfCheck;

use CtPassStore\Application\Exception\ApplicationException;
use Psr\Log\LoggerInterface;

/**
 * Runs the checks of the admin self-check (spec 4.8). A check that throws counts as failed; only the message of an
 * ApplicationException is shown, anything else is logged and replaced by a generic text.
 */
final class SelfCheck
{
    /**
     * @param iterable<Check> $checks
     */
    public function __construct(
        private readonly iterable $checks,
        private readonly LoggerInterface $logger,
    ) {}

    /**
     * @return array{passed: bool, tests: list<array{name: string, status: 'ok'|'fail', message: string}>}
     */
    public function run(): array
    {
        $passed = true;
        $tests = [];
        foreach ($this->checks as $check) {
            try {
                $outcome = $check->run();
            } catch (\Throwable $e) {
                $outcome = CheckOutcome::fail($e instanceof ApplicationException ? $e->getMessage() : 'The check failed unexpectedly; see the log.');
                if (!$e instanceof ApplicationException) {
                    $this->logger->error('Self-check failed unexpectedly.', ['check' => $check->name(), 'exception' => $e::class]);
                }
            }
            $passed = $passed && $outcome->ok;
            $tests[] = ['name' => $check->name(), 'status' => $outcome->ok ? 'ok' : 'fail', 'message' => $outcome->message];
        }

        return ['passed' => $passed, 'tests' => $tests];
    }
}
