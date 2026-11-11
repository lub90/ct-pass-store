<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\SelfCheck;

use CtPassStore\Application\Exception\ConfigurationException;
use CtPassStore\Application\SelfCheck\Check;
use CtPassStore\Application\SelfCheck\CheckOutcome;
use CtPassStore\Infrastructure\Kv\KvSettingsRepository;

/**
 * The RSA public key for passwords can be loaded (spec 4.8).
 */
final class PublicKeyCheck implements Check
{
    public function __construct(private readonly KvSettingsRepository $settings) {}

    public function name(): string
    {
        return 'Public key';
    }

    public function run(): CheckOutcome
    {
        try {
            $this->settings->publicKey();
        } catch (ConfigurationException $e) {
            return CheckOutcome::fail($e->getMessage());
        }

        return CheckOutcome::ok('The public key can be loaded.');
    }
}
