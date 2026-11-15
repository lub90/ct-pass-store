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

    /**
     * @return iterable<string, array{array<string, mixed>|false, string|false, string}>
     */
    public static function states(): iterable
    {
        yield 'on, checks for changes' => [self::opcacheStatus(true), '1', 'OPcache is on; validate_timestamps is on.'];
        yield 'on, no checks for changes' => [
            self::opcacheStatus(true),
            '0',
            'OPcache is on; validate_timestamps is off, so uploaded updates and a changed config/credentials.php take effect only after an OPcache reset or a PHP restart.',
        ];
        yield 'on, setting unreadable' => [self::opcacheStatus(true), false, 'OPcache is on; validate_timestamps is unknown.'];
        yield 'loaded but off' => [self::opcacheStatus(false), '1', 'OPcache is off (see docs/setup.md to turn it on).'];
        yield 'not loaded or status restricted' => [false, false, 'OPcache is off (see docs/setup.md to turn it on).'];
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

    public function testTheDefaultReadersWorkWhereOpcacheIsOffForTheCli(): void
    {
        $outcome = (new OpcacheCheck())->run();

        self::assertTrue($outcome->ok);
        self::assertMatchesRegularExpression('~^OPcache is (on|off)~', $outcome->message);
        self::assertStringNotContainsString('/', str_replace('docs/setup.md', '', str_replace('config/credentials.php', '', $outcome->message)));
    }
}
