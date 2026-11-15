<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Load;

use CtPassStore\Tests\Load\Helpers\ResultsFile;
use PHPUnit\Framework\TestCase;

/**
 * The load test's results file is created new with mode 600 and never follows a planted file or symlink (security
 * review M7).
 */
final class ResultsFileTest extends TestCase
{
    private string $dir;

    private int $umask;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/ctps-results-' . bin2hex(random_bytes(6));
        mkdir($this->dir, 0o700);
        // A permissive umask: the file must still be 600.
        $this->umask = umask(0o022);
    }

    protected function tearDown(): void
    {
        umask($this->umask);
        foreach (scandir($this->dir) ?: [] as $name) {
            if ($name !== '.' && $name !== '..') {
                unlink($this->dir . '/' . $name);
            }
        }
        rmdir($this->dir);
    }

    private static function mode(string $path): int
    {
        clearstatcache();

        return fileperms($path) & 0o777;
    }

    /**
     * @return list<string>
     */
    private function files(): array
    {
        return array_values(array_diff(scandir($this->dir) ?: [], ['.', '..']));
    }

    public function testDefaultIsANewFileWithMode600InTheTempFolder(): void
    {
        foreach ([false, ''] as $configured) {
            $file = ResultsFile::create($configured, $this->dir);

            self::assertSame($this->dir, dirname($file->path));
            self::assertMatchesRegularExpression('/^ctps-load-results-[0-9a-f]{16}\.json$/', basename($file->path));
            self::assertFileExists($file->path);
            self::assertFalse(is_link($file->path));
            self::assertSame(0o600, self::mode($file->path));
            $file->close();
        }
        self::assertCount(2, $this->files(), 'Every run gets a file of its own.');
    }

    public function testWritesReplaceTheWholeContent(): void
    {
        $file = ResultsFile::create(false, $this->dir);

        $file->write(['stages' => ['a long first value that is longer than the second']]);
        $file->write(['done' => true]);

        self::assertSame(['done' => true], json_decode((string) file_get_contents($file->path), true));
        self::assertSame(0o600, self::mode($file->path));
        $file->close();
    }

    public function testConfiguredPathIsCreatedWithMode600(): void
    {
        $path = $this->dir . '/mine.json';

        $file = ResultsFile::create($path, $this->dir);
        $file->write(['ok' => 1]);
        $file->close();

        self::assertSame($path, $file->path);
        self::assertSame(0o600, self::mode($path));
        self::assertSame(['ok' => 1], json_decode((string) file_get_contents($path), true));
    }

    public function testAnExistingFileIsNeverOverwritten(): void
    {
        $path = $this->dir . '/existing.json';
        file_put_contents($path, 'keep me');

        try {
            ResultsFile::create($path, $this->dir);
            self::fail('Expected an exception.');
        } catch (\RuntimeException $e) {
            self::assertStringContainsString('already exists', $e->getMessage());
        }

        self::assertSame('keep me', file_get_contents($path));
    }

    public function testAPlantedSymlinkIsNotFollowed(): void
    {
        $target = $this->dir . '/target.txt';
        file_put_contents($target, 'victim');
        $link = $this->dir . '/link.json';
        symlink($target, $link);
        $dangling = $this->dir . '/dangling.json';
        symlink($this->dir . '/created-through-the-link.txt', $dangling);

        foreach ([$link, $dangling] as $path) {
            try {
                ResultsFile::create($path, $this->dir);
                self::fail('Expected an exception for ' . basename($path));
            } catch (\RuntimeException) {
            }
        }

        self::assertSame('victim', file_get_contents($target));
        self::assertFileDoesNotExist($this->dir . '/created-through-the-link.txt');
    }

    public function testTheUmaskIsRestored(): void
    {
        ResultsFile::create(false, $this->dir)->close();

        self::assertSame(0o022, umask());
    }
}
