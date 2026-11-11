<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\SelfCheck;

use CtPassStore\Application\SelfCheck\Check;
use CtPassStore\Application\SelfCheck\CheckOutcome;

/**
 * `logs/` exists and PHP can write to it (spec 6.4).
 */
final class LogFolderCheck implements Check
{
    public function __construct(private readonly string $directory) {}

    public function name(): string
    {
        return 'Log folder';
    }

    public function run(): CheckOutcome
    {
        clearstatcache(true, $this->directory);
        if (!is_dir($this->directory)) {
            return CheckOutcome::fail('logs/ does not exist. Create it next to config/ and make it writable for PHP.');
        }
        if (!is_writable($this->directory)) {
            return CheckOutcome::fail('logs/ is not writable by PHP.');
        }

        return CheckOutcome::ok('logs/ exists and is writable.');
    }
}
