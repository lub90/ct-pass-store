<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Infrastructure;

use CtPassStore\Infrastructure\Version;
use CtPassStore\Tests\Support\PhpProcess;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * The version string x.y.z, x.y.z+<sha>, x.y.z+<sha>-dirty (spec 6.5, catalog DP-02).
 */
final class VersionTest extends TestCase
{
    private string $dir;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/ctps-version-' . bin2hex(random_bytes(6));
        mkdir($this->dir);
        file_put_contents($this->dir . '/VERSION', "0.1.0\n");
    }

    protected function tearDown(): void
    {
        foreach (glob($this->dir . '/*') ?: [] as $file) {
            unlink($file);
        }
        rmdir($this->dir);
    }

    /** @return iterable<string, array{?string, string, bool, string}> */
    public static function formatCases(): iterable
    {
        yield 'tagged and clean' => ['v0.1.0', 'abc1234', false, '0.1.0'];
        yield 'tagged and dirty' => ['v0.1.0', 'abc1234', true, '0.1.0+abc1234-dirty'];
        yield 'untagged' => [null, 'abc1234', false, '0.1.0+abc1234'];
        yield 'untagged and dirty' => [null, 'abc1234', true, '0.1.0+abc1234-dirty'];
        yield 'other tag' => ['v0.0.9', 'abc1234', false, '0.1.0+abc1234'];
    }

    #[DataProvider('formatCases')]
    public function testFormat(?string $tag, string $sha, bool $dirty, string $expected): void
    {
        self::assertSame($expected, Version::format('0.1.0', $tag, $sha, $dirty));
    }

    public function testCurrentReadsVersionTxt(): void
    {
        file_put_contents($this->dir . '/version.txt', "0.1.0+abc1234-dirty\n");
        self::assertSame('0.1.0+abc1234-dirty', Version::current($this->dir));
        file_put_contents($this->dir . '/version.txt', '0.2.0');
        self::assertSame('0.2.0', Version::current($this->dir));
    }

    public function testCurrentIgnoresAnInvalidVersionTxt(): void
    {
        file_put_contents($this->dir . '/version.txt', '1.0.0; rm -rf /');
        self::assertSame('0.1.0+unknown', Version::current($this->dir));
    }

    public function testCurrentWithoutVersionTxtIsUnknown(): void
    {
        self::assertSame('0.1.0+unknown', Version::current($this->dir));
        self::assertSame('0.1.0', Version::base($this->dir));
    }

    public function testBinVersionPrintsAVersion(): void
    {
        $backend = dirname(__DIR__, 3);
        $result = PhpProcess::run([$backend . '/bin/version.php'], [], $backend);
        self::assertSame(0, $result['exit']);
        self::assertMatchesRegularExpression('/^0\.1\.0(\+([0-9a-f]{7}(-dirty)?|unknown))?$/', trim($result['output']));
    }
}
