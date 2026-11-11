<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\SelfCheck;

use CtPassStore\Application\Exception\ConfigurationException;
use CtPassStore\Application\Port\SettingsRepository;
use CtPassStore\Application\SelfCheck\Check;
use CtPassStore\Application\SelfCheck\CheckOutcome;

/**
 * The extension settings can be loaded and are valid (spec 4.8).
 */
final class SettingsCheck implements Check
{
    public function __construct(private readonly SettingsRepository $settings) {}

    public function name(): string
    {
        return 'Settings';
    }

    public function run(): CheckOutcome
    {
        try {
            $this->settings->settings();
        } catch (ConfigurationException $e) {
            return CheckOutcome::fail($e->getMessage());
        }

        return CheckOutcome::ok('The settings can be loaded.');
    }
}
