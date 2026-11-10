<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Infrastructure\Store;

use CtPassStore\Infrastructure\Store\RecordSigner;
use CtPassStore\Infrastructure\Store\SignedFileCache;
use CtPassStore\Infrastructure\Store\SignedFileStore;
use CtPassStore\Tests\Support\FrozenClock;
use Monolog\Handler\TestHandler;
use Monolog\Logger;
use PHPUnit\Framework\TestCase;

/**
 * The fail-open cache for non-secret data (spec 6.1 "Invalid entries", catalog section 12).
 */
final class SignedFileCacheTest extends TestCase
{
    private const SECRET = 'cache-test-secret-with-at-least-32-bytes';

    private string $dir;
    private TestHandler $log;
    private FrozenClock $clock;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/ctps-cache-' . bin2hex(random_bytes(6));
        $this->log = new TestHandler();
        $this->clock = new FrozenClock();
    }

    protected function tearDown(): void
    {
        @chmod($this->dir, 0o700);
        foreach (glob($this->dir . '/*') ?: [] as $file) {
            @chmod($file, 0o600);
            @unlink($file);
        }
        @rmdir($this->dir);
    }

    private function cache(string $secret = self::SECRET, ?string $dir = null): SignedFileCache
    {
        return new SignedFileCache(
            $dir ?? $this->dir,
            new RecordSigner($secret, SignedFileCache::PURPOSE),
            $this->clock,
            new Logger('test', [$this->log]),
        );
    }

    private function fileFor(string $name): string
    {
        return $this->dir . '/cache-' . hash('sha256', $name) . '.json';
    }

    public function testPutThenGetWithinTtl(): void
    {
        $cache = $this->cache();
        $cache->put('settings', ['adminUsers' => [1]], 60);
        $this->clock->advance(59);

        self::assertSame(['adminUsers' => [1]], $cache->get('settings'));
    }

    /** CA-02 */
    public function testGetAfterTtlIsNull(): void
    {
        $cache = $this->cache();
        $cache->put('settings', ['a' => 1], 60);
        $this->clock->advance(61);

        self::assertNull($cache->get('settings'));
    }

    public function testMissingEntryIsNull(): void
    {
        self::assertNull($this->cache()->get('nothing'));
        self::assertFalse($this->log->hasRecords(Logger::ERROR));
    }

    public function testForgetRemovesTheEntry(): void
    {
        $cache = $this->cache();
        $cache->put('settings', ['a' => 1], 60);
        $cache->forget('settings');

        self::assertNull($cache->get('settings'));
        $cache->forget('settings');
    }

    /** CA-08: a planted file with the current key ID and a wrong MAC */
    public function testTamperedEntryIsNullAndLogsError(): void
    {
        $cache = $this->cache();
        $cache->put('settings', ['adminUsers' => [1]], 60);
        $file = json_decode((string) file_get_contents($this->fileFor('settings')), true);
        $file['data'] = json_encode(['expires' => $this->clock->now()->getTimestamp() + 60, 'data' => ['adminUsers' => [99]]]);
        file_put_contents($this->fileFor('settings'), json_encode($file));

        self::assertNull($cache->get('settings'));
        self::assertCount(1, $this->log->getRecords());
        self::assertTrue($this->log->hasRecords(Logger::ERROR));
    }

    /** CA-08: a planted file with the current key ID and no MAC at all */
    public function testEntryWithoutMacIsNullAndLogsError(): void
    {
        $cache = $this->cache();
        $cache->put('settings', ['adminUsers' => [1]], 60);
        $file = json_decode((string) file_get_contents($this->fileFor('settings')), true);
        unset($file['mac']);
        file_put_contents($this->fileFor('settings'), json_encode($file));

        self::assertNull($cache->get('settings'));
        self::assertTrue($this->log->hasRecords(Logger::ERROR));
    }

    /** CA-11: rotation of JWT_SECRET */
    public function testOldKeyEntryIsNullWithoutError(): void
    {
        $this->cache('another-secret-with-at-least-32-bytes!!')->put('settings', ['a' => 1], 60);

        self::assertNull($this->cache()->get('settings'));
        self::assertFalse($this->log->hasRecords(Logger::ERROR));
        self::assertFalse($this->log->hasRecords(Logger::WARNING));
    }

    /**
     * A record sealed for the security store (same secret, other purpose) has another key ID, so RecordSigner reports
     * an old key: a miss without an error. The purpose keeps the two stores apart.
     */
    public function testSecurityStoreRecordIsNotAccepted(): void
    {
        $signer = new RecordSigner(self::SECRET, SignedFileStore::PURPOSE);
        mkdir($this->dir, 0o700);
        file_put_contents(
            $this->fileFor('settings'),
            $signer->seal('settings', ['expires' => $this->clock->now()->getTimestamp() + 60, 'data' => ['adminUsers' => [99]]]),
        );

        self::assertNull($this->cache()->get('settings'));
        self::assertFalse($this->log->hasRecords(Logger::ERROR));
    }

    public function testValidRecordWithoutExpiresOrDataIsAMiss(): void
    {
        $signer = new RecordSigner(self::SECRET, SignedFileCache::PURPOSE);
        mkdir($this->dir, 0o700);
        file_put_contents($this->fileFor('a'), $signer->seal('a', ['data' => ['x' => 1]]));
        file_put_contents($this->fileFor('b'), $signer->seal('b', ['expires' => $this->clock->now()->getTimestamp() + 60]));
        file_put_contents($this->fileFor('c'), $signer->seal('c', ['expires' => 'soon', 'data' => []]));

        $cache = $this->cache();
        self::assertNull($cache->get('a'));
        self::assertNull($cache->get('b'));
        self::assertNull($cache->get('c'));
    }

    /** An entry can't be copied to another name (the MAC covers the name). */
    public function testEntryCopiedToAnotherNameIsNull(): void
    {
        $cache = $this->cache();
        $cache->put('one', ['a' => 1], 60);
        copy($this->fileFor('one'), $this->fileFor('two'));

        self::assertNull($cache->get('two'));
        self::assertTrue($this->log->hasRecords(Logger::ERROR));
    }

    /** CA-05 */
    public function testCorruptFileIsNull(): void
    {
        $cache = $this->cache();
        $cache->put('settings', ['a' => 1], 60);
        file_put_contents($this->fileFor('settings'), '{');

        self::assertNull($cache->get('settings'));
        self::assertNull($this->cache()->get('settings'));
    }

    /** CA-05 */
    public function testEmptyFileIsNull(): void
    {
        $cache = $this->cache();
        $cache->put('settings', ['a' => 1], 60);
        file_put_contents($this->fileFor('settings'), '');

        self::assertNull($cache->get('settings'));
    }

    /** CA-05 */
    public function testUnwritableFolderNeverThrows(): void
    {
        if (function_exists('posix_geteuid') && posix_geteuid() === 0) {
            self::markTestSkipped('Running as root: chmod 0500 does not make the folder unwritable.');
        }
        mkdir($this->dir, 0o500);
        $cache = $this->cache();

        $cache->put('settings', ['a' => 1], 60);

        self::assertNull($cache->get('settings'));
        self::assertTrue($this->log->hasRecords(Logger::WARNING));
        self::assertSame([], glob($this->dir . '/*'));
    }

    /** CA-05: the folder can't even be created */
    public function testFolderThatCannotBeCreatedNeverThrows(): void
    {
        $blocker = sys_get_temp_dir() . '/ctps-blocker-' . bin2hex(random_bytes(6));
        file_put_contents($blocker, 'x');
        try {
            $cache = $this->cache(self::SECRET, $blocker . '/sub');
            $cache->put('settings', ['a' => 1], 60);

            self::assertNull($cache->get('settings'));
            $cache->forget('settings');
            self::assertTrue($this->log->hasRecords(Logger::WARNING));
        } finally {
            @unlink($blocker);
        }
    }

    /** CA-08 */
    public function testFilesAre600AndFolder700(): void
    {
        $this->cache()->put('settings', ['a' => 1], 60);

        self::assertSame('700', substr(sprintf('%o', fileperms($this->dir)), -3));
        self::assertSame('600', substr(sprintf('%o', fileperms($this->fileFor('settings'))), -3));
        self::assertSame([$this->fileFor('settings')], glob($this->dir . '/*'), 'no temporary file is left');
    }

    /** CA-04 */
    public function testFileContainsNoSecret(): void
    {
        $this->cache()->put('settings', ['a' => 1], 60);

        self::assertStringNotContainsString(self::SECRET, (string) file_get_contents($this->fileFor('settings')));
    }

    public function testPutOverwritesAnEarlierEntry(): void
    {
        $cache = $this->cache();
        $cache->put('settings', ['v' => 1], 60);
        $cache->put('settings', ['v' => 2], 60);

        self::assertSame(['v' => 2], $cache->get('settings'));
    }
}
