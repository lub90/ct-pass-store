<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Infrastructure\Crypto;

use CtPassStore\Infrastructure\Crypto\RsaPasswordCipher;
use CtPassStore\Infrastructure\Kv\ExtensionData;
use CtPassStore\Infrastructure\Kv\KvSchema;
use CtPassStore\Infrastructure\Kv\KvSettingsRepository;
use CtPassStore\Tests\Support\FakeChurchToolsClient;
use phpseclib3\Crypt\PublicKeyLoader;
use phpseclib3\Crypt\RSA;
use PHPUnit\Framework\TestCase;

/**
 * Catalog EN-01 (spec 5.2): RSA-OAEP with SHA-256 for hash and MGF1, Base64; only the private key decrypts.
 */
final class RsaPasswordCipherTest extends TestCase
{
    private const KEYS = __DIR__ . '/../../../keys/';

    private function cipher(): RsaPasswordCipher
    {
        $fake = new FakeChurchToolsClient();
        $ids = $fake->addModule(KvSchema::EXTENSION_KEY, [KvSchema::SETTINGS_CATEGORY, KvSchema::ENCRYPTION_CATEGORY, KvSchema::PASSWORD_CATEGORY]);
        $fake->seedValue($ids[KvSchema::ENCRYPTION_CATEGORY], json_encode([KvSchema::PUBLIC_KEY => file_get_contents(self::KEYS . 'publicKey1.pem')], JSON_THROW_ON_ERROR));

        return new RsaPasswordCipher(new KvSettingsRepository(new ExtensionData($fake), new \Psr\Log\NullLogger()));
    }

    private static function decrypt(string $ciphertext, string $hash = 'sha256'): string
    {
        $key = PublicKeyLoader::loadPrivateKey((string) file_get_contents(self::KEYS . 'privateKey1.pem'));
        self::assertInstanceOf(RSA\PrivateKey::class, $key);

        return (string) $key->withPadding(RSA::ENCRYPTION_OAEP)->withHash($hash)->withMGFHash($hash)->decrypt((string) base64_decode($ciphertext, true));
    }

    public function testEncryptThenDecryptGivesThePlaintextBack(): void
    {
        foreach (['Aa1!aaaaaaaa', str_repeat('Zz9.', 32), 'ÄÖÜ-utf8-ß-1'] as $plaintext) {
            self::assertSame($plaintext, self::decrypt($this->cipher()->encrypt($plaintext)));
        }
    }

    public function testCiphertextIsBase64OfOneRsa4096Block(): void
    {
        $ciphertext = $this->cipher()->encrypt('Aa1!aaaaaaaa');

        self::assertMatchesRegularExpression('/^[A-Za-z0-9+\/]+={0,2}$/', $ciphertext);
        self::assertSame(512, strlen((string) base64_decode($ciphertext, true)));
    }

    public function testEncryptionIsRandomized(): void
    {
        self::assertNotSame($this->cipher()->encrypt('Aa1!aaaaaaaa'), $this->cipher()->encrypt('Aa1!aaaaaaaa'));
    }

    public function testOaepUsesSha256NotSha1(): void
    {
        $ciphertext = $this->cipher()->encrypt('Aa1!aaaaaaaa');

        $this->expectException(\Throwable::class);
        self::decrypt($ciphertext, 'sha1');
    }

    // ---------------------------------------------------------------- EN-09

    /**
     * @return string|false the plaintext, or false if decryption failed
     */
    private static function tryDecrypt(string $raw, ?string $privatePem = null): string|false
    {
        $key = PublicKeyLoader::loadPrivateKey($privatePem ?? (string) file_get_contents(self::KEYS . 'privateKey1.pem'));
        self::assertInstanceOf(RSA\PrivateKey::class, $key);
        try {
            return $key->withPadding(RSA::ENCRYPTION_OAEP)->withHash('sha256')->withMGFHash('sha256')->decrypt($raw);
        } catch (\Throwable) {
            return false;
        }
    }

    public function testAnotherPrivateKeyCantDecrypt(): void
    {
        $other = openssl_pkey_new(['private_key_bits' => 4096, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
        self::assertNotFalse($other);
        self::assertTrue(openssl_pkey_export($other, $pem));

        $raw = (string) base64_decode($this->cipher()->encrypt('Aa1!aaaaaaaa'), true);

        self::assertFalse(self::tryDecrypt($raw, (string) $pem));
    }

    public function testManipulatedCiphertextsNeverDecryptToAWrongPlaintext(): void
    {
        $raw = (string) base64_decode($this->cipher()->encrypt('Aa1!aaaaaaaa'), true);
        self::assertSame('Aa1!aaaaaaaa', self::tryDecrypt($raw));

        foreach ([0, 1, 100, 255, 511] as $byte) {
            foreach ([0x01, 0x80] as $bit) {
                $flipped = $raw;
                $flipped[$byte] = chr(ord($flipped[$byte]) ^ $bit);
                self::assertFalse(self::tryDecrypt($flipped), "Flipped bit $bit in byte $byte.");
            }
        }
        self::assertFalse(self::tryDecrypt(substr($raw, 0, 511)), 'Truncated.');
        self::assertFalse(self::tryDecrypt(substr($raw, 1)), 'Truncated at the front.');
        self::assertFalse(self::tryDecrypt($raw . "\x00"), 'Extended.');
        self::assertFalse(self::tryDecrypt("\x00" . $raw), 'Extended at the front.');
    }

    // ---------------------------------------------------------------- EN-07

    public function testAFailedEncryptionDoesntRevealThePlaintext(): void
    {
        // Longer than RSA-4096 with OAEP-SHA256 can encrypt (446 bytes); passwords never get there (max. 128).
        $plaintext = 'SECRET-' . str_repeat('p', 600);
        // Hosts with a development php.ini record arguments in traces; check that case too.
        $previous = ini_set('zend.exception_ignore_args', '0');

        try {
            $this->cipher()->encrypt($plaintext);
            self::fail('Expected the encryption to fail.');
        } catch (\Throwable $e) {
            for ($current = $e; $current !== null; $current = $current->getPrevious()) {
                self::assertStringNotContainsString('SECRET-', $current->getMessage());
                foreach ($current->getTrace() as $frame) {
                    foreach ($frame['args'] ?? [] as $arg) {
                        self::assertNotSame($plaintext, $arg, 'The plaintext is in the trace arguments.');
                    }
                }
            }
        } finally {
            ini_set('zend.exception_ignore_args', (string) $previous);
        }
    }
}
