<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Load\Helpers;

/**
 * Min, median, p95 (nearest rank) and max of a list of durations in milliseconds.
 */
final class Stats
{
    /**
     * @param list<float> $ms
     * @return array{n: int, min: float, median: float, p95: float, max: float}
     */
    public static function of(array $ms): array
    {
        if ($ms === []) {
            return ['n' => 0, 'min' => 0.0, 'median' => 0.0, 'p95' => 0.0, 'max' => 0.0];
        }
        sort($ms);
        $n = count($ms);
        $rank = static fn(float $q): float => $ms[max(0, (int) ceil($q * $n) - 1)];

        return [
            'n' => $n,
            'min' => round($ms[0], 1),
            'median' => round($n % 2 === 1 ? $ms[intdiv($n, 2)] : ($ms[$n / 2 - 1] + $ms[$n / 2]) / 2, 1),
            'p95' => round($rank(0.95), 1),
            'max' => round($ms[$n - 1], 1),
        ];
    }
}
