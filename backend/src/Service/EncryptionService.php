<?php

declare(strict_types=1);

namespace CtPassStore\Service;

use phpseclib3\Crypt\RSA;
use Psr\Log\LoggerInterface;

class EncryptionService extends BaseService
{
    public function __construct(private readonly ServiceSettings $settings, LoggerInterface $logger)
    {
        parent::__construct($logger);
    }

    public function encrypt(#[\SensitiveParameter] string $plaintext): string
    {
        // The key is loaded only when it's needed: loading it in the constructor cost ChurchTools calls on every
        // request, even on preflights and rejected ones.
        $publicKey = $this->settings->publicKey();

        try {
            $rsa = RSA::loadPublicKey($publicKey)
                ->withPadding(RSA::ENCRYPTION_OAEP)   // OAEP Padding
                ->withHash('sha256')                  // OAEP Hash function
                ->withMGFHash('sha256');              // MGF1 Hash function

            $ciphertext = $rsa->encrypt($plaintext);

            // Base64 for transport and storage
            return base64_encode($ciphertext);

        } catch (\Throwable $e) {
            $this->logger->error('Encryption failed: ' . $e->getMessage());
            throw new \RuntimeException('Encryption failed', 0, $e);
        }
    }
}
