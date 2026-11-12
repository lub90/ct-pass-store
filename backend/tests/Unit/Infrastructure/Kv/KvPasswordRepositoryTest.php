<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Infrastructure\Kv;

use CtPassStore\Domain\PersonId;
use CtPassStore\Infrastructure\ChurchTools\Exception\UnavailableException;
use CtPassStore\Infrastructure\Kv\ExtensionData;
use CtPassStore\Infrastructure\Kv\KvPasswordRepository;
use CtPassStore\Infrastructure\Kv\KvSchema;
use CtPassStore\Tests\Support\FakeChurchToolsClient;
use Monolog\Handler\TestHandler;
use Monolog\Logger;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Catalog section 3: ST-01 to ST-11, ST-14, ST-15, ST-17, ST-20 to ST-24.
 */
final class KvPasswordRepositoryTest extends TestCase
{
    private FakeChurchToolsClient $fake;

    private TestHandler $log;

    private KvPasswordRepository $store;

    private int $category;

    protected function setUp(): void
    {
        $this->fake = new FakeChurchToolsClient();
        $ids = $this->fake->addModule(KvSchema::EXTENSION_KEY, [KvSchema::PASSWORD_CATEGORY]);
        $this->category = $ids[KvSchema::PASSWORD_CATEGORY];
        $this->log = new TestHandler();
        $logger = new Logger('test');
        $logger->pushHandler($this->log);
        $this->store = new KvPasswordRepository(new ExtensionData($this->fake), $logger);
    }

