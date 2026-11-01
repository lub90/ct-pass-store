<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Service;

use CtPassStore\ChurchTools\Exception\UnavailableException;
use CtPassStore\Config\AppConfig;
use CtPassStore\Service\ChurchToolsStore;
use CtPassStore\Service\ExtensionDataService;
use CtPassStore\Tests\Support\FakeChurchToolsClient;
use Monolog\Handler\TestHandler;
use Monolog\Logger;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Catalog section 3: ST-01 to ST-11, ST-14, ST-15, ST-17, ST-20 to ST-22.
 */
final class ChurchToolsStoreTest extends TestCase
{
    private FakeChurchToolsClient $fake;

    private TestHandler $log;

    private ChurchToolsStore $store;

    private int $category;

    protected function setUp(): void
    {
        $this->fake = new FakeChurchToolsClient();
        $ids = $this->fake->addModule(AppConfig::CT_EXTENSION_ID, [AppConfig::CT_PWD_CATEGORY_NAME]);
        $this->category = $ids[AppConfig::CT_PWD_CATEGORY_NAME];
        $this->log = new TestHandler();
        $logger = new Logger('test');
        $logger->pushHandler($this->log);
        $this->store = new ChurchToolsStore(new ExtensionDataService($this->fake, AppConfig::CT_EXTENSION_ID), $logger);
    }

