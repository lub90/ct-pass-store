<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Application;

use CtPassStore\Application\GonePersons;
use CtPassStore\Domain\PersonId;
use CtPassStore\Infrastructure\ChurchTools\ChurchToolsPersonDirectory;
use CtPassStore\Infrastructure\ChurchTools\Exception\UnavailableException;
use CtPassStore\Tests\Support\FakeChurchToolsClient;
use CtPassStore\Tests\Support\FrozenClock;
use PHPUnit\Framework\TestCase;

/**
 * Catalog GP-02.
 */
final class GonePersonsTest extends TestCase
{
    private FakeChurchToolsClient $fake;

    private FrozenClock $clock;

    private GonePersons $gone;

    protected function setUp(): void
    {
        $this->fake = new FakeChurchToolsClient();
        $this->fake->setServiceUserPermissions(['churchdb' => [
            'view' => true,
            'view alldata' => [1],
            'view archive' => true,
            'view hidden persons' => true,
        ]]);
        $this->clock = new FrozenClock();
        $this->gone = new GonePersons(new ChurchToolsPersonDirectory($this->fake), $this->clock);
    }

    /**
     * @param list<int> $ids
     * @return list<PersonId>
     */
    private static function ids(array $ids): array
    {
        return array_map(static fn(int $i): PersonId => new PersonId($i), $ids);
    }

    /**
     * @param list<PersonId> $persons
     * @return list<int>
     */
    private static function values(array $persons): array
    {
        return array_map(static fn(PersonId $p): int => $p->value, $persons);
    }

    public function testOnlyUnconfirmedPersonsGetASingleLookup(): void
    {
        $this->fake->addPerson(1);
        $this->fake->addPerson(2);
        $this->fake->addPerson(3);
        $this->fake->addPerson(4, archived: true);
        // 5 is unknown.

        $result = $this->gone->find(self::ids([1, 2, 3, 4, 5]));

        self::assertSame(2, $this->fake->countCalls(['personStatus']));
        self::assertSame([4, 5], self::values($result->gone));
        self::assertSame([], $result->unchecked);
    }

    public function testBatchFailurePropagatesWithoutSingleLookups(): void
    {
        $this->fake->addPerson(1);
        $this->fake->failNext('activePersonIds', new UnavailableException('POST: unreachable.'));

        try {
            $this->gone->find(self::ids([1, 2]));
            self::fail('Expected an exception.');
        } catch (UnavailableException) {
            self::assertSame(0, $this->fake->countCalls(['personStatus']));
        }
    }

    public function testSingleLookupFailurePropagates(): void
    {
        $this->fake->failNext('personStatus', new UnavailableException('GET: unreachable.'));

        $this->expectException(UnavailableException::class);
        $this->gone->find(self::ids([7]));
    }

    public function testPersonsAfterThePassedDeadlineAreUnchecked(): void
    {
        $this->fake->beforeNext('personStatus', fn() => $this->clock->advance(60));
        $deadline = $this->clock->now()->modify('+30 seconds');

        $result = $this->gone->find(self::ids([5, 6, 7]), $deadline);

        self::assertSame(1, $this->fake->countCalls(['personStatus']));
        self::assertSame([5], self::values($result->gone));
        self::assertSame([6, 7], self::values($result->unchecked));
    }

    public function testAnEmptyInputMakesNoCall(): void
    {
        $result = $this->gone->find([]);

        self::assertSame([], $result->gone);
        self::assertSame([], $result->unchecked);
        self::assertSame([], $this->fake->calls());
    }
}
