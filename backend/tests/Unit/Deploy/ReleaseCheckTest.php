<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Deploy;

use CtPassStore\Tests\Support\PhpProcess;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Catalog DP-03 (spec 6.6): `bin/release-check.php <tag>` fails unless the tag is `v` plus the VERSION file and
 * CHANGELOG.md has a section `## [<version>] - <YYYY-MM-DD>` with a real date; on success it prints that section.
 */
final class ReleaseCheckTest extends TestCase
{
    private const CHANGELOG = <<<'MD'
        # Changelog

        ## [0.2.0] - 2026-12-01

        - Later release.

        ## [0.1.0] - 2026-11-20

        ### Added

        - The /v1 API.

        ## [0.0.1] - 2026-01-01

        - Old.
        MD;

    private string $folder;

    protected function setUp(): void
    {
        $this->folder = sys_get_temp_dir() . '/ctps-release-' . bin2hex(random_bytes(6));
        mkdir($this->folder, 0o700);
        file_put_contents($this->folder . '/VERSION', "0.1.0\n");
        file_put_contents($this->folder . '/CHANGELOG.md', self::CHANGELOG . "\n");
    }

    protected function tearDown(): void
    {
        array_map('unlink', glob($this->folder . '/*') ?: []);
        rmdir($this->folder);
    }

    public function testMatchingTagVersionAndSectionPassAndPrintTheSection(): void
    {
        $result = $this->check('v0.1.0');

        self::assertSame(0, $result['exit'], $result['output']);
        self::assertStringContainsString('The /v1 API.', $result['output']);
        self::assertStringNotContainsString('Later release.', $result['output']);
        self::assertStringNotContainsString('Old.', $result['output']);
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function wrongTags(): iterable
    {
        yield 'other version' => ['v0.2.0'];
        yield 'no v prefix' => ['0.1.0'];
        yield 'suffix' => ['v0.1.0-rc1'];
        yield 'empty' => [''];
    }

    #[DataProvider('wrongTags')]
    public function testAWrongTagFails(string $tag): void
    {
        $result = $this->check($tag);

        self::assertSame(1, $result['exit'], $result['output']);
        self::assertStringContainsString('VERSION', $result['output']);
    }

    public function testAMissingSectionFails(): void
    {
        file_put_contents($this->folder . '/VERSION', "0.3.0\n");

        $result = $this->check('v0.3.0');

        self::assertSame(1, $result['exit'], $result['output']);
        self::assertStringContainsString('CHANGELOG', $result['output']);
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function badDates(): iterable
    {
        yield 'unreleased' => ['Unreleased'];
        yield 'placeholder' => ['YYYY-MM-DD'];
        yield 'impossible date' => ['2026-02-30'];
        yield 'wrong format' => ['20.11.2026'];
        yield 'missing' => [''];
    }

    #[DataProvider('badDates')]
    public function testAnUndatedSectionFails(string $date): void
    {
        file_put_contents($this->folder . '/CHANGELOG.md', "# Changelog\n\n## [0.1.0] - $date\n\n- Something.\n");

        $result = $this->check('v0.1.0');

        self::assertSame(1, $result['exit'], $result['output']);
        self::assertStringContainsString('date', $result['output']);
    }

    public function testAMissingTagArgumentFails(): void
    {
        $result = PhpProcess::run([dirname(__DIR__, 3) . '/bin/release-check.php'], [], dirname(__DIR__, 3));

        self::assertSame(1, $result['exit']);
    }

    /**
     * @return array{exit: int, output: string}
     */
    private function check(string $tag): array
    {
        return PhpProcess::run([dirname(__DIR__, 3) . '/bin/release-check.php', $tag, $this->folder], [], dirname(__DIR__, 3));
    }
}
