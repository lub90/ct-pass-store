<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\SelfCheck;

use CtPassStore\Application\SelfCheck\Check;
use CtPassStore\Application\SelfCheck\CheckOutcome;
use CtPassStore\Config\BackendConfig;

/**
 * `CLEANUP_TOKEN` is absent (the web-cron endpoint is off), usable, or too short (cleanup design 5.1). Never prints it.
 */
final class CleanupTokenCheck implements Check
{
    public function __construct(private readonly BackendConfig $config) {}

    public function name(): string
    {
        return 'Web cron token';
    }

    public function run(): CheckOutcome
    {
        if ($this->config->cleanupToken === null) {
            return CheckOutcome::ok('The web-cron endpoint is off.');
        }
        if ($this->config->cleanupTokenIfUsable() === null) {
            return CheckOutcome::fail('CLEANUP_TOKEN must have at least ' . BackendConfig::MIN_CLEANUP_TOKEN_LENGTH . ' characters; the web-cron endpoint stays off until it\'s fixed.');
        }

        return CheckOutcome::ok('The web-cron endpoint is on.');
    }
}
