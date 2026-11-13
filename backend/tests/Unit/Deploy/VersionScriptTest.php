<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Deploy;

use CtPassStore\Tests\Support\PhpProcess;
use PHPUnit\Framework\TestCase;

/**
 * bin/version.php (spec 6.5, versioning.md): only a `backend-v<base>` tag makes the bare version; tags of the
 * extension or the old `v*` pattern on the same commit don't. Runs the script in a temporary git repository.
 */
final class VersionScriptTest extends TestCase
{
    private string $root;

    protected function setUp(): void
    {
        $this->root = sys_get_temp_dir() . '/ctps-version-' . bin2hex(random_bytes(6));
        mkdir($this->root . '/backend/bin', 0o700, true);
        mkdir($this->root . '/backend/vendor', 0o700);
        copy(dirname(__DIR__, 3) . '/bin/version.php', $this->root . '/backend/bin/version.php');
        file_put_contents($this->root . '/backend/vendor/autoload.php', "<?php require '" . dirname(__DIR__, 3) . "/vendor/autoload.php';\n");
        file_put_contents($this->root . '/backend/VERSION', "0.1.0\n");
        $this->git(['init', '-q']);
        $this->git(['add', '-A']);
        $this->git(['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'x']);
    }

    protected function tearDown(): void
    {
        $this->remove($this->root);
    }

    public function testBackendTagAlongsideExtensionTagGivesTheBareVersion(): void
    {
        $this->git(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'tag', '-a', '-m', 'x', 'extension-v0.1.0']);
        $this->git(['tag', 'backend-v0.1.0']);

        self::assertSame('0.1.0', $this->version());
    }

    public function testOnlyAnExtensionOrLegacyTagGivesTheShaVersion(): void
    {
        $this->git(['tag', 'extension-v0.1.0']);
        $this->git(['tag', 'v0.1.0']);

        self::assertMatchesRegularExpression('/^0\.1\.0\+[0-9a-f]{7}$/', $this->version());
    }

    private function version(): string
    {
        $result = PhpProcess::run([$this->root . '/backend/bin/version.php'], ['PATH' => (string) getenv('PATH')], $this->root . '/backend');
        self::assertSame(0, $result['exit'], $result['output']);

        return trim($result['output']);
    }

    /** @param list<string> $arguments */
    private function git(array $arguments): void
    {
        $process = proc_open(['git', ...$arguments], [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes, $this->root);
        self::assertIsResource($process);
        self::assertSame(0, proc_close($process));
    }

    private function remove(string $path): void
    {
        if (is_dir($path) && !is_link($path)) {
            foreach (scandir($path) ?: [] as $entry) {
                if ($entry !== '.' && $entry !== '..') {
                    $this->remove($path . '/' . $entry);
                }
            }
            @chmod($path, 0o700);
            rmdir($path);
        } elseif (file_exists($path) || is_link($path)) {
            unlink($path);
        }
    }
}
