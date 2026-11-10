<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit;

use CtPassStore\Tests\Support\PhpProcess;
use PHPUnit\Framework\TestCase;

/**
 * Catalog CT-07 (spec 6.6): the contract suite without its configuration aborts with a message naming what's missing
 * and a non-zero exit code. It's never reported as passed.
 */
final class ContractSuiteTest extends TestCase
{
    public function testWithoutConfigurationTheSuiteFailsAndSaysWhatsMissing(): void
    {
        $backend = (string) realpath(__DIR__ . '/../..');

        // The shared phpunit.xml.dist has no ChurchTools settings, and the environment has none either.
        $result = PhpProcess::run(
            ['vendor/bin/phpunit', '-c', 'phpunit.xml.dist', '--testsuite', 'Contract', '--filter', 'ChurchToolsClientContractTest', '--no-progress'],
            ['PATH' => (string) getenv('PATH')],
            $backend,
        );

        self::assertNotSame(0, $result['exit'], $result['output']);
        self::assertStringContainsString('Missing:', $result['output']);
        self::assertStringContainsString('CT_API_URL', $result['output']);
        self::assertStringNotContainsString('OK (', $result['output']);
    }
}
