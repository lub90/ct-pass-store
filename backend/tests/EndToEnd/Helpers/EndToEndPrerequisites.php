<?php

declare(strict_types=1);

namespace CtPassStore\Tests\EndToEnd\Helpers;

/**
 * Checks that everything the end-to-end tests need is in place. Without it, the tests abort with a clear message
 * instead of failing somewhere deep inside or being reported as passed.
 */
final class EndToEndPrerequisites
{
    private const ENV_VARIABLES = ['CT_API_URL', 'CT_API_TOKEN'];

    private const FIXTURES = [
        'admin_users.json',
        'normal_users.json',
        'read_access_users.json',
        'no_access_allowed_users.json',
    ];

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
                $missing[] = 'tests/EndToEnd/fixtures/' . $fixture;
            }
        }

        if ($missing !== []) {
            throw new \RuntimeException(
                'The end-to-end tests need a ChurchTools test instance and local configuration. Missing: '
                . implode(', ', $missing) . '. See docs/testing.md.'
            );
        }
    }
}
