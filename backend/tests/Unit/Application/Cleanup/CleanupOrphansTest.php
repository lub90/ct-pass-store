<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Application\Cleanup;

use CtPassStore\Application\Cleanup\CleanupOrphans;
use CtPassStore\Application\Exception\ConfigurationException;
use CtPassStore\Application\Exception\PersonsNotReadableException;
use CtPassStore\Application\GoneAdmins;
use CtPassStore\Application\GonePersons;
use CtPassStore\Domain\PersonId;
use CtPassStore\Infrastructure\ChurchTools\ChurchToolsPersonDirectory;
use CtPassStore\Infrastructure\ChurchTools\Exception\InvalidResponseException;
use CtPassStore\Infrastructure\ChurchTools\Exception\RateLimitedException;
use CtPassStore\Infrastructure\ChurchTools\Exception\UnavailableException;
use CtPassStore\Infrastructure\Kv\ExtensionData;
use CtPassStore\Infrastructure\Kv\KvPasswordRepository;
use CtPassStore\Infrastructure\Kv\KvSchema;
use CtPassStore\Infrastructure\Kv\KvSettingsRepository;
use CtPassStore\Tests\Support\FakeChurchToolsClient;
use CtPassStore\Tests\Support\FrozenClock;
use Monolog\Handler\TestHandler;
use Monolog\Logger;
use PHPUnit\Framework\TestCase;

/**
 * Catalog GP-05 to GP-15, GP-21 to GP-24.
 */
final class CleanupOrphansTest extends TestCase
{
    private FakeChurchToolsClient $fake;

    private FrozenClock $clock;

    private TestHandler $log;

    private CleanupOrphans $cleanup;

    /** @var array<string, int> */
    private array $categories;

    protected function setUp(): void
    {
        $this->fake = new FakeChurchToolsClient();
        $this->fake->setServiceUserPermissions(['churchdb' => [
            'view' => true,
            'view alldata' => [1],
            'view archive' => true,
            'view hidden persons' => true,
        ]]);
        $this->categories = $this->fake->addModule(KvSchema::EXTENSION_KEY, [
            KvSchema::PASSWORD_CATEGORY,
            KvSchema::SETTINGS_CATEGORY,
            KvSchema::ENCRYPTION_CATEGORY,
        ]);
        $this->setAdmins([10]);
        $this->clock = new FrozenClock();
        $this->log = new TestHandler();
        $logger = new Logger('test', [$this->log]);
        $directory = new ChurchToolsPersonDirectory($this->fake);
        $gone = new GonePersons($directory, $this->clock);
        $this->cleanup = new CleanupOrphans(
            new KvPasswordRepository(new ExtensionData($this->fake), $logger),
            new KvSettingsRepository(new ExtensionData($this->fake), $logger),
            $directory,
            $gone,
            new GoneAdmins($gone),
            $this->clock,
            $logger,
        );
    }

    /**
     * @param list<int> $admins
     */
    private function setAdmins(array $admins): void
    {
        $this->fake->clearValues($this->categories[KvSchema::SETTINGS_CATEGORY]);
        $this->fake->seedValue($this->categories[KvSchema::SETTINGS_CATEGORY], json_encode([
            KvSchema::SETTING_REQUIRE_PRIMARY_PASSWORD => true,
            KvSchema::SETTING_ALLOW_CUSTOM_PASSWORD => false,
            KvSchema::SETTING_PASSWORD_LENGTH => 16,
            KvSchema::SETTING_ADMIN_USERS => $admins,
            KvSchema::SETTING_BACKEND_URL => 'https://backend.example.org/ctpassstore',
        ], JSON_THROW_ON_ERROR));
    }

    private function entry(mixed $personId): int
    {
        return $this->fake->seedValue($this->categories[KvSchema::PASSWORD_CATEGORY], json_encode([
            KvSchema::ENTRY_PERSON_ID => $personId,
            KvSchema::ENTRY_CIPHERTEXT => 'c2VjcmV0',
        ], JSON_THROW_ON_ERROR));
    }

