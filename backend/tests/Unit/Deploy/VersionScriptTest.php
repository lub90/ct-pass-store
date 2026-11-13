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
        try {
            mkdir($this->root . '/home', 0o700, true);
            mkdir($this->root . '/backend/bin', 0o700, true);
            mkdir($this->root . '/backend/vendor', 0o700);
            copy(dirname(__DIR__, 3) . '/bin/version.php', $this->root . '/backend/bin/version.php');
            file_put_contents($this->root . '/backend/vendor/autoload.php', "<?php require '" . dirname(__DIR__, 3) . "/vendor/autoload.php';\n");
            file_put_contents($this->root . '/backend/VERSION', "0.1.0\n");
            $this->git(['init', '-q']);
            // Never act on another repository (a git hook or shell may export GIT_DIR and friends; the environment is explicit anyway).
            self::assertSame(realpath($this->root), realpath($this->git(['rev-parse', '--show-toplevel'])));
            $this->git(['add', '-A']);
            $this->git(['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'x']);
        } catch (\Throwable $e) {
            $this->remove($this->root);

            throw $e;
        }
    }

    protected function tearDown(): void
    {
        $this->remove($this->root);
    }

    public function testBackendTagAlongsideExtensionTagGivesTheBareVersion(): void
    {
        $this->git(['tag', '-a', '-m', 'x', 'extension-v0.1.0']);
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
        $result = PhpProcess::run([$this->root . '/backend/bin/version.php'], $this->environment(), $this->root . '/backend');
        self::assertSame(0, $result['exit'], $result['output']);

        return trim($result['output']);
    }

    /**
     * The complete environment for git and the script: no GIT_* repository variables, a HOME without user config.
     *
     * @return array<string, string>
     */
    private function environment(): array
    {
        return [
            'PATH' => (string) getenv('PATH'),
            'HOME' => $this->root . '/home',
            'GIT_CONFIG_NOSYSTEM' => '1',
            'GIT_AUTHOR_NAME' => 't',
            'GIT_AUTHOR_EMAIL' => 't@example.com',
            'GIT_COMMITTER_NAME' => 't',
            'GIT_COMMITTER_EMAIL' => 't@example.com',
        ];
    }

    /**
     * @param list<string> $arguments
     * @return string trimmed standard output
     */
    private function git(array $arguments): string
    {
        $process = proc_open(['git', ...$arguments], [1 => ['pipe', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes, $this->root, $this->environment());
        self::assertIsResource($process);
        $output = (string) stream_get_contents($pipes[1]);
        fclose($pipes[1]);
        self::assertSame(0, proc_close($process));

        return trim($output);
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
