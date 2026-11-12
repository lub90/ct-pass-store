<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Infrastructure\ChurchTools;

use CtPassStore\Domain\PersonId;
use CtPassStore\Infrastructure\ChurchTools\CachedPersonDirectory;
use CtPassStore\Infrastructure\ChurchTools\ChurchToolsPersonDirectory;
use CtPassStore\Infrastructure\Store\RecordSigner;
use CtPassStore\Infrastructure\Store\SignedFileCache;
use CtPassStore\Tests\Support\FakeChurchToolsClient;
use CtPassStore\Tests\Support\FrozenClock;
use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;

/**
 * Catalog GP-04.
 */
final class CachedPersonDirectoryTest extends TestCase
{
    private string $dir;
    private FakeChurchToolsClient $fake;
    private FrozenClock $clock;
    private SignedFileCache $cache;
    private CachedPersonDirectory $directory;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/ctps-persons-' . bin2hex(random_bytes(6));
        $this->clock = new FrozenClock();
        $this->fake = new FakeChurchToolsClient();
        $this->fake->setServiceUserPermissions(['churchdb' => [
            'view' => true,
            'view alldata' => [1],
            'view archive' => true,
            'view hidden persons' => true,
        ]]);
        $this->cache = new SignedFileCache(
            $this->dir,
            new RecordSigner('cache-test-secret-with-at-least-32-bytes', SignedFileCache::PURPOSE),
            $this->clock,
            new NullLogger(),
        );
        $this->directory = new CachedPersonDirectory(new ChurchToolsPersonDirectory($this->fake), $this->cache, $this->clock);
    }

    protected function tearDown(): void
    {
        foreach (glob($this->dir . '/*') ?: [] as $file) {
            @unlink($file);
        }
        @rmdir($this->dir);
    }

    public function testExistingPersonIsCached(): void
    {
        $this->fake->addPerson(10);

        self::assertTrue($this->directory->exists(new PersonId(10)));
        self::assertTrue($this->directory->exists(new PersonId(10)));
        self::assertSame(1, $this->fake->countCalls(['personStatus']));
    }

    public function testCacheExpiresAfter600Seconds(): void
    {
        $this->fake->addPerson(10);
        self::assertTrue($this->directory->exists(new PersonId(10)));

        $this->clock->advance(599);
        self::assertTrue($this->directory->exists(new PersonId(10)));
        self::assertSame(1, $this->fake->countCalls(['personStatus']));

        $this->fake->removePerson(10);
        $this->clock->advance(1);
        self::assertFalse($this->directory->exists(new PersonId(10)));
        self::assertSame(2, $this->fake->countCalls(['personStatus']));
    }

    public function testGoneIsNeverCached(): void
    {
        self::assertFalse($this->directory->exists(new PersonId(56)));
        self::assertFalse($this->directory->exists(new PersonId(56)));
        self::assertSame(2, $this->fake->countCalls(['personStatus']));
    }

    public function testExpiredIdsAreDroppedOnWrite(): void
    {
        for ($id = 1; $id <= 10; ++$id) {
            $this->fake->addPerson($id);
            $this->directory->exists(new PersonId($id));
        }
        $this->clock->advance(601);
        $this->fake->addPerson(99);
        $this->directory->exists(new PersonId(99));

        $record = $this->cache->get('persons-active');
        self::assertNotNull($record);
        self::assertSame(['99'], array_map('strval', array_keys($record)));
    }

    public function testBrokenCacheIsAMiss(): void
    {
        $this->fake->addPerson(10);
        $this->directory->exists(new PersonId(10));
        foreach (glob($this->dir . '/cache-*.json') ?: [] as $file) {
            file_put_contents($file, '{broken');
        }

        self::assertTrue($this->directory->exists(new PersonId(10)));
        self::assertSame(2, $this->fake->countCalls(['personStatus']));
    }

    public function testConfirmedActiveAndAssertReadablePassThrough(): void
    {
        $this->fake->addPerson(10);

        self::assertEquals([new PersonId(10)], $this->directory->confirmedActive([new PersonId(10), new PersonId(11)]));
        $this->directory->assertReadable();

        self::assertSame(1, $this->fake->countCalls(['activePersonIds']));
        self::assertNull($this->cache->get('persons-active'));
        self::assertFalse($this->directory->exists(new PersonId(11)));
    }
}
