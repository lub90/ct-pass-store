<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Cli;

use CtPassStore\Kernel;
use CtPassStore\Tests\Support\FakeChurchToolsClient;
use PHPUnit\Framework\TestCase;

/**
 * Catalog GP-20.
 */
final class KernelRunCleanupTest extends TestCase
{
    private string $folder;

    protected function setUp(): void
    {
        $this->folder = sys_get_temp_dir() . '/ctps-run-' . bin2hex(random_bytes(6));
        mkdir($this->folder . '/config', 0o700, true);
        file_put_contents($this->folder . '/config/credentials.php', "<?php\nreturn " . var_export([
            'CT_API_URL' => 'https://example.church.tools/api',
            'CT_API_TOKEN' => 'service-token',
            'CORS' => ['https://example.church.tools'],
            'OAUTH_CLIENT_ID' => 'client',
            'OAUTH_CLIENT_SECRET' => 'secret',
            'JWT_SECRET' => str_repeat('s', 40),
        ], true) . ";\n");
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

    public function testUnexpectedErrorExitsTwoAndLogsTheClassOnly(): void
    {
        $fake = new FakeChurchToolsClient();
        $fake->failNext('serviceUserGlobalPermissions', new \LogicException('secret-detail-with-a-name'));
        $out = fopen('php://memory', 'w+');
        $err = fopen('php://memory', 'w+');
        self::assertIsResource($out);
        self::assertIsResource($err);

        $exit = Kernel::runCleanup($this->folder . '/config/credentials.php', $this->folder . '/cache', $this->folder . '/logs/app.log', [], $fake, $out, $err);

        self::assertSame(2, $exit);
        rewind($err);
        self::assertSame("Aborted with an unexpected error; see the log.\n", stream_get_contents($err));
        $log = '';
        foreach (glob($this->folder . '/logs/*.log') ?: [] as $file) {
            $log .= (string) file_get_contents($file);
        }
        self::assertStringContainsString('Cleanup aborted with an unexpected error: LogicException', $log);
        self::assertStringNotContainsString('secret-detail-with-a-name', $log);
    }
}
