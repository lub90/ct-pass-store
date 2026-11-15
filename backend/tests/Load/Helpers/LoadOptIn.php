<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Load\Helpers;

/**
 * The explicit opt-in of the load test: it writes to a real ChurchTools instance, so it runs only when the environment
 * variable `CPS_LOAD_TEST` is exactly `1` (security review M6). Checked first, before anything is read or sent.
 */
final class LoadOptIn
{
    public const VARIABLE = 'CPS_LOAD_TEST';

    /**
     * @param string|false $value the value of CPS_LOAD_TEST, as getenv() returns it
     * @return string|null why the load test is skipped, or null when it may run
     */
    public static function skipReason(string|false $value): ?string
    {
        if ($value === '1') {
            return null;
        }

        return 'The load test writes to a real ChurchTools instance and runs only with ' . self::VARIABLE . '=1 (against a TEST instance, never production). See docs/testing.md.';
    }
}
