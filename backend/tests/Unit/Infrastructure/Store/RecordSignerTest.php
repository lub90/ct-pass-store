<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Infrastructure\Store;

use CtPassStore\Infrastructure\Store\OpenedStatus;
use CtPassStore\Infrastructure\Store\RecordSigner;
use CtPassStore\Infrastructure\Store\SignedFileStore;
use Monolog\Logger;
use PHPUnit\Framework\TestCase;

/**
 * The signing scheme of the security store and the cache (spec 6.1, catalog CA-09).
 */
final class RecordSignerTest extends TestCase
{
    private const SECRET = 'signer-test-secret-with-at-least-32-bytes';
    private const PURPOSE = 'signer test purpose';

    private function signer(string $secret = self::SECRET): RecordSigner
    {
        return new RecordSigner($secret, self::PURPOSE);
    }

    public function testSealedRecordOpensAsValid(): void
    {
        $opened = $this->signer()->open('a', $this->signer()->seal('a', ['x' => 1]));

        self::assertSame(OpenedStatus::Valid, $opened->status);
        self::assertSame(['x' => 1], $opened->data);
    }

    public function testEmptyContentOpensAsValidAndEmpty(): void
    {
        $opened = $this->signer()->open('a', '');

        self::assertSame(OpenedStatus::Valid, $opened->status);
        self::assertSame([], $opened->data);
    }

    public function testOtherKeyOpensAsOldKey(): void
    {
        $raw = $this->signer()->seal('a', ['x' => 1]);
        $opened = $this->signer('another-secret-with-at-least-32-bytes-xx')->open('a', $raw);

        self::assertSame(OpenedStatus::OldKey, $opened->status);
        self::assertSame([], $opened->data);
    }

    public function testChangedDataOpensAsTampered(): void
    {
        $file = json_decode($this->signer()->seal('a', ['x' => 1]), true);
        self::assertIsArray($file);
        $file['data'] = '{"x":2}';
        $opened = $this->signer()->open('a', json_encode($file, JSON_THROW_ON_ERROR));

        self::assertSame(OpenedStatus::Tampered, $opened->status);
        self::assertSame([], $opened->data);
    }

    public function testMissingMacOpensAsTampered(): void
    {
        $file = json_decode($this->signer()->seal('a', ['x' => 1]), true);
        self::assertIsArray($file);
        unset($file['mac']);

        self::assertSame(OpenedStatus::Tampered, $this->signer()->open('a', json_encode($file, JSON_THROW_ON_ERROR))->status);
    }

    /**
     * CA-09: no `unserialize`, a serialized PHP object is just a broken file.
     */
    public function testSerializedPhpObjectOpensAsTampered(): void
    {
        self::assertSame(OpenedStatus::Tampered, $this->signer()->open('a', 'O:8:"stdClass":0:{}')->status);
    }

    public function testRecordNameIsPartOfTheMac(): void
    {
        $raw = $this->signer()->seal('a', ['x' => 1]);

        self::assertSame(OpenedStatus::Tampered, $this->signer()->open('b', $raw)->status);
    }

    /**
     * Files written before the signer existed must keep verifying (spec 6.1).
     */
    public function testFormatIsUnchanged(): void
    {
        $dir = sys_get_temp_dir() . '/ctps-signer-' . bin2hex(random_bytes(6));
        try {
            $store = new SignedFileStore($dir, self::SECRET, new Logger('test'));
            $store->update('jti:ct-radius', static fn(array $old): array => ['j:abc' => 1700000000]);
            $written = json_decode((string) file_get_contents($dir . '/sec-' . hash('sha256', 'jti:ct-radius') . '.json'), true);

            $signer = new RecordSigner(self::SECRET, 'ctpassstore security store v1');
            $sealed = json_decode($signer->seal('jti:ct-radius', ['j:abc' => 1700000000]), true);

            self::assertIsArray($written);
            self::assertIsArray($sealed);
            self::assertSame($written['keyId'], $sealed['keyId']);
            self::assertSame($written['data'], $sealed['data']);
            self::assertSame($written['mac'], $sealed['mac']);
            self::assertSame($written['format'], $sealed['format']);
        } finally {
            foreach (glob($dir . '/*') ?: [] as $file) {
                @unlink($file);
            }
            @rmdir($dir);
        }
    }
}