    /**
     * @return list<int> the person IDs of the entries still stored, sorted
     */
    private function remaining(): array
    {
        $ids = array_map(
            static fn(array $v): int => (int) ((array) json_decode((string) $v['value'], true))[KvSchema::ENTRY_PERSON_ID],
            $this->fake->storedValues($this->categories[KvSchema::PASSWORD_CATEGORY]),
        );
        sort($ids);

        return $ids;
    }

    /**
     * @param list<PersonId> $persons
     * @return list<int>
     */
    private static function values(array $persons): array
    {
        return array_map(static fn(PersonId $p): int => $p->value, $persons);
    }

    private function seedMixed(): void
    {
        $this->fake->addPerson(10);
        $this->fake->addPerson(57, archived: true);
        $this->entry(10);
        $this->entry(56);
        $this->entry(57);
    }

    public function testDryRunDeletesNothing(): void
    {
        $this->seedMixed();

        $report = $this->cleanup->run(false);

        self::assertFalse($report->applied);
        self::assertSame(3, $report->checked);
        self::assertSame([56, 57], self::values($report->gone));
        self::assertSame(0, $report->deletedCount());
        self::assertSame(0, $this->fake->writeCount());
        self::assertSame([10, 56, 57], $this->remaining());
    }

    public function testApplyDeletesOnlyGonePersons(): void
    {
        $this->seedMixed();

        $report = $this->cleanup->run(true);

        self::assertTrue($report->applied);
        self::assertSame([56, 57], self::values($report->gone));
        self::assertSame(2, $report->deletedCount());
        self::assertSame(0, $report->exitCode());
        self::assertTrue($report->isComplete());
        self::assertSame([10], $this->remaining());
        self::assertTrue($this->log->hasInfo('Deleted the password entries of person 56; the person is deleted or archived.'));
        self::assertTrue($this->log->hasInfo('Deleted the password entries of person 57; the person is deleted or archived.'));
    }

    public function testFailedLookupDeletesNothing(): void
    {
        $this->seedMixed();
        $this->fake->failNext('activePersonIds', new UnavailableException('POST: unreachable.'));
        try {
            $this->cleanup->run(true);
            self::fail('Expected an exception.');
        } catch (UnavailableException) {
        }
        self::assertSame(0, $this->fake->writeCount());

        $this->fake->failNext('personStatus', new UnavailableException('GET: unreachable.'));
        try {
            $this->cleanup->run(true);
            self::fail('Expected an exception.');
        } catch (UnavailableException) {
        }
        self::assertSame(0, $this->fake->writeCount());
        self::assertSame([10, 56, 57], $this->remaining());
    }

    public function testRateLimitHalfwayDeletesNothing(): void
    {
        foreach ([51, 52, 53, 54] as $id) {
            $this->entry($id);
        }
        $this->fake->beforeNext('personStatus', static function (): void {});
        $this->fake->beforeNext('personStatus', static function (): void {});
        $this->fake->beforeNext('personStatus', fn() => $this->fake->failNext('personStatus', new RateLimitedException('GET: rate limited.', 30)));

        try {
            $this->cleanup->run(true);
            self::fail('Expected an exception.');
        } catch (RateLimitedException) {
        }

        self::assertSame(3, $this->fake->countCalls(['personStatus']));
        self::assertSame(0, $this->fake->writeCount());
        self::assertSame([51, 52, 53, 54], $this->remaining());
    }

    /** GP-21 */
    public function testAForeign404AbortsAndDeletesNothing(): void
    {
        $this->seedMixed();
        $this->fake->answerForeign404For(56);

        try {
            $this->cleanup->run(true);
            self::fail('Expected an exception.');
        } catch (InvalidResponseException) {
        }

        self::assertSame(0, $this->fake->writeCount());
        self::assertSame([10, 56, 57], $this->remaining());
    }

