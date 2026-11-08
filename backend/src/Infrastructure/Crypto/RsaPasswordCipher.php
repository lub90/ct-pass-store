<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Crypto;

use CtPassStore\Application\Port\PasswordCipher;
use CtPassStore\Infrastructure\Kv\KvSettingsRepository;
use phpseclib3\Crypt\RSA;

/**
 * RSA-OAEP with SHA-256 for hash and MGF1, Base64-encoded (spec 5.2). Only the extension's private key can decrypt.
 */
final class RsaPasswordCipher implements PasswordCipher
{
    public function __construct(private readonly KvSettingsRepository $keys) {}

    public function encrypt(#[\SensitiveParameter] string $password): string
    {
        // The key is loaded only when it's needed: loading it in the constructor cost ChurchTools calls on every
        // request, even on preflights and rejected ones.
        $key = $this->keys->publicKey()->key
            ->withPadding(RSA::ENCRYPTION_OAEP)
            ->withHash('sha256')
            ->withMGFHash('sha256');

        try {
            return base64_encode($key->encrypt($password));
        } catch (\Throwable $e) {
            // phpseclib's frames carry the plaintext as an argument when the host records arguments in traces. The
            // original exception is therefore not attached; only its class says what went wrong (spec 5.2, EN-07).
            throw new \RuntimeException('Encrypting the password failed (' . $e::class . ').');
        }
    }
}
