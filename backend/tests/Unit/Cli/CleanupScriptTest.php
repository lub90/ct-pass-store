<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Cli;

use CtPassStore\Tests\Support\PhpProcess;
use PHPUnit\Framework\TestCase;

/**
 * Catalog GP-19.
 */
final class CleanupScriptTest extends TestCase
{
    private const BACKEND = __DIR__ . '/../../..';

    private string $folder;

    protected function setUp(): void
    {
        // A deploy-like layout, so the tests don't depend on a credentials.php in the developer's folder.
        $this->folder = sys_get_temp_dir() . '/ctps-script-' . bin2hex(random_bytes(6));
        mkdir($this->folder . '/bin', 0o700, true);
        copy(self::BACKEND . '/bin/cleanup.php', $this->folder . '/bin/cleanup.php');
        symlink(self::BACKEND . '/vendor', $this->folder . '/vendor');
    }

    protected function tearDown(): void
    {
        $this->remove($this->folder);
    }

    private function remove(string $path): void
    {
        if (is_link($path) || is_file($path)) {
            unlink($path);

            return;
        }
        foreach (scandir($path) ?: [] as $name) {
            if ($name !== '.' && $name !== '..') {
                $this->remove($path . '/' . $name);
            }
        }
        rmdir($path);
    }

    public function testMissingCredentialsExitTwo(): void
    {
        $result = PhpProcess::run([$this->folder . '/bin/cleanup.php'], [], $this->folder);

        self::assertSame(2, $result['exit']);
        self::assertStringContainsString('Configuration error: config/credentials.php is missing or not readable by PHP.', $result['output']);
    }

    public function testUnknownArgumentExitsTwoWithUsage(): void
    {
        mkdir($this->folder . '/config');
        file_put_contents($this->folder . '/config/credentials.php', "<?php\nreturn " . var_export([
            'CT_API_URL' => 'https://example.church.tools/api',
            'CT_API_TOKEN' => 'service-token',
            'CORS' => ['https://example.church.tools'],
            'OAUTH_CLIENT_ID' => 'client',
            'OAUTH_CLIENT_SECRET' => 'secret',
            'JWT_SECRET' => str_repeat('s', 40),
        ], true) . ";\n");

        $result = PhpProcess::run([$this->folder . '/bin/cleanup.php', '--force'], [], $this->folder);

        self::assertSame(2, $result['exit']);
        self::assertStringContainsString('Usage: php bin/cleanup.php [--apply]', $result['output']);
    }

    public function testHtaccessDeniesInternals(): void
    {
        $lines = file(self::BACKEND . '/.htaccess', FILE_IGNORE_NEW_LINES) ?: [];
        $deny = [];
        $catchAll = null;
        foreach ($lines as $number => $line) {
            if (preg_match('/^RewriteRule (\S+) - \[F,L\]$/', $line, $m) === 1) {
                $deny[] = '~' . $m[1] . '~';
            }
            if (str_starts_with($line, 'RewriteRule (.*) public/$1')) {
                $catchAll = $number;
            }
        }
        self::assertCount(2, $deny, 'Deny rules not found.');
        self::assertNotNull($catchAll, 'Catch-all rule not found.');
        foreach ($lines as $number => $line) {
            if (str_ends_with($line, '- [F,L]')) {
                self::assertLessThan($catchAll, $number, 'The deny rules must come before the catch-all rewrite.');
            }
        }
        $denied = static function (string $path) use ($deny): bool {
            foreach ($deny as $pattern) {
                if (preg_match($pattern, $path) === 1) {
                    return true;
                }
            }

            return false;
        };

        foreach (['bin', 'bin/cleanup.php', 'cache/cleanup.lock', 'setup/setup.sh', 'vendor/autoload.php', 'src/Kernel.php', 'config/credentials.php', 'logs/app.log', '.env'] as $path) {
            self::assertTrue($denied($path), "$path isn't denied.");
        }
        foreach (['binary/x', 'cachefoo', 'setupX', 'public/index.php', 'v1/test'] as $path) {
            self::assertFalse($denied($path), "$path is denied.");
        }
    }
}