    /**
     * GP-22: the admins are looked up after the persons with entries; their failure must still prevent every delete.
     */
    public function testFailedAdminSingleLookupAfterSuccessfulLookupsDeletesNothing(): void
    {
        $this->setAdmins([10, 11]);
        $this->fake->addPerson(10);
        $this->fake->addPerson(11, archived: true);
        $this->entry(10);
        $this->entry(56);
        // The first single lookup is person 56 (found gone); the second is admin 11.
        $this->fake->beforeNext('personStatus', static function (): void {});
        $this->fake->beforeNext('personStatus', fn() => $this->fake->failNext('personStatus', new UnavailableException('GET: unreachable.')));

        try {
            $this->cleanup->run(true);
            self::fail('Expected an exception.');
        } catch (UnavailableException) {
        }

        self::assertSame(2, $this->fake->countCalls(['personStatus']));
        self::assertSame(0, $this->fake->writeCount());
        self::assertSame([10, 56], $this->remaining());
    }

    /** GP-22 */
    public function testFailedAdminBatchAfterSuccessfulLookupsDeletesNothing(): void
    {
        $this->setAdmins([10]);
        $this->fake->addPerson(10);
        $this->entry(10);
        $this->entry(56);
        // The first batch is for the persons with entries; the second for the admins.
        $this->fake->beforeNext('activePersonIds', static function (): void {});
        $this->fake->beforeNext('activePersonIds', fn() => $this->fake->failNext('activePersonIds', new UnavailableException('GET persons: unreachable.')));

        try {
            $this->cleanup->run(true);
            self::fail('Expected an exception.');
        } catch (UnavailableException) {
        }

        self::assertSame(2, $this->fake->countCalls(['activePersonIds']));
        self::assertSame(1, $this->fake->countCalls(['personStatus']));
        self::assertSame(0, $this->fake->writeCount());
        self::assertSame([10, 56], $this->remaining());
    }

    public function testFailedDeleteIsReportedAndOthersContinue(): void
    {
        $this->seedMixed();
        $this->fake->failNext('deleteValue', new UnavailableException('DELETE: unreachable.'));

        $report = $this->cleanup->run(true);

        self::assertSame([56 => 'DELETE: unreachable.'], $report->failedDeletes);
        self::assertSame([56, 57], self::values($report->gone));
        self::assertSame(1, $report->deletedCount());
        self::assertSame(1, $report->exitCode());
        self::assertSame([10, 56], $this->remaining());
        self::assertTrue($this->log->hasWarningThatContains('56'));
    }

    public function testGoneAdminWithAnEntryIsDeletedAndReported(): void
    {
        $this->setAdmins([10, 56]);
        $this->fake->addPerson(10);
        $this->entry(56);

        $report = $this->cleanup->run(true);

        self::assertSame([56], self::values($report->goneAdmins));
        self::assertSame([56], self::values($report->gone));
        self::assertSame(1, $report->exitCode());
        self::assertSame([], $this->remaining());
    }

    public function testPersonZeroIsIgnored(): void
    {
        $this->entry(0);
        $this->fake->addPerson(10);
        $this->entry(10);

        $report = $this->cleanup->run(true);

        self::assertSame(1, $report->checked);
        self::assertSame([], $report->gone);
        self::assertSame(0, $this->fake->writeCount());
        self::assertSame(0, $this->fake->countCalls(['personStatus']));
    }

    public function testStringIdsAndDuplicatesAreRemovedCompletely(): void
    {
        $this->entry('56');
        $this->entry(56);
        $this->entry('56');
        $this->fake->addPerson(10);
        $this->entry(10);

        $report = $this->cleanup->run(true);

        self::assertSame([56], self::values($report->gone));
        self::assertSame([10], $this->remaining());
    }

    public function testInvalidSettingsAbortBeforeDeleting(): void
    {
        $this->seedMixed();
        $this->fake->clearValues($this->categories[KvSchema::SETTINGS_CATEGORY]);
        $this->fake->seedValue($this->categories[KvSchema::SETTINGS_CATEGORY], 'not json');

        $this->expectException(ConfigurationException::class);
        try {
            $this->cleanup->run(true);
        } finally {
            self::assertSame(0, $this->fake->writeCount());
        }
    }

