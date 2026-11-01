<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Api;

use CtPassStore\Http\Problem\ProblemType;
use CtPassStore\Infrastructure\ChurchTools\Exception\UnavailableException;
use CtPassStore\Infrastructure\Kv\KvSchema;

/**
 * Duplicates and partial failures through the API. Catalog EG-04, EP-08, ED-03, EP-12, EP-13.
 */
final class StoreApiTest extends ApiTestCase
{
    public function testReadingWithDuplicatesReturnsTheNewest(): void
    {
        $this->seedEntry(self::USER, 'b2xk');
        $this->seedEntry(self::USER, 'bmV3');

        $response = $this->request('GET', '/v1/entries/' . self::USER, self::USER);

        self::assertSame(200, $response->getStatusCode());
        self::assertSame('bmV3', $this->json($response)['secondaryPwd']);
    }

    public function testWritingHealsDuplicates(): void
    {
        $this->seedEntry(self::USER, 'b2xk');
        $this->seedEntry(self::USER, 'b2xkMg==');
        $this->seedEntry(self::OTHER);

        $response = $this->request('PUT', '/v1/entries/' . self::USER, self::USER, ['secondaryPwd' => 'Custom-pass12!']);

        self::assertSame(204, $response->getStatusCode());
        $mine = array_values(array_filter($this->storedEntries(), static fn(array $e): bool => $e[KvSchema::ENTRY_PERSON_ID] === self::USER));
        self::assertCount(1, $mine);
        self::assertSame('Custom-pass12!', $this->decrypt($mine[0][KvSchema::ENTRY_CIPHERTEXT]));
        self::assertCount(2, $this->storedEntries());
    }

    public function testDeletingRemovesAllDuplicates(): void
    {
        $this->seedEntry(self::USER);
        $this->seedEntry(self::USER);
        $this->seedEntry(self::OTHER);

        $response = $this->request('DELETE', '/v1/entries/' . self::USER, self::USER);

        self::assertSame(204, $response->getStatusCode());
        self::assertSame([self::OTHER], array_column($this->storedEntries(), KvSchema::ENTRY_PERSON_ID));
    }

    public function testFailedWriteReturnsNoPlaintextAndKeepsTheOldEntry(): void
    {
        $this->seedEntry(self::USER, 'b2xk');
        $this->churchTools->failNext('updateValue', new UnavailableException('PUT: unreachable.'));

        $response = $this->request('PUT', '/v1/entries/' . self::USER, self::USER);

        $body = $this->assertProblem(ProblemType::UpstreamUnavailable, $response);
        self::assertArrayNotHasKey('secondaryPwd', $body, 'A password that was never saved must not be returned.');
        self::assertSame('b2xk', $this->storedEntries()[0][KvSchema::ENTRY_CIPHERTEXT]);
    }

    public function testFailedCreateReturnsNoPlaintext(): void
    {
        $this->churchTools->failNext('createValue', new UnavailableException('POST: unreachable.'));

        $response = $this->request('PUT', '/v1/entries/' . self::USER, self::USER);

        $body = $this->assertProblem(ProblemType::UpstreamUnavailable, $response);
        self::assertArrayNotHasKey('secondaryPwd', $body);
        self::assertSame([], $this->storedEntries());
    }

    public function testFailedDuplicateRemovalStillSucceeds(): void
    {
        $this->seedEntry(self::USER, 'b2xk');
        $this->seedEntry(self::USER, 'b2xkMg==');
        $this->churchTools->failNext('deleteValue', new UnavailableException('DELETE: unreachable.'));

        $put = $this->request('PUT', '/v1/entries/' . self::USER, self::USER);

        self::assertSame(200, $put->getStatusCode());
        $generated = $this->json($put)['secondaryPwd'];
        $read = $this->request('GET', '/v1/entries/' . self::USER, self::USER);
        self::assertSame($generated, $this->decrypt((string) $this->json($read)['secondaryPwd']));
        $warnings = array_filter($this->log->getRecords(), static fn(array $r): bool => $r['level_name'] === 'WARNING');
        self::assertNotEmpty($warnings);
    }
}