    private function seed(mixed $personId, mixed $ciphertext = 'c2VjcmV0'): int
    {
        return $this->fake->seedValue($this->category, json_encode([
            AppConfig::CT_PERSON_ID_PWD_FIELD => $personId,
            AppConfig::CT_ENCRYPTED_PWD_FIELD => $ciphertext,
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

        self::assertSame('bWluZQ==', $this->store->getPwd(5));
    }

    public function testReturnsNullWithoutEntry(): void
    {
        self::assertNull($this->store->getPwd(5));
    }

    public function testNeverReturnsAnEntryOfASimilarPersonId(): void
    {
        foreach ([50, 15, 55, 6, 51] as $other) {
            $this->seed($other);
        }

        self::assertNull($this->store->getPwd(5));
    }

    public function testWithDuplicatesTheNewestEntryWinsAndAWarningIsLogged(): void
    {
        $this->seed(5, 'b2xk');
        $this->seed(5, 'bmV3');

        self::assertSame('bmV3', $this->store->getPwd(5));
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

        self::assertSame('dGVu', $this->store->getPwd(5));
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
        yield 'too long' => ['1234567890123456789012', null];
    }

    #[DataProvider('personIds')]
    public function testPersonIdNormalization(mixed $raw, ?int $expected): void
    {
        self::assertSame($expected, ChurchToolsStore::normalizePersonId($raw));
    }

    public function testStringPersonIdsAreTheSamePersonForReadWriteAndDelete(): void
    {
        $this->seed('5', 'c3RyaW5n');

        self::assertSame('c3RyaW5n', $this->store->getPwd(5));

        $this->store->putPwd(5, 'dXBkYXRlZA==');
        self::assertCount(1, $this->stored());
        self::assertSame(5, $this->stored()[0][AppConfig::CT_PERSON_ID_PWD_FIELD], 'The rewritten entry stores the ID as an integer.');

        $this->store->deletePwd(5);
        self::assertSame([], $this->stored());
    }

    public function testLooselyEqualPersonIdsAreNotTheSamePerson(): void
    {
        foreach (['05', '5a', ' 5', '5 '] as $loose) {
            $this->seed($loose);
        }
        $this->fake->seedValue($this->category, '{"personId": 5.5, "secondaryPwd": "eA=="}');
        $this->fake->seedValue($this->category, '{"personId": true, "secondaryPwd": "eA=="}');

        self::assertNull($this->store->getPwd(5));
        $this->store->deletePwd(5);
        self::assertCount(6, $this->stored(), 'None of them may be deleted for person 5.');
    }

    // ---------------------------------------------------------------- write (ST-03, ST-04, ST-06, ST-14, ST-15, ST-17)

    public function testWriteWithoutEntryCreatesExactlyOneWithAnIntegerPersonId(): void
    {
        $this->store->putPwd(5, 'bmV3');

        self::assertSame(1, $this->fake->countCalls(['createValue']));
        self::assertSame(0, $this->fake->countCalls(['updateValue', 'deleteValue']));
        $stored = $this->stored();
        self::assertCount(1, $stored);
        self::assertSame(5, $stored[0][AppConfig::CT_PERSON_ID_PWD_FIELD]);
        self::assertSame('bmV3', $stored[0][AppConfig::CT_ENCRYPTED_PWD_FIELD]);
    }

    public function testWriteWithOneEntryUpdatesIt(): void
    {
        $id = $this->seed(5, 'b2xk');

        $this->store->putPwd(5, 'bmV3');

        self::assertSame(0, $this->fake->countCalls(['createValue', 'deleteValue']));
        self::assertSame([['id' => $id, AppConfig::CT_PERSON_ID_PWD_FIELD => 5, AppConfig::CT_ENCRYPTED_PWD_FIELD => 'bmV3']], $this->stored());
    }

    public function testWriteWithDuplicatesUpdatesTheNewestAndDeletesTheRest(): void
    {
        $this->seed(5, 'MQ==');
        $this->seed(5, 'Mg==');
        $newest = $this->seed(5, 'Mw==');

        $this->store->putPwd(5, 'bmV3');

        self::assertSame([['id' => $newest, AppConfig::CT_PERSON_ID_PWD_FIELD => 5, AppConfig::CT_ENCRYPTED_PWD_FIELD => 'bmV3']], $this->stored());
        self::assertSame('bmV3', $this->store->getPwd(5));
    }

    public function testWritingAndDeletingNeverTouchOtherPersons(): void
    {
        $others = [
            $this->seed(6, 'c2l4'),
            $this->seed(6, 'c2l4LTI='),
            $this->fake->seedValue($this->category, '{broken'),
            $this->seed(7, null),
        ];

        $this->store->putPwd(5, 'Zml2ZQ==');
        $this->store->putPwd(5, 'Zml2ZS0y');
        $this->store->deletePwd(5);

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
            $this->store->putPwd(5, 'bmV3');
            self::fail('Expected the write to fail.');
        } catch (UnavailableException) {
        }

        self::assertSame(0, $this->fake->countCalls(['createValue']));
        self::assertSame('b2xk', $this->store->getPwd(5));
    }

    public function testFailedCreateIsReported(): void
    {
        $this->fake->failNext('createValue', new UnavailableException('POST: unreachable.'));

        $this->expectException(UnavailableException::class);
        $this->store->putPwd(5, 'bmV3');
    }

    public function testFailedDuplicateRemovalStillStoresTheNewPassword(): void
    {
        $this->seed(5, 'b2xk');
        $this->seed(5, 'b2xkMg==');
        $this->fake->failNext('deleteValue', new UnavailableException('DELETE: unreachable.'));

        $this->store->putPwd(5, 'bmV3');

        self::assertSame('bmV3', $this->store->getPwd(5), 'The updated newest entry wins.');
        self::assertCount(2, $this->stored(), 'The duplicate stays until the next write.');
        self::assertGreaterThanOrEqual(1, $this->warnings());

        $this->store->putPwd(5, 'bmV3ZXI=');
        self::assertCount(1, $this->stored(), 'The next write heals it.');
    }

    public function testValuesOverTheKvLimitAreRefusedBeforeWriting(): void
    {
        try {
            $this->store->putPwd(5, str_repeat('A', ChurchToolsStore::MAX_VALUE_LENGTH));
            self::fail('Expected an exception.');
        } catch (\LogicException) {
            self::assertSame(0, $this->fake->writeCount());
        }
    }

    public function testRegularCiphertextsFitTheKvLimit(): void
    {
        $this->store->putPwd(5, base64_encode(random_bytes(1024)));

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

        self::assertSame('Zml2ZQ==', $this->store->getPwd(5));
        self::assertSame(1, $this->warnings());

        $this->store->putPwd(6, 'c2l4');
        self::assertSame('c2l4', $this->store->getPwd(6));
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

        self::assertNull($this->store->getPwd(5));

        $this->store->putPwd(5, 'Zml4ZWQ=');
        self::assertSame([['id' => $corrupt, AppConfig::CT_PERSON_ID_PWD_FIELD => 5, AppConfig::CT_ENCRYPTED_PWD_FIELD => 'Zml4ZWQ=']], $this->stored(), 'Overwritten, no duplicate next to it.');
    }

    public function testCorruptOwnEntryIsDeleted(): void
    {
        $this->seed(5, null);

        $this->store->deletePwd(5);

        self::assertSame([], $this->stored());
    }

    // ---------------------------------------------------------------- delete (ST-10, ST-11)

    public function testDeleteRemovesAllEntriesOfThePersonOnly(): void
    {
        $this->seed(5);
        $this->seed(5);
        $this->seed(6);

        $this->store->deletePwd(5);

        self::assertCount(1, $this->stored());
        self::assertSame(6, $this->stored()[0][AppConfig::CT_PERSON_ID_PWD_FIELD]);
    }

    public function testDeleteWithoutEntryDoesNothing(): void
    {
        $this->store->deletePwd(5);

        self::assertSame(0, $this->fake->writeCount());
    }

    // ---------------------------------------------------------------- reserved person ID 0 (ST-22)

    public function testSelfTestValuesAreInvisibleToPersonOperations(): void
    {
        $this->seed(0, 'dGVzdA==');
        $this->seed(0, 'dGVzdDI=');
        $this->seed('0', 'dGVzdDM=');

        self::assertNull($this->store->getPwd(5));
        $this->store->putPwd(5, 'Zml2ZQ==');
        $this->store->deletePwd(5);

        self::assertCount(3, $this->stored());
        self::assertSame(0, $this->warnings(), 'Self-test values are skipped silently.');
    }

    public function testPersonOperationsRejectTheReservedId(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->store->putPwd(ChurchToolsStore::SELF_TEST_PERSON_ID, 'eA==');
    }
}
