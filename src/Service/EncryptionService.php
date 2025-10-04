<?php

declare(strict_types=1);

namespace CtPassStore\Service;

use Psr\Log\LoggerInterface;

class EncryptionService extends BaseService
{
    private string $publicKey;

    public function __construct(ServiceSettings $settings, LoggerInterface $logger)
    {
        parent::__construct($logger);

        $this->publicKey = $settings->publicKey();
    }

    public function encrypt(string $plaintext): string
    {
        $key = openssl_pkey_get_public($this->publicKey);
        if ($key === false) {
            $this->logger->error("Invalid public key!");
            throw new \RuntimeException('Invalid public key');
        }

        $success = openssl_public_encrypt(
            $plaintext,
            $ciphertext,
            $key,
            OPENSSL_PKCS1_OAEP_PADDING
        );

        if (!$success) {
            $this->logger->error("Encryption failed!");
            throw new \RuntimeException('Encryption failed');
        }

        return base64_encode($ciphertext);
    }
}
