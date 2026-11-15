<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Infrastructure\SelfCheck;

use CtPassStore\Infrastructure\SelfCheck\OpcacheCheck;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Security M3: the self-check reports whether OPcache is on and checks for changed files, and nothing else about the
 * host (no paths, no memory figures, no version). It never fails: OPcache is optional.
 */
final class OpcacheCheckTest extends TestCase
{
    /**
     * A status as `opcache_get_status(false)` returns it, with the host details the check must not pass on.
     *
     * @return array<string, mixed>
     */
    private static function opcacheStatus(bool $enabled): array
    {
        return [
            'opcache_enabled' => $enabled,
            'cache_full' => false,
            'memory_usage' => ['used_memory' => 123456789, 'free_memory' => 987654321],
            'opcache_statistics' => ['num_cached_scripts' => 4242, 'hits' => 31337],
            'file_cache' => '/var/lib/php/opcache-secret-host-path',
            'jit' => ['enabled' => false],
        ];
    }

    private const OFF = 'OPcache is off or its status is not readable (see docs/setup.md to turn it on).';
    private const ON = 'OPcache is on; validate_timestamps is on.';
    private const NO_VALIDATE = 'OPcache is on; validate_timestamps is off, so uploaded updates and a changed config/credentials.php take effect only after an OPcache reset or a PHP restart.';
    private const UNKNOWN = 'OPcache is on; validate_timestamps is unknown.';

    /** Every message the check can give; the API test checks against this list. */
    public const MESSAGES = [self::OFF, self::ON, self::NO_VALIDATE, self::UNKNOWN];

    /**
     * @return iterable<string, array{array<string, mixed>|false, string|false, string}>
     */
    public static function states(): iterable
    {
        // ini_get() gives the value as written: "1"/"0" from a php.ini, "On"/"Off" or "" from other sources.
        yield 'on, "1"' => [self::opcacheStatus(true), '1', self::ON];
        yield 'on, "On"' => [self::opcacheStatus(true), 'On', self::ON];
        yield 'on, "0"' => [self::opcacheStatus(true), '0', self::NO_VALIDATE];
        yield 'on, "Off"' => [self::opcacheStatus(true), 'Off', self::NO_VALIDATE];
        yield 'on, ""' => [self::opcacheStatus(true), '', self::NO_VALIDATE];
        yield 'on, setting unreadable' => [self::opcacheStatus(true), false, self::UNKNOWN];
        yield 'on, setting garbage' => [self::opcacheStatus(true), 'maybe', self::UNKNOWN];
        yield 'loaded but off' => [self::opcacheStatus(false), '1', self::OFF];
        yield 'status without opcache_enabled' => [array_diff_key(self::opcacheStatus(true), ['opcache_enabled' => true]), '1', self::OFF];
        yield 'opcache_enabled not a bool' => [['opcache_enabled' => 1] + self::opcacheStatus(true), '1', self::OFF];
        yield 'not loaded or restrict_api' => [false, false, self::OFF];
    }

    /**
     * @param array<string, mixed>|false $status
     */
    #[DataProvider('states')]
    public function testReportsOnlyTheTwoValues(array|false $status, string|false $validateTimestamps, string $message): void
    {
        $asked = [];
        $check = new OpcacheCheck(
            static fn(): array|false => $status,
            static function (string $name) use (&$asked, $validateTimestamps): string|false {
                $asked[] = $name;

                return $validateTimestamps;
            },
        );

        $outcome = $check->run();

        self::assertSame('OPcache', $check->name());
        self::assertTrue($outcome->ok);
        self::assertSame($message, $outcome->message);
        self::assertSame([], array_diff($asked, ['opcache.validate_timestamps']), 'Only validate_timestamps is read from the configuration.');
    }

    public function testTheDefaultReadersGiveOneOfTheFixedMessages(): void
    {
        $outcome = (new OpcacheCheck())->run();

        self::assertTrue($outcome->ok);
        self::assertContains($outcome->message, self::MESSAGES);
    }
}
