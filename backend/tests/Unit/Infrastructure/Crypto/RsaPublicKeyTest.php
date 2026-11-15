<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Infrastructure\Crypto;

use CtPassStore\Application\Exception\ConfigurationException;
use CtPassStore\Infrastructure\Crypto\RsaPublicKey;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Catalog EN-05, EN-06 (spec 5.2): each way a publicKey is rejected, with the message that tells the admin why.
 */
final class RsaPublicKeyTest extends TestCase
{
    private const KEYS = __DIR__ . '/../../../keys/';

    private static function key(string $file): string
    {
        return (string) file_get_contents(self::KEYS . $file);
    }

    public function testA4096BitRsaPublicKeyIsAccepted(): void
    {
        self::assertSame(4096, RsaPublicKey::fromPem(self::key('publicKey1.pem'))->key->getLength());
    }

    /**
     * @return iterable<string, array{string, string}>
     */
    public static function rejectedPems(): iterable
    {
        $notAPublicKey = 'must be a PEM public key (BEGIN PUBLIC KEY), not a certificate or a private key';
        yield 'certificate' => [self::key('invalid/certificate.pem'), $notAPublicKey];
        yield 'private key' => [self::key('privateKey1.pem'), $notAPublicKey];
        // A valid public key first: phpseclib reads only that, so the bundled block must be caught by the pre-check.
        yield 'public key bundled with a private key' => [self::key('publicKey1.pem') . "\n" . self::key('privateKey1.pem'), $notAPublicKey];
        yield 'public key bundled with a certificate' => [self::key('publicKey1.pem') . "\n" . self::key('invalid/certificate.pem'), $notAPublicKey];
        yield 'EC P-256' => [self::key('invalid/ec.pub.pem'), 'must be an RSA key'];
        yield 'Ed25519' => [self::key('invalid/ed25519.pub.pem'), 'must be an RSA key'];
        yield 'RSA 2048' => [self::key('invalid/rsa2048.pub.pem'), 'has 2048 bits; at least 4096 are required'];
        yield 'garbage' => ["-----BEGIN PUBLIC KEY-----\nnot base64\n-----END PUBLIC KEY-----", 'can\'t be read'];
    }

    #[DataProvider('rejectedPems')]
    public function testRejectedKeysNameTheReason(string $pem, string $reason): void
    {
        try {
            RsaPublicKey::fromPem($pem);
            self::fail('Expected a ConfigurationException.');
        } catch (ConfigurationException $e) {
            self::assertStringContainsString($reason, $e->getMessage());
        }
    }
}