    private function seed(mixed $personId, mixed $ciphertext = 'c2VjcmV0'): int
    {
        return $this->fake->seedValue($this->category, json_encode([
            KvSchema::ENTRY_PERSON_ID => $personId,
            KvSchema::ENTRY_CIPHERTEXT => $ciphertext,
        ], JSON_THROW_ON_ERROR));
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function stored(): array
    {
        return array_map(
            static fn(array $v): array => ['id' => $v['id']] + (array) json_decode((string) $v['value'], true),
            $this->fake->storedValues($this->category),
        );
    }

    private function warnings(): int
    {
        return count(array_filter($this->log->getRecords(), static fn(array $r): bool => $r['level_name'] === 'WARNING'));
    }

    // ---------------------------------------------------------------- read (ST-01, ST-02, ST-05, ST-08a, ST-20)

    public function testReadsTheEntryOfThePerson(): void
    {
        $this->seed(6, 'b3RoZXI=');
        $this->seed(5, 'bWluZQ==');

        self::assertSame('bWluZQ==', $this->store->find(new PersonId(5)));
    }

    public function testReturnsNullWithoutEntry(): void
    {
        self::assertNull($this->store->find(new PersonId(5)));
    }

    public function testNeverReturnsAnEntryOfASimilarPersonId(): void
    {
        foreach ([50, 15, 55, 6, 51] as $other) {
            $this->seed($other);
        }

        self::assertNull($this->store->find(new PersonId(5)));
    }

    public function testWithDuplicatesTheNewestEntryWinsAndAWarningIsLogged(): void
    {
        $this->seed(5, 'b2xk');
        $this->seed(5, 'bmV3');

        self::assertSame('bmV3', $this->store->find(new PersonId(5)));
        self::assertSame(1, $this->warnings());
    }

    public function testNewestIsDecidedByNumericValueId(): void
    {
        // As strings "10" < "9"; as numbers 10 > 9. Burn IDs until the next value gets ID 9.
        do {
            $id = $this->fake->seedValue($this->category, '{}');
        } while ($id < 8);
        $this->fake->clearValues($this->category);
        $nine = $this->seed(5, 'bmluZQ==');
        $ten = $this->seed(5, 'dGVu');
        self::assertSame([9, 10], [$nine, $ten]);

        $withIntegers = $this->store->find(new PersonId(5));

        // ST-20: the same when ChurchTools sends the IDs as strings, where "10" < "9".
        $this->fake->returnValueIdsAsStrings();
        $withStrings = $this->store->find(new PersonId(5));

        self::assertSame(['dGVu', 'dGVu'], [$withIntegers, $withStrings]);
        $this->store->save(new PersonId(5), 'bmV3');
        self::assertSame([$ten], array_column($this->fake->storedValues($this->category), 'id'), 'The newest one was updated, the other healed.');
    }

    // ---------------------------------------------------------------- ST-07, ST-08 person ID normalization

    /**
     * @return iterable<string, array{mixed, int|null}>
     */
    public static function personIds(): iterable
    {
        yield 'integer' => [5, 5];
        yield 'numeric string' => ['5', 5];
        yield 'zero' => [0, 0];
        yield 'leading zero' => ['05', null];
        yield 'with letters' => ['5a', null];
        yield 'float' => [5.5, null];
        yield 'float with zero fraction' => [5.0, null];
        yield 'trailing space' => ['5 ', null];
        yield 'leading space' => [' 5', null];
        yield 'plus sign' => ['+5', null];
        yield 'negative' => [-5, null];
        yield 'negative string' => ['-5', null];
        yield 'boolean' => [true, null];
        yield 'null' => [null, null];
        yield 'array' => [[5], null];
        yield 'exponent' => ['5e0', null];
        yield 'hex' => ['0x5', null];
        yield 'trailing newline' => ["5\n", null];
        yield 'trailing CR LF' => ["5\r\n", null];
        yield 'too long' => ['1234567890123456789012', null];
    }

    #[DataProvider('personIds')]
    public function testPersonIdNormalization(mixed $raw, ?int $expected): void
    {
        self::assertSame($expected, KvPasswordRepository::normalizePersonId($raw));
    }

    public function testStringPersonIdsAreTheSamePersonForReadWriteAndDelete(): void
    {
        $this->seed('5', 'c3RyaW5n');

        self::assertSame('c3RyaW5n', $this->store->find(new PersonId(5)));

        $this->store->save(new PersonId(5), 'dXBkYXRlZA==');
        self::assertCount(1, $this->stored());
        self::assertSame(5, $this->stored()[0][KvSchema::ENTRY_PERSON_ID], 'The rewritten entry stores the ID as an integer.');

        $this->store->delete(new PersonId(5));
        self::assertSame([], $this->stored());
    }

    public function testLooselyEqualPersonIdsAreNotTheSamePerson(): void
    {
        foreach (['05', '5a', ' 5', '5 '] as $loose) {
            $this->seed($loose);
        }
        $this->fake->seedValue($this->category, '{"personId": 5.5, "secondaryPwd": "eA=="}');
        $this->fake->seedValue($this->category, '{"personId": true, "secondaryPwd": "eA=="}');

        self::assertNull($this->store->find(new PersonId(5)));
        $this->store->delete(new PersonId(5));
        self::assertCount(6, $this->stored(), 'None of them may be deleted for person 5.');
    }

    // ---------------------------------------------------------------- write (ST-03, ST-04, ST-06, ST-14, ST-15, ST-17)

    public function testWriteWithoutEntryCreatesExactlyOneWithAnIntegerPersonId(): void
    {
        $this->store->save(new PersonId(5), 'bmV3');

        self::assertSame(1, $this->fake->countCalls(['createValue']));
        self::assertSame(0, $this->fake->countCalls(['updateValue', 'deleteValue']));
        $stored = $this->stored();
        self::assertCount(1, $stored);
        self::assertSame(5, $stored[0][KvSchema::ENTRY_PERSON_ID]);
        self::assertSame('bmV3', $stored[0][KvSchema::ENTRY_CIPHERTEXT]);
    }

    public function testWriteWithOneEntryUpdatesIt(): void
    {
        $id = $this->seed(5, 'b2xk');

        $this->store->save(new PersonId(5), 'bmV3');

        self::assertSame(0, $this->fake->countCalls(['createValue', 'deleteValue']));
        self::assertSame([['id' => $id, KvSchema::ENTRY_PERSON_ID => 5, KvSchema::ENTRY_CIPHERTEXT => 'bmV3']], $this->stored());
    }

    public function testWriteWithDuplicatesUpdatesTheNewestAndDeletesTheRest(): void
    {
        $this->seed(5, 'MQ==');
        $this->seed(5, 'Mg==');
        $newest = $this->seed(5, 'Mw==');

        $this->store->save(new PersonId(5), 'bmV3');

        self::assertSame([['id' => $newest, KvSchema::ENTRY_PERSON_ID => 5, KvSchema::ENTRY_CIPHERTEXT => 'bmV3']], $this->stored());
        self::assertSame('bmV3', $this->store->find(new PersonId(5)));
    }

    public function testWritingAndDeletingNeverTouchOtherPersons(): void
    {
        $others = [
            $this->seed(6, 'c2l4'),
            $this->seed(6, 'c2l4LTI='),
            $this->fake->seedValue($this->category, '{broken'),
            $this->seed(7, null),
        ];

        $this->store->save(new PersonId(5), 'Zml2ZQ==');
        $this->store->save(new PersonId(5), 'Zml2ZS0y');
        $this->store->delete(new PersonId(5));

        foreach ($this->fake->calls() as $call) {
            if (in_array($call['method'], ['updateValue', 'deleteValue'], true)) {
                self::assertNotContains($call['args'][2], $others, 'Another person\'s value was changed.');
            }
        }
        self::assertSame($others, array_column($this->stored(), 'id'));
    }

    public function testFailedUpdateLeavesTheOldEntryAndCreatesNoDuplicate(): void
    {
        $this->seed(5, 'b2xk');
        $this->fake->failNext('updateValue', new UnavailableException('PUT: unreachable.'));

        try {
            $this->store->save(new PersonId(5), 'bmV3');
            self::fail('Expected the write to fail.');
        } catch (UnavailableException) {
        }

        self::assertSame(0, $this->fake->countCalls(['createValue']));
        self::assertSame('b2xk', $this->store->find(new PersonId(5)));
    }

    public function testFailedCreateIsReported(): void
    {
        $this->fake->failNext('createValue', new UnavailableException('POST: unreachable.'));

        $this->expectException(UnavailableException::class);
        $this->store->save(new PersonId(5), 'bmV3');
    }

    public function testFailedDuplicateRemovalStillStoresTheNewPassword(): void
    {
        $this->seed(5, 'b2xk');
        $this->seed(5, 'b2xkMg==');
        $this->fake->failNext('deleteValue', new UnavailableException('DELETE: unreachable.'));

        $this->store->save(new PersonId(5), 'bmV3');

        self::assertSame('bmV3', $this->store->find(new PersonId(5)), 'The updated newest entry wins.');
        self::assertCount(2, $this->stored(), 'The duplicate stays until the next write.');
        self::assertGreaterThanOrEqual(1, $this->warnings());

        $this->store->save(new PersonId(5), 'bmV3ZXI=');
        self::assertCount(1, $this->stored(), 'The next write heals it.');
    }

    public function testPersonIdsAreUniqueSortedAndSkipZero(): void
    {
        $this->seed(9);
        $this->seed('5');
        $this->seed(5);
        $this->seed(0);
        $this->fake->seedValue($this->category, 'not json');

        self::assertSame([5, 9], array_map(static fn(PersonId $p): int => $p->value, $this->store->personIds()));
    }

    public function testValuesOverTheKvLimitAreRefusedBeforeWriting(): void
    {
        try {
            $this->store->save(new PersonId(5), str_repeat('A', KvPasswordRepository::MAX_VALUE_LENGTH));
            self::fail('Expected an exception.');
        } catch (\LogicException) {
            self::assertSame(0, $this->fake->writeCount());
        }
    }

    public function testRegularCiphertextsFitTheKvLimit(): void
    {
        $this->store->save(new PersonId(5), base64_encode(random_bytes(1024)));

        self::assertCount(1, $this->stored());
    }

    // ---------------------------------------------------------------- broken values (ST-09, ST-21)

    /**
     * @return iterable<string, array{string}>
     */
    public static function brokenValues(): iterable
    {
        yield 'not JSON' => ['{broken'];
        yield 'JSON string' => ['"x"'];
        yield 'no person ID' => ['{"secondaryPwd": "eA=="}'];
        yield 'invalid person ID' => ['{"personId": "abc", "secondaryPwd": "eA=="}'];
    }

    #[DataProvider('brokenValues')]
    public function testBrokenValuesAreSkippedWithAWarning(string $broken): void
    {
        $this->fake->seedValue($this->category, $broken);
        $this->seed(5, 'Zml2ZQ==');

        self::assertSame('Zml2ZQ==', $this->store->find(new PersonId(5)));
        self::assertSame(1, $this->warnings());

        $this->store->save(new PersonId(6), 'c2l4');
        self::assertSame('c2l4', $this->store->find(new PersonId(6)));
    }

    /**
     * @return iterable<string, array{mixed}>
     */
    public static function unusablePasswords(): iterable
    {
        yield 'missing' => [null];
        yield 'empty' => [''];
        yield 'number' => [123];
        yield 'list' => [['x']];
    }

    #[DataProvider('unusablePasswords')]
    public function testCorruptOwnEntryIsIgnoredOnReadAndOverwrittenOnWrite(mixed $password): void
    {
        $corrupt = $this->seed(5, $password);

        self::assertNull($this->store->find(new PersonId(5)));

        $this->store->save(new PersonId(5), 'Zml4ZWQ=');
        self::assertSame([['id' => $corrupt, KvSchema::ENTRY_PERSON_ID => 5, KvSchema::ENTRY_CIPHERTEXT => 'Zml4ZWQ=']], $this->stored(), 'Overwritten, no duplicate next to it.');
    }

    public function testCorruptOwnEntryIsDeleted(): void
    {
        $this->seed(5, null);

        $this->store->delete(new PersonId(5));

        self::assertSame([], $this->stored());
    }

    // ---------------------------------------------------------------- delete (ST-10, ST-11)

    public function testDeleteRemovesAllEntriesOfThePersonOnly(): void
    {
        $this->seed(5);
        $this->seed(5);
        $this->seed(6);

        $this->store->delete(new PersonId(5));

        self::assertCount(1, $this->stored());
        self::assertSame(6, $this->stored()[0][KvSchema::ENTRY_PERSON_ID]);
    }

    public function testDeleteWithoutEntryDoesNothing(): void
    {
        $this->store->delete(new PersonId(5));

        self::assertSame(0, $this->fake->writeCount());
    }

    // ---------------------------------------------------------------- delete several persons (ST-24)

    /**
     * @param list<int> $ids
     * @return list<PersonId>
     */
    private static function persons(array $ids): array
    {
        return array_map(static fn(int $id): PersonId => new PersonId($id), $ids);
    }

    /**
     * @param list<PersonId> $persons
     * @return list<int>
     */
    private static function ids(array $persons): array
    {
        return array_map(static fn(PersonId $p): int => $p->value, $persons);
    }

    public function testDeleteEntriesOfListsTheCategoryOnceForAllPersons(): void
    {
        $this->seed(5);
        $this->seed('5');
        $this->seed(5, '');
        $this->seed(6);
        $this->seed(7);
        $this->seed(8);
        $this->seed(0, 'dGVzdA==');

        $result = $this->store->deleteEntriesOf(self::persons([5, 7, 8, 9]), static fn(): bool => true);

        self::assertSame(1, $this->fake->countCalls(['getValues']));
        self::assertSame([5, 7, 8, 9], self::ids($result->deleted));
        self::assertSame([], $result->failed);
        self::assertSame([], $result->notStarted);
        self::assertSame([6, 0], array_map(static fn(array $e): mixed => $e[KvSchema::ENTRY_PERSON_ID], $this->stored()));
        self::assertSame(5, $this->fake->countCalls(['deleteValue']));
    }

    public function testDeleteEntriesOfReportsAFailedPersonAndContinues(): void
    {
        $this->seed(5);
        $this->seed(6);
        $this->seed(7);
        $this->fake->beforeNext('deleteValue', static function (): void {});
        $this->fake->beforeNext('deleteValue', fn() => $this->fake->failNext('deleteValue', new UnavailableException('DELETE: unreachable.')));

        $result = $this->store->deleteEntriesOf(self::persons([5, 6, 7]), static fn(): bool => true);

        self::assertSame([5, 7], self::ids($result->deleted));
        self::assertSame([6 => 'DELETE: unreachable.'], $result->failed);
        self::assertSame([6], array_map(static fn(array $e): mixed => $e[KvSchema::ENTRY_PERSON_ID], $this->stored()));
    }

    public function testDeleteEntriesOfCountsAnEntryDeletedMeanwhileAsDeleted(): void
    {
        $id = $this->seed(5);
        $this->fake->beforeNext('deleteValue', fn() => $this->fake->clearValues($this->category));

        $result = $this->store->deleteEntriesOf(self::persons([5]), static fn(): bool => true);

        self::assertSame([5], self::ids($result->deleted));
        self::assertSame([], $result->failed);
        self::assertTrue($this->log->hasInfoThatContains("Password entry $id of person 5 was already deleted."));
    }

    public function testDeleteEntriesOfStartsNoPersonOnceMayStartSaysNo(): void
    {
        $this->seed(5);
        $this->seed(5);
        $this->seed(6);
        $this->seed(7);
        $asked = 0;
        // Yes for person 5, no from then on: both entries of 5 go, 6 and 7 stay untouched.
        $mayStart = static function () use (&$asked): bool {
            return ++$asked === 1;
        };

        $result = $this->store->deleteEntriesOf(self::persons([5, 6, 7]), $mayStart);

        self::assertSame([5], self::ids($result->deleted));
        self::assertSame([6, 7], self::ids($result->notStarted));
        self::assertSame([], $result->failed);
        self::assertSame([6, 7], array_map(static fn(array $e): mixed => $e[KvSchema::ENTRY_PERSON_ID], $this->stored()));
        self::assertSame(2, $asked);
    }

    public function testDeleteEntriesOfWithoutPersonsMakesNoCall(): void
    {
        $result = $this->store->deleteEntriesOf([], static fn(): bool => true);

        self::assertSame([], $this->fake->calls());
        self::assertSame([], $result->deleted);
    }

    public function testDeleteEntriesOfPropagatesAFailedListingAndDeletesNothing(): void
    {
        $this->seed(5);
        $this->fake->failNextRead($this->category, new UnavailableException('GET: unreachable.'));

        try {
            $this->store->deleteEntriesOf(self::persons([5]), static fn(): bool => true);
            self::fail('Expected an exception.');
        } catch (UnavailableException) {
        }

        self::assertSame(0, $this->fake->writeCount());
    }

    // ---------------------------------------------------------------- reserved person ID 0 (ST-22)

    public function testSelfTestValuesAreInvisibleToPersonOperations(): void
    {
        $this->seed(0, 'dGVzdA==');
        $this->seed(0, 'dGVzdDI=');
        $this->seed('0', 'dGVzdDM=');

        self::assertNull($this->store->find(new PersonId(5)));
        $this->store->save(new PersonId(5), 'Zml2ZQ==');
        $this->store->delete(new PersonId(5));

        self::assertCount(3, $this->stored());
        self::assertSame(0, $this->warnings(), 'Self-test values are skipped silently.');
    }

    public function testPersonOperationsRejectTheReservedId(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        new PersonId(KvPasswordRepository::SELF_TEST_PERSON_ID);
    }

    public function testSelfTestValueRoundTrip(): void
    {
        $this->seed(5, 'cmVhbA==');
        $this->seed(0, 'bGVmdG92ZXI=');

        $leftover = $this->store->selfTestValueIds();
        self::assertCount(1, $leftover);
        self::assertSame('bGVmdG92ZXI=', $this->store->selfTestCiphertext($leftover[0]));

        $id = $this->store->createSelfTestValue('dGVzdA==');
        self::assertSame('dGVzdA==', $this->store->selfTestCiphertext($id));
        self::assertNull($this->store->selfTestCiphertext(999_999));

        foreach ($this->store->selfTestValueIds() as $valueId) {
            $this->store->deleteSelfTestValue($valueId);
        }
        $this->store->deleteSelfTestValue($id); // already gone: 404 counts as done
        self::assertSame([], $this->store->selfTestValueIds());
        self::assertSame('cmVhbA==', $this->store->find(new PersonId(5)));
    }
}
