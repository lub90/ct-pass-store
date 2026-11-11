<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\SelfCheck;

use CtPassStore\Application\Exception\ConfigurationException;
use CtPassStore\Application\SelfCheck\Check;
use CtPassStore\Application\SelfCheck\CheckOutcome;
use CtPassStore\Infrastructure\Kv\KvSettingsRepository;

/**
 * The extension settings can be loaded and are valid, and every finding (a disabled machine client, an unknown
 * permission, an empty key list) is reported by client id (spec 4.8, 3.2). It reads the settings afresh, so a fix
 * shows at once instead of after the cache expires.
 */
final class SettingsCheck implements Check
{
    public function __construct(private readonly KvSettingsRepository $settings) {}

    public function name(): string
    {
        return 'Settings';
    }

    public function run(): CheckOutcome
    {
        $this->settings->refresh();
        try {
            $findings = $this->settings->findings();
        } catch (ConfigurationException $e) {
            return CheckOutcome::fail($e->getMessage());
        }
        if ($findings !== []) {
            return CheckOutcome::fail(implode(' ', $findings));
        }

        return CheckOutcome::ok('The settings can be loaded and are valid.');
    }
}
