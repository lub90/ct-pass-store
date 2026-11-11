<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\SelfCheck;

use CtPassStore\Application\Exception\ConfigurationException;
use CtPassStore\Application\SelfCheck\Check;
use CtPassStore\Application\SelfCheck\CheckOutcome;
use CtPassStore\Infrastructure\Crypto\RsaPasswordCipher;
use CtPassStore\Infrastructure\Kv\KvSettingsRepository;

/**
 * The RSA public key for passwords can be loaded and encrypts a test string (spec 4.8). The key is read afresh. The
 * ciphertext is dropped, never shown.
 */
final class PublicKeyCheck implements Check
{
    public function __construct(
        private readonly KvSettingsRepository $settings,
        private readonly RsaPasswordCipher $cipher,
    ) {}

    public function name(): string
    {
        return 'Public key';
    }

    public function run(): CheckOutcome
    {
        $this->settings->refreshPublicKey();
        try {
            $this->cipher->encrypt('self-check');
        } catch (ConfigurationException $e) {
            return CheckOutcome::fail($e->getMessage());
        } catch (\RuntimeException $e) {
            // Only the cipher's own text, which names no key material.
            return CheckOutcome::fail($e->getMessage());
        }

        return CheckOutcome::ok('The public key can be loaded and encrypts a test string.');
    }
}
