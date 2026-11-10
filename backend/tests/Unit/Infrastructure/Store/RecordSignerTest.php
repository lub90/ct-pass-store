<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Infrastructure\Store;

use CtPassStore\Infrastructure\Store\OpenedStatus;
use CtPassStore\Infrastructure\Store\RecordSigner;
use CtPassStore\Infrastructure\Store\SignedFileStore;
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
     * Golden values from the SignedFileStore as of commit 979e110 (before the signer existed): files written then
     * must keep verifying, so the label, the MAC input and the key ID length can't change (spec 6.1).
     */
    public function testFormatIsUnchanged(): void
    {
        $secret = 'golden-secret-with-at-least-32-bytes-xx';
        $data = ['j:abc' => 1700000000, 'j:def' => 1700000060];
        $oldFile = '{"format":1,"keyId":"4be228b36d254ef7","data":"{\"j:abc\":1700000000,\"j:def\":1700000060}",'
            . '"mac":"dea8483de770b2941a42c813aa7431936caa3c19be5e0f25269c443a488cc790"}';
        $signer = new RecordSigner($secret, SignedFileStore::PURPOSE);

        self::assertSame($oldFile, $signer->seal('jti:ct-radius', $data));
        $opened = $signer->open('jti:ct-radius', $oldFile);
        self::assertSame(OpenedStatus::Valid, $opened->status);
        self::assertSame($data, $opened->data);
    }
}
