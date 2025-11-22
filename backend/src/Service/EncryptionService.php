<?php

declare(strict_types=1);

namespace CtPassStore\Service;

use Psr\Log\LoggerInterface;
use phpseclib3\Crypt\RSA;

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
        try {
            // Load public key
            $rsa = RSA::loadPublicKey($this->publicKey)
                ->withPadding(RSA::ENCRYPTION_OAEP)   // OAEP Padding
                ->withHash('sha256')                  // OAEP Hash function
                ->withMGFHash('sha256');              // MGF1 Hash function

            // Verschlüsseln
            $ciphertext = $rsa->encrypt($plaintext);

            // Base64 für Transport/Storage
            return base64_encode($ciphertext);

        } catch (\Throwable $e) {
            $this->logger->error("Encryption failed: " . $e->getMessage());
            throw new \RuntimeException('Encryption failed', 0, $e);
        }
    }
}
