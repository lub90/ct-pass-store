<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Api;

use CtPassStore\Config\AppConfig;
use CtPassStore\Http\Problem\ProblemType;
use CtPassStore\Infrastructure\ChurchTools\Exception\UnavailableException;

/**
 * Duplicates and partial failures through the API. Catalog EG-04, EP-08, ED-03, EP-12, EP-13.
 */
final class StoreApiTest extends ApiTestCase
{
    public function testReadingWithDuplicatesReturnsTheNewest(): void
    {
        $this->seedEntry(self::USER, 'b2xk');
        $this->seedEntry(self::USER, 'bmV3');

        $response = $this->request('GET', '/entries/' . self::USER, self::USER);

        self::assertSame(200, $response->getStatusCode());
        self::assertSame('bmV3', $this->json($response)[AppConfig::REQUEST_SECONDARY_PWD_FIELD]);
    }

    public function testWritingHealsDuplicates(): void
    {
        $this->seedEntry(self::USER, 'b2xk');
        $this->seedEntry(self::USER, 'b2xkMg==');
        $this->seedEntry(self::OTHER);

        $response = $this->request('PUT', '/entries/' . self::USER, self::USER, [AppConfig::REQUEST_SECONDARY_PWD_FIELD => 'Custom-pass12!']);

        self::assertSame(204, $response->getStatusCode());
        $mine = array_values(array_filter($this->storedEntries(), static fn(array $e): bool => $e[AppConfig::CT_PERSON_ID_PWD_FIELD] === self::USER));
        self::assertCount(1, $mine);
        self::assertSame('Custom-pass12!', $this->decrypt($mine[0][AppConfig::CT_ENCRYPTED_PWD_FIELD]));
        self::assertCount(2, $this->storedEntries());
    }

    public function testDeletingRemovesAllDuplicates(): void
    {
        $this->seedEntry(self::USER);
        $this->seedEntry(self::USER);
        $this->seedEntry(self::OTHER);

        $response = $this->request('DELETE', '/entries/' . self::USER, self::USER);

        self::assertSame(204, $response->getStatusCode());
        self::assertSame([self::OTHER], array_column($this->storedEntries(), AppConfig::CT_PERSON_ID_PWD_FIELD));
    }

    public function testFailedWriteReturnsNoPlaintextAndKeepsTheOldEntry(): void
    {
        $this->seedEntry(self::USER, 'b2xk');
        $this->churchTools->failNext('updateValue', new UnavailableException('PUT: unreachable.'));

        $response = $this->request('PUT', '/entries/' . self::USER, self::USER);

        $body = $this->assertProblem(ProblemType::UpstreamUnavailable, $response);
        self::assertArrayNotHasKey(AppConfig::REQUEST_SECONDARY_PWD_FIELD, $body, 'A password that was never saved must not be returned.');
        self::assertSame('b2xk', $this->storedEntries()[0][AppConfig::CT_ENCRYPTED_PWD_FIELD]);
    }

    public function testFailedCreateReturnsNoPlaintext(): void
    {
        $this->churchTools->failNext('createValue', new UnavailableException('POST: unreachable.'));

        $response = $this->request('PUT', '/entries/' . self::USER, self::USER);

        $body = $this->assertProblem(ProblemType::UpstreamUnavailable, $response);
        self::assertArrayNotHasKey(AppConfig::REQUEST_SECONDARY_PWD_FIELD, $body);
        self::assertSame([], $this->storedEntries());
    }

    public function testFailedDuplicateRemovalStillSucceeds(): void
    {
        $this->seedEntry(self::USER, 'b2xk');
        $this->seedEntry(self::USER, 'b2xkMg==');
        $this->churchTools->failNext('deleteValue', new UnavailableException('DELETE: unreachable.'));

        $put = $this->request('PUT', '/entries/' . self::USER, self::USER);

        self::assertSame(200, $put->getStatusCode());
        $generated = $this->json($put)[AppConfig::REQUEST_SECONDARY_PWD_FIELD];
        $read = $this->request('GET', '/entries/' . self::USER, self::USER);
        self::assertSame($generated, $this->decrypt((string) $this->json($read)[AppConfig::REQUEST_SECONDARY_PWD_FIELD]));
        $warnings = array_filter($this->log->getRecords(), static fn(array $r): bool => $r['level_name'] === 'WARNING');
        self::assertNotEmpty($warnings);
    }
}
