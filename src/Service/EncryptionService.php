<?php

declare(strict_types=1);

namespace CtPassStore\Service;

class EncryptionService
{
    private string $publicKey;

    public function __construct(ServiceSettings $settings)
    {
        $this->publicKey = $settings->publicKey();
    }

    public function encrypt(string $plaintext): string
    {
        $key = openssl_pkey_get_public($this->publicKey);
        if ($key === false) {
            throw new \RuntimeException('Invalid public key');
        }

        $success = openssl_public_encrypt(
            $plaintext,
            $ciphertext,
            $key,
            OPENSSL_PKCS1_OAEP_PADDING
        );

        if (!$success) {
            throw new \RuntimeException('Encryption failed');
        }

        return base64_encode($ciphertext);
    }
}
