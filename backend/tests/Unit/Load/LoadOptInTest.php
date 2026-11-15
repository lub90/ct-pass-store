<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Load;

use CtPassStore\Tests\Load\Helpers\LoadOptIn;
use CtPassStore\Tests\Support\PhpProcess;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * The load test writes to a real ChurchTools instance, so it runs only with an explicit opt-in (`CPS_LOAD_TEST=1`) and
 * never as part of a plain `phpunit` run (security review M6).
 */
final class LoadOptInTest extends TestCase
{
    private const BACKEND = __DIR__ . '/../../..';

    /**
     * @return iterable<string, array{string|false}>
     */
    public static function notOptedIn(): iterable
    {
        yield 'unset' => [false];
        yield 'empty' => [''];
        yield 'zero' => ['0'];
        yield 'yes' => ['yes'];
        yield 'true' => ['true'];
        yield 'one with a space' => [' 1'];
        yield 'one with a newline' => ["1\n"];
        yield 'two' => ['2'];
    }

    #[DataProvider('notOptedIn')]
    public function testOnlyExactlyOneOptsIn(string|false $value): void
    {
        self::assertSame(
            'The load test writes to a real ChurchTools instance and runs only with CPS_LOAD_TEST=1 (against a TEST instance, never production). See docs/testing.md.',
            LoadOptIn::skipReason($value),
        );
    }

    public function testOneOptsIn(): void
    {
        self::assertNull(LoadOptIn::skipReason('1'));
    }

    /**
     * Without the opt-in the whole class is skipped before anything else runs: before the prerequisites check (which
     * would fail here, as this checkout has no local configuration) and so before credentials are read or any request
     * is sent. The environment holds only PATH: no CPS_LOAD_TEST, no CT_API_URL, no CT_API_TOKEN.
     */
    public function testWithoutOptInTheLoadTestSkipsBeforeItsPrerequisites(): void
    {
        $result = PhpProcess::run(
            [self::BACKEND . '/vendor/bin/phpunit', '-c', self::BACKEND . '/phpunit.xml.dist', '--do-not-cache-result', '--display-skipped', '--colors=never', self::BACKEND . '/tests/Load/LoadTest.php'],
            ['PATH' => (string) getenv('PATH')],
            self::BACKEND,
        );

        self::assertSame(0, $result['exit'], $result['output']);
        self::assertStringContainsString('runs only with CPS_LOAD_TEST=1', $result['output']);
        self::assertMatchesRegularExpression('/OK, but some tests were skipped!|Skipped: 1/', $result['output']);
        self::assertStringNotContainsString('contract tests need', $result['output']);
        self::assertStringNotContainsString('[Load] Reminder', $result['output']);
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function configurations(): iterable
    {
        yield 'phpunit.xml.dist' => ['phpunit.xml.dist'];
        yield 'phpunit-example.xml' => ['phpunit-example.xml'];
    }

    /** A plain `phpunit -c <file>` without a suite or path runs only Unit and Api. */
    #[DataProvider('configurations')]
    public function testConfigurationsDefaultToUnitAndApi(string $file): void
    {
        $xml = simplexml_load_file(self::BACKEND . '/' . $file);
        self::assertNotFalse($xml);

        self::assertSame('Unit,Api', (string) $xml['defaultTestSuite']);
    }
}
