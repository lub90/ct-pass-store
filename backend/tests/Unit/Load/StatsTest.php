<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Load;

use CtPassStore\Tests\Load\Helpers\Stats;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Min, median, p95 (nearest rank) and max of the load test's durations (test review M14).
 */
final class StatsTest extends TestCase
{
    /**
     * @return iterable<string, array{list<float>, array{n: int, min: float, median: float, p95: float, max: float}}>
     */
    public static function cases(): iterable
    {
        yield 'empty' => [[], ['n' => 0, 'min' => 0.0, 'median' => 0.0, 'p95' => 0.0, 'max' => 0.0]];
        yield 'one value' => [[5.0], ['n' => 1, 'min' => 5.0, 'median' => 5.0, 'p95' => 5.0, 'max' => 5.0]];
        yield 'odd count, unsorted' => [[3.0, 1.0, 2.0], ['n' => 3, 'min' => 1.0, 'median' => 2.0, 'p95' => 3.0, 'max' => 3.0]];
        yield 'even count: mean of the middle two' => [[4.0, 1.0, 3.0, 2.0], ['n' => 4, 'min' => 1.0, 'median' => 2.5, 'p95' => 4.0, 'max' => 4.0]];
        // Nearest rank: ceil(0.95 * 20) = 19, the 19th value, not the maximum.
        yield '20 values' => [array_map('floatval', range(20, 1)), ['n' => 20, 'min' => 1.0, 'median' => 10.5, 'p95' => 19.0, 'max' => 20.0]];
        // ceil(0.95 * 21) = 20.
        yield '21 values' => [array_map('floatval', range(1, 21)), ['n' => 21, 'min' => 1.0, 'median' => 11.0, 'p95' => 20.0, 'max' => 21.0]];
        // ceil(0.95 * 12) = ceil(11.4) = 12, the maximum; round() would give rank 11.
        yield '12 values' => [array_map('floatval', range(1, 12)), ['n' => 12, 'min' => 1.0, 'median' => 6.5, 'p95' => 12.0, 'max' => 12.0]];
        // ceil(0.95 * 100) = 95.
        yield '100 values' => [array_map('floatval', range(1, 100)), ['n' => 100, 'min' => 1.0, 'median' => 50.5, 'p95' => 95.0, 'max' => 100.0]];
        yield 'rounded to one decimal' => [[1.26, 1.24], ['n' => 2, 'min' => 1.2, 'median' => 1.3, 'p95' => 1.3, 'max' => 1.3]];
    }

    /**
     * @param list<float> $ms
     * @param array{n: int, min: float, median: float, p95: float, max: float} $expected
     */
    #[DataProvider('cases')]
    public function testOf(array $ms, array $expected): void
    {
        self::assertSame($expected, Stats::of($ms));
    }
}