    public function testMissingRightAbortsBeforeAnyLookup(): void
    {
        $this->seedMixed();
        $this->fake->setServiceUserPermissions([]);

        try {
            $this->cleanup->run(true);
            self::fail('Expected an exception.');
        } catch (PersonsNotReadableException) {
        }

        self::assertSame(0, $this->fake->countCalls(['personStatus', 'activePersonIds']));
        self::assertSame(0, $this->fake->writeCount());
    }

    public function testDeadlineLeavesTheRestUnchecked(): void
    {
        foreach ([51, 52, 53] as $id) {
            $this->entry($id);
        }
        // Single lookups only start in the first half of the budget (15 s); the deletes may use all of it.
        $this->fake->beforeNext('personStatus', fn() => $this->clock->advance(20));

        $report = $this->cleanup->run(true, $this->clock->now()->modify('+30 seconds'));

        self::assertSame([51], self::values($report->gone));
        self::assertSame([52, 53], self::values($report->unchecked));
        self::assertFalse($report->isComplete());
        self::assertSame([52, 53], $this->remaining());

        $second = $this->cleanup->run(true);

        self::assertSame([52, 53], self::values($second->gone));
        self::assertTrue($second->isComplete());
        self::assertSame([], $this->remaining());
    }

    /** GP-23 */
    public function testDeletesListTheCategoryOnce(): void
    {
        foreach ([51, 52, 53, 54] as $id) {
            $this->entry($id);
            $this->entry($id);
        }
        $this->fake->addPerson(10);
        $this->entry(10);
        $passwordStore = $this->categories[KvSchema::PASSWORD_CATEGORY];
        $listings = fn(): int => count(array_filter(
            $this->fake->calls(),
            static fn(array $c): bool => $c['method'] === 'getValues' && $c['args'][1] === $passwordStore,
        ));

        $report = $this->cleanup->run(true);

        self::assertSame(4, $report->deletedCount());
        self::assertSame([10], $this->remaining());
        // One listing for personIds(), one for all deletes.
        self::assertSame(2, $listings());
        self::assertSame(8, $this->fake->countCalls(['deleteValue']));
    }

    /** GP-24 */
    public function testDeadlineDuringTheDeletesLeavesTheRestUncheckedAndTheNextRunContinues(): void
    {
        $this->fake->addPerson(10);
        foreach ([51, 52, 53] as $id) {
            $this->entry($id);
        }
        $this->entry(51);
        $deadline = $this->clock->now()->modify('+20 seconds');
        // The first person's deletes run past the deadline: both of its entries still go, nobody else starts.
        $this->fake->beforeNext('deleteValue', fn() => $this->clock->advance(30));

        $report = $this->cleanup->run(true, $deadline);

        self::assertSame([51], self::values($report->gone));
        self::assertSame([52, 53], self::values($report->unchecked));
        self::assertSame(1, $report->deletedCount());
        self::assertSame([], $report->failedDeletes);
        self::assertFalse($report->isComplete());
        self::assertSame(0, $report->exitCode());
        self::assertSame([52, 53], $this->remaining());
        self::assertSame(2, $this->fake->countCalls(['deleteValue']));

        $second = $this->cleanup->run(true);

        self::assertSame([52, 53], self::values($second->gone));
        self::assertTrue($second->isComplete());
        self::assertSame([], $this->remaining());
    }

    /** GP-24: a deadline that passed during the admin lookups lets no delete start. */
    public function testDeadlinePassedBeforeTheDeletesDeletesNothing(): void
    {
        $this->setAdmins([11]);
        $this->fake->addPerson(11, archived: true);
        $this->entry(51);
        $deadline = $this->clock->now()->modify('+20 seconds');
        // The second single lookup is admin 11's; it ends after the deadline.
        $this->fake->beforeNext('personStatus', static function (): void {});
        $this->fake->beforeNext('personStatus', fn() => $this->clock->advance(30));

        $report = $this->cleanup->run(true, $deadline);

        self::assertSame([], $report->gone);
        self::assertSame([51], self::values($report->unchecked));
        self::assertSame([11], self::values($report->goneAdmins));
        self::assertFalse($report->isComplete());
        self::assertSame(0, $this->fake->writeCount());
        self::assertSame([51], $this->remaining());
    }
}
