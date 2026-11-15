<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Load;

use CtPassStore\Application\Cleanup\CleanupCooldown;
use CtPassStore\Application\Exception\CleanupTooSoonException;
use CtPassStore\Infrastructure\ChurchTools\CachedPersonDirectory;
use CtPassStore\Infrastructure\Kv\KvSettingsRepository;
use CtPassStore\Infrastructure\Store\FileCooldownStore;
use CtPassStore\Infrastructure\Store\RecordSigner;
use CtPassStore\Infrastructure\Store\SignedFileCache;
use CtPassStore\Infrastructure\Store\SignedFileStore;
use CtPassStore\Tests\Load\Helpers\LoadSandbox;
use CtPassStore\Tests\Support\FrozenClock;
use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;

/**
 * The load test's sandbox writes and removes the records the backend itself uses, under the names from `src` (test
 * review M14). Only the local sandbox folder is touched; nothing is started or sent.
 */
final class LoadSandboxTest extends TestCase
{
    private const SECRET = 'jwt-secret-for-the-load-sandbox-test-0123456789';

    private LoadSandbox $sandbox;

    protected function setUp(): void
    {
        $this->sandbox = new LoadSandbox(['JWT_SECRET' => self::SECRET], self::SECRET);
    }

    protected function tearDown(): void
    {
        $this->sandbox->stopAndRemove();
    }

    private function cache(): SignedFileCache
    {
        return new SignedFileCache($this->sandbox->folder . '/cache', new RecordSigner(self::SECRET, SignedFileCache::PURPOSE), new FrozenClock(), new NullLogger());
    }

    private function cooldown(): CleanupCooldown
    {
        return new CleanupCooldown(new FileCooldownStore(new SignedFileStore($this->sandbox->folder . '/cache', self::SECRET, new NullLogger()), new FrozenClock()));
    }

    public function testPlantedSettingsAreTheBackendsSettingsCacheRecord(): void
    {
        $this->sandbox->plantSettings(['backendUrl' => 'https://backend.example.org']);

        self::assertSame(['backendUrl' => 'https://backend.example.org'], $this->cache()->get(KvSettingsRepository::CACHE_SETTINGS));
    }

    public function testClearPersonsCacheRemovesTheBackendsPersonsRecord(): void
    {
        $this->cache()->put(CachedPersonDirectory::RECORD, ['seeded' => true], 600);

        $this->sandbox->clearPersonsCache();

        self::assertNull($this->cache()->get(CachedPersonDirectory::RECORD));
    }

    public function testClearCleanupCooldownRemovesTheWebCronsCooldown(): void
    {
        self::assertFalse($this->sandbox->clearCleanupCooldown(), 'No record yet.');
        $this->cooldown()->start();
        try {
            $this->cooldown()->start();
            self::fail('The cooldown should be running.');
        } catch (CleanupTooSoonException) {
        }

        self::assertTrue($this->sandbox->clearCleanupCooldown());

        $this->cooldown()->start();
        self::assertTrue($this->sandbox->clearCleanupCooldown());
    }
}
