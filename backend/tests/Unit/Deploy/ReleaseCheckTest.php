<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Deploy;

use CtPassStore\Tests\Support\PhpProcess;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Catalog DP-03 (spec 6.6): `bin/release-check.php <tag>` fails unless the tag is `backend-v` plus the VERSION file,
 * CHANGELOG.md has a section `## [<version>] - <YYYY-MM-DD>` with a real date and MAJOR.MINOR equals that of
 * extension/package.json (AG-12, versioning.md); on success it prints that section.
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

    private string $root;
    private string $folder;

    protected function setUp(): void
    {
        $this->root = sys_get_temp_dir() . '/ctps-release-' . bin2hex(random_bytes(6));
        $this->folder = $this->root . '/backend';
        mkdir($this->folder, 0o700, true);
        mkdir($this->root . '/extension', 0o700);
        file_put_contents($this->root . '/extension/package.json', '{"name": "ext", "version": "0.1.4"}');
        file_put_contents($this->folder . '/VERSION', "0.1.0\n");
        file_put_contents($this->folder . '/CHANGELOG.md', self::CHANGELOG . "\n");
    }

    protected function tearDown(): void
    {
        foreach (['/backend/*', '/extension/*'] as $pattern) {
            array_map('unlink', glob($this->root . $pattern) ?: []);
        }
        rmdir($this->folder);
        rmdir($this->root . '/extension');
        rmdir($this->root);
    }

    public function testMatchingTagVersionAndSectionPassAndPrintTheSection(): void
    {
        $result = $this->check('backend-v0.1.0');

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
        yield 'other version' => ['backend-v0.2.0'];
        yield 'no prefix' => ['0.1.0'];
        yield 'old tag pattern' => ['v0.1.0'];
        yield 'extension tag' => ['extension-v0.1.0'];
        yield 'suffix' => ['backend-v0.1.0-rc1'];
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
        file_put_contents($this->root . '/extension/package.json', '{"version": "0.3.0"}');

        $result = $this->check('backend-v0.3.0');

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

        $result = $this->check('backend-v0.1.0');

        self::assertSame(1, $result['exit'], $result['output']);
        self::assertStringContainsString('date', $result['output']);
    }

    public function testADifferentExtensionMinorFails(): void
    {
        file_put_contents($this->root . '/extension/package.json', '{"version": "0.2.0"}');

        $result = $this->check('backend-v0.1.0');

        self::assertSame(1, $result['exit'], $result['output']);
        self::assertStringContainsString("MAJOR.MINOR 0.1 differs from the extension's 0.2 (versioning.md)", $result['output']);
    }

    public function testADifferentExtensionPatchPasses(): void
    {
        file_put_contents($this->root . '/extension/package.json', '{"version": "0.1.9"}');

        self::assertSame(0, $this->check('backend-v0.1.0')['exit']);
    }

    public function testAMissingOrBrokenExtensionPackageJsonFails(): void
    {
        unlink($this->root . '/extension/package.json');
        $missing = $this->check('backend-v0.1.0');
        file_put_contents($this->root . '/extension/package.json', '{"name": "x"}');
        $noVersion = $this->check('backend-v0.1.0');

        self::assertSame(1, $missing['exit'], $missing['output']);
        self::assertStringContainsString('extension/package.json', $missing['output']);
        self::assertSame(1, $noVersion['exit'], $noVersion['output']);
        self::assertStringContainsString('extension/package.json', $noVersion['output']);
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
