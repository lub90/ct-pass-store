<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Security;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Dependencies point inwards (plan 3.7): Domain knows only itself; Application knows Domain and its own ports;
 * Infrastructure and Http don't know each other. Only `src/Kernel.php` (the composition root) knows everything.
 */
final class ArchitectureTest extends TestCase
{
    private const SRC = __DIR__ . '/../../../src/';

    /**
     * The one pattern for references to other parts of src/: imports, fully qualified names in code and docblocks,
     * and the composition root `Kernel`, which has no namespace below it.
     *
     * @param list<string> $parts top-level parts of the namespace, e.g. `Http`, or `Kernel`
     */
    private static function pattern(array $parts): string
    {
        $alternatives = array_map(
            static fn(string $part): string => $part === 'Kernel' ? 'Kernel\b' : $part . '\\\\[A-Za-z]',
            $parts,
        );

        return '/\\\\?CtPassStore\\\\(?:' . implode('|', $alternatives) . ')[A-Za-z\\\\]*/';
    }

    /**
     * @return iterable<string, array{string, list<string>}>
     */
    public static function layers(): iterable
    {
        yield 'Domain' => ['Domain', ['Application', 'Infrastructure', 'Http', 'Config', 'Kernel']];
        yield 'Application' => ['Application', ['Infrastructure', 'Http', 'Config', 'Kernel']];
        yield 'Infrastructure' => ['Infrastructure', ['Http', 'Kernel']];
        yield 'Http' => ['Http', ['Infrastructure', 'Kernel']];
    }

    /**
     * @param list<string> $forbidden
     */
    #[DataProvider('layers')]
    public function testLayersDontDependOnForbiddenOnes(string $layer, array $forbidden): void
    {
        $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(self::SRC . $layer, \FilesystemIterator::SKIP_DOTS));
        $violations = [];
        $files = 0;
        foreach ($iterator as $file) {
            if (!$file instanceof \SplFileInfo || $file->getExtension() !== 'php') {
                continue;
            }
            $files++;
            $path = substr($file->getPathname(), strlen(self::SRC));
            preg_match_all(self::pattern($forbidden), (string) file_get_contents($file->getPathname()), $matches);
            foreach (array_unique($matches[0]) as $reference) {
                $reference = ltrim($reference, '\\');
                $violations[] = "$path → $reference";
            }
        }

        self::assertGreaterThan(0, $files, "No files found in src/$layer.");
        self::assertSame([], $violations, "$layer depends on a part it must not know.");
    }

    /**
     * The pattern used above must catch every form a reference takes, or the test could never fail.
     */
    public function testThePatternFindsEveryFormOfReference(): void
    {
        $pattern = self::pattern(['Infrastructure', 'Http', 'Config', 'Kernel']);
        $references = [
            'use CtPassStore\Infrastructure\Kv\KvSchema;',
            'new \CtPassStore\Http\Problem\ProblemException(',
            '@throws \CtPassStore\Config\BackendConfig',
            'use CtPassStore\Kernel;',
            '\CtPassStore\Kernel::create(',
        ];
        foreach ($references as $line) {
            self::assertSame(1, preg_match($pattern, $line), $line);
        }

        foreach (['use CtPassStore\Domain\PersonId;', 'use CtPassStore\Application\Login;', 'CtPassStore\KernelPanic'] as $line) {
            self::assertSame(0, preg_match($pattern, $line), $line);
        }
    }
}
