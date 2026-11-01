<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Api;

use CtPassStore\Infrastructure\Kv\KvSchema;
use Psr\Http\Message\ResponseInterface;

/**
 * Two requests for the same entry, interleaved deterministically: the fake runs the second request completely between
 * the first one's read and its write (spec 5.3.6, catalog TR-02, TR-02a–c). Each request builds its own app, like two
 * PHP processes. The parallel run against the test instance is in `EndToEnd/LiveEntriesTest`.
 */
final class ConcurrencyApiTest extends ApiTestCase
{
    /**
     * TR-02: both PUTs see no entry and create one each. The duplicate blocks nobody: the next read gives the newer
     * password, and the next write removes the older entry.
     */
    public function testConcurrentFirstWritesCreateADuplicateThatHeals(): void
    {
        $second = $this->interleave('createValue', 'PUT', ['secondaryPwd' => 'Second-pass12!']);

        $first = $this->request('PUT', '/entries/' . self::USER, self::USER, ['secondaryPwd' => 'First-pass12!']);

        self::assertSame(204, $first->getStatusCode());
        self::assertSame(204, $second()->getStatusCode());
        self::assertCount(2, $this->entriesOf(self::USER), 'Without locking, both writes create an entry.');

        $read = $this->request('GET', '/entries/' . self::USER, self::USER);
        self::assertSame(200, $read->getStatusCode());
        self::assertSame('First-pass12!', $this->decrypt((string) $this->json($read)['secondaryPwd']), 'The newest entry wins.');

        $heal = $this->request('PUT', '/entries/' . self::USER, self::USER, ['secondaryPwd' => 'Third-pass12!']);
        self::assertSame(204, $heal->getStatusCode());
        $entries = $this->entriesOf(self::USER);
        self::assertCount(1, $entries, 'The next write removes the duplicate.');
        self::assertSame('Third-pass12!', $this->decrypt((string) $entries[0][KvSchema::ENTRY_CIPHERTEXT]));
    }

    /**
     * TR-02a: with an existing entry, both PUTs update the same value. No duplicate; the last write wins.
     */
    public function testConcurrentUpdatesLeaveOneEntry(): void
    {
        $this->seedEntry(self::USER);
        $second = $this->interleave('updateValue', 'PUT', ['secondaryPwd' => 'Second-pass12!']);

        $first = $this->request('PUT', '/entries/' . self::USER, self::USER, ['secondaryPwd' => 'First-pass12!']);

        self::assertSame(204, $first->getStatusCode());
        self::assertSame(204, $second()->getStatusCode());
        $entries = $this->entriesOf(self::USER);
        self::assertCount(1, $entries);
        self::assertSame('First-pass12!', $this->decrypt((string) $entries[0][KvSchema::ENTRY_CIPHERTEXT]));
    }

    /**
     * TR-02b: a DELETE removes the entry between the PUT's read and its update. The PUT still succeeds and stores its
     * password in a new entry, instead of failing with `500 misconfigured` because the value is gone.
     */
    public function testWriteWhileTheEntryIsDeletedCreatesItAgain(): void
    {
        $this->seedEntry(self::USER);
        $delete = $this->interleave('updateValue', 'DELETE', []);

        $put = $this->request('PUT', '/entries/' . self::USER, self::USER, ['secondaryPwd' => 'First-pass12!']);

        self::assertSame(204, $delete()->getStatusCode());
        self::assertSame(204, $put->getStatusCode());
        $entries = $this->entriesOf(self::USER);
        self::assertCount(1, $entries);
        self::assertSame('First-pass12!', $this->decrypt((string) $entries[0][KvSchema::ENTRY_CIPHERTEXT]));
    }

    /**
     * TR-02c: two DELETEs at once. The second one finds the value already gone; that's the goal of a delete, so both
     * answer `204`.
     */
    public function testConcurrentDeletesBothSucceed(): void
    {
        $this->seedEntry(self::USER);
        $second = $this->interleave('deleteValue', 'DELETE', []);

        $first = $this->request('DELETE', '/entries/' . self::USER, self::USER, []);

        self::assertSame(204, $second()->getStatusCode());
        self::assertSame(204, $first->getStatusCode());
        self::assertSame([], $this->entriesOf(self::USER));
    }

    /**
     * Healing doesn't touch other people's entries, even while another write runs in between.
     */
    public function testRacesDontTouchOtherPeople(): void
    {
        $other = $this->seedEntry(self::OTHER, 'b3RoZXI=');
        $second = $this->interleave('createValue', 'PUT', ['secondaryPwd' => 'Second-pass12!']);

        $this->request('PUT', '/entries/' . self::USER, self::USER, ['secondaryPwd' => 'First-pass12!']);
        $second();
        $this->request('PUT', '/entries/' . self::USER, self::USER, ['secondaryPwd' => 'Third-pass12!']);

        self::assertSame(['b3RoZXI='], array_column($this->entriesOf(self::OTHER), KvSchema::ENTRY_CIPHERTEXT));
        self::assertContains($other, array_column($this->churchTools->storedValues($this->categoryIds[KvSchema::PASSWORD_CATEGORY]), 'id'));
    }

    /**
     * Runs a complete second request for USER right before the next `$method` call reaches the fake.
     *
     * @param array<string, mixed> $body
     * @return \Closure(): ResponseInterface gives the second request's response once it has run
     */
    private function interleave(string $method, string $httpMethod, array $body): \Closure
    {
        $response = null;
        $this->churchTools->beforeNext($method, function () use (&$response, $httpMethod, $body): void {
            $response = $this->request($httpMethod, '/entries/' . self::USER, self::USER, $body);
        });

        return static function () use (&$response): ResponseInterface {
            self::assertInstanceOf(ResponseInterface::class, $response, 'The second request never ran.');

            return $response;
        };
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function entriesOf(int $personId): array
    {
        return array_values(array_filter(
            $this->storedEntries(),
            static fn(array $entry): bool => $entry[KvSchema::ENTRY_PERSON_ID] === $personId,
        ));
    }
}
