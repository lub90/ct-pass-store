<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Infrastructure\ChurchTools;

use CtPassStore\Application\Exception\PersonsNotReadableException;
use CtPassStore\Domain\PersonId;
use CtPassStore\Infrastructure\ChurchTools\ChurchToolsPersonDirectory;
use CtPassStore\Infrastructure\ChurchTools\Exception\RateLimitedException;
use CtPassStore\Tests\Support\FakeChurchToolsClient;
use PHPUnit\Framework\TestCase;

/**
 * Catalog GP-01.
 */
final class ChurchToolsPersonDirectoryTest extends TestCase
{
    private FakeChurchToolsClient $fake;

    private ChurchToolsPersonDirectory $directory;

    protected function setUp(): void
    {
        $this->fake = new FakeChurchToolsClient();
        $this->fake->setServiceUserPermissions(['churchdb' => [
            'view' => true,
            'view alldata' => [1],
            'view archive' => true,
            'view hidden persons' => true,
        ]]);
        $this->fake->addPerson(1);
        $this->fake->addPerson(2, archived: true);
        $this->directory = new ChurchToolsPersonDirectory($this->fake);
    }

    public function testExistsIsTrueOnlyForAnActivePerson(): void
    {
        self::assertTrue($this->directory->exists(new PersonId(1)));
        self::assertFalse($this->directory->exists(new PersonId(2)));
        self::assertFalse($this->directory->exists(new PersonId(3)));
    }

    public function testExistsPropagatesFailures(): void
    {
        $this->fake->failNext('personStatus', new RateLimitedException('Too many requests.', 5));

        $this->expectException(RateLimitedException::class);
        $this->directory->exists(new PersonId(1));
    }

    public function testConfirmedActiveChunksIntoBatchesOf100(): void
    {
        $ids = range(1000, 1249);
        foreach ($ids as $id) {
            $this->fake->addPerson($id);
        }

        $confirmed = $this->directory->confirmedActive(array_map(static fn(int $i): PersonId => new PersonId($i), $ids));

        self::assertSame(3, $this->fake->countCalls(['activePersonIds']));
        self::assertSame($ids, array_map(static fn(PersonId $p): int => $p->value, $confirmed));
    }

    public function testConfirmedActiveOfNobodyMakesNoCall(): void
    {
        self::assertSame([], $this->directory->confirmedActive([]));
        self::assertSame(0, $this->fake->countCalls(['activePersonIds']));
    }

    public function testAssertReadablePassesWithTheRight(): void
    {
        $this->directory->assertReadable();

        $this->addToAssertionCount(1);
    }

    public function testAssertReadableNamesWhatIsMissing(): void
    {
        $this->fake->setServiceUserPermissions(['churchdb' => ['view' => true, 'view alldata' => [1], 'view archive' => true]]);

        try {
            $this->directory->assertReadable();
            self::fail('Expected an exception.');
        } catch (PersonsNotReadableException $e) {
            self::assertSame(
                "The service user can't read persons (missing: churchdb view hidden persons); see docs/setup.md.",
                $e->getMessage(),
            );
        }
    }
}
