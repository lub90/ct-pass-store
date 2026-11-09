<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Crypto;

use CtPassStore\Application\Exception\ConfigurationException;
use phpseclib3\Crypt\PublicKeyLoader;
use phpseclib3\Crypt\RSA;

/**
 * The extension's public key: a PEM public key (not a certificate or a private key) of type RSA with at least
 * 4096 bits (spec 5.2).
 */
final class RsaPublicKey
{
    public const MIN_BITS = 4096;

    private function __construct(public readonly RSA\PublicKey $key) {}

    /**
     * @throws ConfigurationException naming what's wrong with the key
     */
    public static function fromPem(string $pem): self
    {
        // phpseclib would also extract the key from a certificate, so the PEM type is checked first.
        if (preg_match('/^\s*-----BEGIN (RSA )?PUBLIC KEY-----/', $pem) !== 1 || str_contains($pem, 'PRIVATE KEY') || str_contains($pem, 'CERTIFICATE')) {
            throw new ConfigurationException('The publicKey in the encryption settings must be a PEM public key (BEGIN PUBLIC KEY), not a certificate or a private key.');
        }

        try {
            $key = PublicKeyLoader::loadPublicKey($pem);
        } catch (\Throwable) {
            throw new ConfigurationException('The publicKey in the encryption settings can\'t be read.');
        }
        if (!$key instanceof RSA\PublicKey) {
            throw new ConfigurationException('The publicKey in the encryption settings must be an RSA key.');
        }
        if ($key->getLength() < self::MIN_BITS) {
            throw new ConfigurationException(sprintf('The publicKey in the encryption settings has %d bits; at least %d are required.', $key->getLength(), self::MIN_BITS));
        }

        return new self($key);
    }
}
