<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Infrastructure\Store;

use CtPassStore\Application\Exception\ConfigurationException;
use CtPassStore\Infrastructure\Store\SignedFileStore;
use Monolog\Handler\TestHandler;
use Monolog\Logger;
use PHPUnit\Framework\TestCase;

/**
 * The security store's integrity rules (spec 6.1, catalog section 12).
 */
final class SignedFileStoreTest extends TestCase
{
    private const SECRET = 'store-test-secret-with-at-least-32-bytes';

    private string $dir;
    private TestHandler $log;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/ctps-store-' . bin2hex(random_bytes(6));
        $this->log = new TestHandler();
    }

    protected function tearDown(): void
    {
        foreach (glob($this->dir . '/*') ?: [] as $file) {
            @chmod($file, 0o600);
            @unlink($file);
        }
        @chmod($this->dir, 0o700);
        @rmdir($this->dir);
    }

    private function store(string $secret = self::SECRET): SignedFileStore
    {
        return new SignedFileStore($this->dir, $secret, new Logger('test', [$this->log]));
    }

    /**
     * @param array<string, mixed> $data
     */
    private function put(string $name, array $data, ?SignedFileStore $store = null): void
    {
        ($store ?? $this->store())->update($name, static fn(array $old): array => $data);
    }

    /**
     * @return array<string, mixed>
     */
    private function get(string $name, ?SignedFileStore $store = null): array
    {
        return ($store ?? $this->store())->update($name, static fn(array $data): array => $data);
    }

    /**
     * The only data file (lock files and temporary files aside).
     */
    private function onlyFile(): string
    {
        $files = glob($this->dir . '/*.json') ?: [];
        self::assertCount(1, $files);

        return $files[0];
    }

    private function lockFileOf(string $name): string
    {
        return $this->dir . '/sec-' . hash('sha256', $name) . '.lock';
    }

    public function testANewRecordIsEmptyAndUpdatesPersist(): void
    {
        self::assertSame([], $this->get('jti:ct-radius'));

        $this->put('jti:ct-radius', ['j:abc' => 123]);

        self::assertSame(['j:abc' => 123], $this->get('jti:ct-radius'));
    }

    public function testRecordsAreSeparate(): void
    {
        $this->put('a', ['x' => 1]);
        $this->put('b', ['x' => 2]);

        self::assertSame(['x' => 1], $this->get('a'));
        self::assertSame(['x' => 2], $this->get('b'));
    }

    public function testFolderAndFilesAreOnlyAccessibleByTheOwner(): void
    {
        $this->put('jti:ct-radius', ['j:abc' => 1]);

        self::assertSame(0o700, fileperms($this->dir) & 0o777);
        self::assertSame(0o600, fileperms($this->onlyFile()) & 0o777);
        self::assertSame(0o600, fileperms($this->lockFileOf('jti:ct-radius')) & 0o777);
    }

    public function testFileNamesDontRevealTheRecordName(): void
    {
        $this->put('jti:ct-radius', ['j:abc' => 1]);

        self::assertStringNotContainsString('radius', basename($this->onlyFile()));
        self::assertMatchesRegularExpression('/^sec-[0-9a-f]{64}\.json$/', basename($this->onlyFile()));
    }

    public function testTheFileIsJsonWithoutTheSecret(): void
    {
        $this->put('attempts:5', ['failures' => [1, 2]]);
        $raw = (string) file_get_contents($this->onlyFile());

        self::assertIsArray(json_decode($raw, true));
        self::assertStringNotContainsString(self::SECRET, $raw);
        self::assertStringNotContainsString('O:', $raw, 'No serialized PHP objects.');
    }

    public function testTamperedDataFailsClosed(): void
    {
        $this->put('attempts:5', ['failures' => [1, 2, 3, 4, 5]]);
        $file = $this->onlyFile();
        $raw = json_decode((string) file_get_contents($file), true);
        self::assertIsArray($raw);
        $raw['data'] = '{"failures":[]}';
        file_put_contents($file, json_encode($raw));

        try {
            $this->get('attempts:5');
            self::fail('Expected a ConfigurationException.');
        } catch (ConfigurationException $e) {
            self::assertStringContainsString('integrity', $e->getMessage());
            self::assertStringNotContainsString($this->dir, $e->getMessage(), 'No server paths in the problem detail.');
        }
        self::assertTrue($this->log->hasErrorThatContains('failed its integrity check'));
    }

    public function testARecordCantBeCopiedToAnotherName(): void
    {
        $this->put('jti:ct-radius', ['j:abc' => 1]);
        $source = $this->onlyFile();
        $target = $this->dir . '/sec-' . hash('sha256', 'jti:other-client') . '.json';
        copy($source, $target);

        $this->expectException(ConfigurationException::class);
        $this->get('jti:other-client');
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function brokenFiles(): iterable
    {
        yield 'garbage' => ['not json'];
        yield 'serialized PHP' => ['O:8:"stdClass":0:{}'];
        yield 'no keyId' => ['{"data":"{}","mac":"x"}'];
        yield 'no mac' => ['{"format":1,"keyId":"KEYID","data":"{}"}'];
        yield 'empty mac' => ['{"format":1,"keyId":"KEYID","data":"{}","mac":""}'];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('brokenFiles')]
    public function testBrokenFilesFailClosed(string $content): void
    {
        $this->put('r', ['x' => 1]);
        $file = $this->onlyFile();
        $keyId = json_decode((string) file_get_contents($file), true)['keyId'] ?? '';
        file_put_contents($file, str_replace('KEYID', (string) $keyId, $content));

        $this->expectException(ConfigurationException::class);
        $this->get('r');
    }

    public function testARotatedSecretStartsOver(): void
    {
        $this->put('attempts:5', ['failures' => [1, 2, 3, 4, 5]]);

        self::assertSame([], $this->get('attempts:5', $this->store('a-rotated-secret-with-at-least-32-bytes-xx')));
        self::assertTrue($this->log->hasNoticeThatContains('earlier JWT_SECRET'));
    }

    public function testAnUnusableFolderFailsClosed(): void
    {
        $file = (string) tempnam(sys_get_temp_dir(), 'ctps-file-');
        try {
            $store = new SignedFileStore($file . '/sub', self::SECRET, new Logger('test'));

            $this->expectException(ConfigurationException::class);
            $store->update('r', static fn(array $d): array => $d);
        } finally {
            @unlink($file);
        }
    }

    public function testAReadOnlyFolderFailsClosed(): void
    {
        if (function_exists('posix_geteuid') && posix_geteuid() === 0) {
            self::markTestSkipped('root ignores file permissions');
        }
        $this->put('r', ['x' => 1]);
        chmod($this->dir, 0o500);

        try {
            $this->expectException(ConfigurationException::class);
            $this->put('r', ['x' => 2]);
        } finally {
            chmod($this->dir, 0o700);
            self::assertSame(['x' => 1], $this->get('r'), 'The old content is intact.');
        }
    }

    // ---------------------------------------------------------------- atomic writes and locking

    public function testTheLockIsHeldForTheWholeUpdate(): void
    {
        $this->put('r', ['x' => 1]);
        $lockedByOther = null;

        $this->store()->update('r', function (array $data) use (&$lockedByOther): array {
            $other = fopen($this->lockFileOf('r'), 'c');
            self::assertNotFalse($other);
            $lockedByOther = flock($other, LOCK_EX | LOCK_NB);
            fclose($other);

            return $data;
        });

        self::assertFalse($lockedByOther, 'A second worker must wait while the record is being updated.');
    }

    public function testTheLockFileIsNeverReplacedButTheDataFileIs(): void
    {
        $this->put('r', ['x' => 1]);
        $lockInode = fileinode($this->lockFileOf('r'));
        $dataInode = fileinode($this->onlyFile());

        $this->put('r', ['x' => 2]);

        clearstatcache();
        self::assertSame($lockInode, fileinode($this->lockFileOf('r')));
        self::assertNotSame($dataInode, fileinode($this->onlyFile()), 'The data file is swapped in one step.');
    }

    public function testAFailedChangeLeavesTheOldContent(): void
    {
        $this->put('r', ['x' => 1]);

        try {
            $this->store()->update('r', static fn(array $data): array => throw new \RuntimeException('killed'));
        } catch (\RuntimeException) {
        }

        self::assertSame(['x' => 1], $this->get('r'));
        self::assertSame([], glob($this->dir . '/*.tmp') ?: []);
    }

    public function testLeftoversOfAKilledWriteAreIgnoredAndRemoved(): void
    {
        $this->put('r', ['x' => 1]);
        // A write killed after creating its temporary file but before the rename.
        $stale = $this->dir . '/sec-' . hash('sha256', 'r') . '.deadbeef.tmp';
        file_put_contents($stale, '{"half":');

        self::assertSame(['x' => 1], $this->get('r'));
        self::assertFileDoesNotExist($stale);
    }

    /**
     * Updates in a row through separate instances (like separate PHP workers) build on each other. This runs them
     * one after another; that a second worker really has to wait is shown by testTheLockIsHeldForTheWholeUpdate.
     */
    public function testUpdatesInARowFromSeparateInstancesAreAllKept(): void
    {
        for ($i = 0; $i < 25; $i++) {
            $this->store()->update('counter', static fn(array $data): array => ['n' => (is_int($data['n'] ?? null) ? $data['n'] : 0) + 1]);
        }

        self::assertSame(['n' => 25], $this->get('counter'));
    }
}
