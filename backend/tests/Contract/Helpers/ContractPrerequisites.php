<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Contract\Helpers;

/**
 * Checks that everything the contract tests need is in place. Without it, the tests abort with a clear message
 * instead of failing somewhere deep inside or being reported as passed (spec 6.6).
 */
final class ContractPrerequisites
{
    private const ENV_VARIABLES = ['CT_API_URL', 'CT_API_TOKEN'];

    private const FIXTURES = ['normal_users.json'];

    public static function assertMet(): void
    {
        $missing = [];

        foreach (self::ENV_VARIABLES as $name) {
            $value = getenv($name);
            if ($value === false || $value === '') {
                $missing[] = "environment variable $name (set it in your local phpunit.xml)";
            }
        }

        if (!is_readable(__DIR__ . '/../../../config/credentials.php')) {
            $missing[] = 'config/credentials.php';
        }

        foreach (self::FIXTURES as $fixture) {
            if (!is_readable(__DIR__ . '/../fixtures/' . $fixture)) {
                $missing[] = 'tests/Contract/fixtures/' . $fixture;
            }
        }

        if ($missing !== []) {
            throw new \RuntimeException(
                'The contract tests need a ChurchTools test instance and local configuration. Missing: '
                . implode(', ', $missing) . '. See docs/testing.md.'
            );
        }
    }
}
