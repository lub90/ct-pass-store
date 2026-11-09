<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Security;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Dependencies point inwards (plan 3.7): Domain knows only itself; Application knows Domain and its own ports, never
 * Infrastructure, Http or Config. Only `src/Application.php` (the composition root) knows everything.
 */
final class ArchitectureTest extends TestCase
{
    private const SRC = __DIR__ . '/../../../src/';

    /**
     * @return iterable<string, array{string, list<string>}>
     */
    public static function layers(): iterable
    {
        yield 'Domain' => ['Domain', ['Application', 'Infrastructure', 'Http', 'Config']];
        yield 'Application' => ['Application', ['Infrastructure', 'Http', 'Config']];
    }

    /**
     * @param list<string> $forbidden
     */
    #[DataProvider('layers')]
    public function testLayersDontDependOnOuterOnes(string $layer, array $forbidden): void
    {
        $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(self::SRC . $layer, \FilesystemIterator::SKIP_DOTS));
        $violations = [];
        $files = 0;
        foreach ($iterator as $file) {
            if (!$file instanceof \SplFileInfo || $file->getExtension() !== 'php') {
                continue;
            }
            $files++;
            $source = (string) file_get_contents($file->getPathname());
            foreach ($forbidden as $outer) {
                // Imports as well as fully qualified names in code and docblocks.
                if (preg_match_all('/\\\\?CtPassStore\\\\' . $outer . '\\\\[A-Za-z\\\\]+/', $source, $matches) > 0) {
                    foreach (array_unique($matches[0]) as $reference) {
                        $violations[] = substr($file->getPathname(), strlen(self::SRC)) . ' → ' . ltrim($reference, '\\');
                    }
                }
            }
        }

        self::assertGreaterThan(0, $files, "No files found in src/$layer.");
        self::assertSame([], $violations, "$layer depends on an outer layer.");
    }

    public function testTheCheckFindsViolations(): void
    {
        // The pattern must match the forms code uses, or the test above could never fail.
        foreach (['use CtPassStore\\Infrastructure\\Kv\\KvSchema;', 'new \\CtPassStore\\Http\\Problem\\ProblemException(', '@throws \\CtPassStore\\Config\\BackendConfig'] as $line) {
            self::assertSame(1, preg_match('/\\\\?CtPassStore\\\\(Infrastructure|Http|Config)\\\\[A-Za-z\\\\]+/', $line), $line);
        }
    }
}
