<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Api;

use CtPassStore\Http\Problem\ProblemType;
use PHPUnit\Framework\TestCase;

/**
 * Catalog ER-02 (spec 4.9): every problem type is produced by at least one API test. Fails as soon as a type is added
 * without a test that triggers it.
 *
 * It reads the API tests: a type counts as covered when a file that calls assertProblem() names it, directly or in a
 * data provider feeding assertProblem(). assertProblem() itself checks status, type URI and title.
 */
final class ProblemCoverageApiTest extends TestCase
{
    public function testEveryProblemTypeIsProducedByAnApiTest(): void
    {
        $mentioned = [];
        foreach (glob(__DIR__ . '/*ApiTest.php') ?: [] as $file) {
            if ($file === __FILE__) {
                continue;
            }
            $source = (string) file_get_contents($file);
            if (!str_contains($source, 'assertProblem(')) {
                continue;
            }
            preg_match_all('/ProblemType::([A-Za-z]+)\b/', $source, $matches);
            foreach ($matches[1] as $case) {
                $mentioned[$case] = true;
            }
        }

        $missing = [];
        foreach (ProblemType::cases() as $type) {
            if (!isset($mentioned[$type->name])) {
                $missing[] = $type->name;
            }
        }

        self::assertSame([], $missing, 'Problem types without an API test.');
    }
}
