<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Load;

use CtPassStore\Tests\Load\Helpers\ResultsFile;
use PHPUnit\Framework\Attributes\DataProvider;
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

    /**
     * @return iterable<string, array{string|false}>
     */
    public static function noConfiguredPath(): iterable
    {
        yield 'unset' => [false];
        yield 'empty' => [''];
    }

    #[DataProvider('noConfiguredPath')]
    public function testDefaultIsANewFileWithMode600InTheTempFolder(string|false $configured): void
    {
        $file = ResultsFile::create($configured, $this->dir);
        $file->close();

        self::assertSame($this->dir, dirname($file->path));
        self::assertMatchesRegularExpression('/^ctps-load-results-[0-9a-f]{16}\.json$/', basename($file->path));
        self::assertFileExists($file->path);
        self::assertFalse(is_link($file->path));
        self::assertSame(0o600, self::mode($file->path));
        self::assertSame([basename($file->path)], $this->files());
    }

    public function testEveryRunGetsAFileOfItsOwn(): void
    {
        $first = ResultsFile::create(false, $this->dir);
        $second = ResultsFile::create(false, $this->dir);
        $first->close();
        $second->close();

        self::assertNotSame($first->path, $second->path);
        self::assertCount(2, $this->files());
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

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage("The results file {$path} already exists; remove it or choose another LOAD_RESULTS_FILE.");
        try {
            ResultsFile::create($path, $this->dir);
        } finally {
            self::assertSame('keep me', file_get_contents($path));
            self::assertSame(['existing.json'], $this->files());
        }
    }

    /**
     * @return iterable<string, array{bool}>
     */
    public static function plantedLinks(): iterable
    {
        yield 'link to an existing file' => [true];
        yield 'dangling link' => [false];
    }

    #[DataProvider('plantedLinks')]
    public function testAPlantedSymlinkIsNotFollowed(bool $targetExists): void
    {
        $target = $this->dir . '/target.txt';
        if ($targetExists) {
            file_put_contents($target, 'victim');
        }
        $link = $this->dir . '/link.json';
        symlink($target, $link);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage("The results file {$link} is a link; remove it or choose another LOAD_RESULTS_FILE.");
        try {
            ResultsFile::create($link, $this->dir);
        } finally {
            if ($targetExists) {
                self::assertSame('victim', file_get_contents($target));
            } else {
                self::assertFileDoesNotExist($target, 'Nothing was created through the link.');
            }
            self::assertSame($target, readlink($link));
        }
    }

    public function testAPathInAMissingFolderCreatesNothing(): void
    {
        $path = $this->dir . '/missing/results.json';

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage("Can't create the results file {$path}.");
        try {
            ResultsFile::create($path, $this->dir);
        } finally {
            self::assertDirectoryDoesNotExist($this->dir . '/missing');
            self::assertSame([], $this->files());
        }
    }

    public function testTheOpenHandleMustBeTheFileAtThePath(): void
    {
        $path = $this->dir . '/a.json';
        $other = $this->dir . '/b.json';
        $link = $this->dir . '/link-to-a.json';
        file_put_contents($path, '');
        file_put_contents($other, '');
        symlink($path, $link);
        $handle = fopen($path, 'r');
        self::assertIsResource($handle);
        try {
            self::assertTrue(ResultsFile::isFileAt($handle, $path));
            self::assertFalse(ResultsFile::isFileAt($handle, $other), 'Another file at the path.');
            self::assertFalse(ResultsFile::isFileAt($handle, $link), 'A link to the same file is still a link.');
            self::assertFalse(ResultsFile::isFileAt($handle, $this->dir . '/missing.json'), 'Nothing at the path.');
        } finally {
            fclose($handle);
        }
    }

    public function testTheUmaskIsRestored(): void
    {
        ResultsFile::create(false, $this->dir)->close();

        self::assertSame(0o022, umask());
    }
}
