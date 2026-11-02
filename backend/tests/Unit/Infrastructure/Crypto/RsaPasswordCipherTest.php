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

        return new RsaPasswordCipher(new KvSettingsRepository(new ExtensionData($fake)));
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
}
