<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Security;

use PHPUnit\Framework\TestCase;

/**
 * The PHPStan rule set for banned calls is active (catalog IJ-06, PG-05, TR-01): analysing a fixture that uses
 * each banned call reports every one of them. If someone removes the rule set from the configuration, this fails.
 */
final class BannedCallsTest extends TestCase
{
    private const BACKEND = __DIR__ . '/../../..';

    public function testEveryBannedCallInTheFixtureIsReported(): void
    {
        $command = sprintf(
            '%s %s analyse --no-progress --error-format=json --memory-limit=512M -c %s 2>/dev/null',
            escapeshellarg(PHP_BINARY),
            escapeshellarg(self::BACKEND . '/vendor/bin/phpstan'),
            escapeshellarg(self::BACKEND . '/tests/Fixtures/BannedCalls/phpstan.neon'),
        );
        $output = (string) shell_exec($command);
        $result = json_decode($output, true);
        self::assertIsArray($result, "PHPStan output isn't JSON: $output");

        $messages = [];
        foreach ($result['files'] ?? [] as $file) {
            foreach ($file['messages'] as $message) {
                $messages[$message['line']] = $message['message'];
            }
        }

        $expected = ['eval', 'exec', 'shell_exec', 'unserialize', 'str_shuffle', 'mt_rand', 'md5', 'strcmp', 'var_dump', 'in_array'];
        self::assertCount(count($expected), $messages, 'Reported: ' . json_encode($messages, JSON_PRETTY_PRINT));
        foreach ($expected as $function) {
            self::assertNotEmpty(
                array_filter($messages, static fn(string $m): bool => str_contains($m, "$function()")),
                "$function() isn't reported as banned.",
            );
        }
    }
}
