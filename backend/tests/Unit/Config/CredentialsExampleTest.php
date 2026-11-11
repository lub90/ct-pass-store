<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Config;

use CtPassStore\Config\BackendConfig;
use CtPassStore\Tests\Support\PhpProcess;
use PHPUnit\Framework\TestCase;

/**
 * `config/credentials-example.php` is what setup.sh tells the admin to copy: it must list every key BackendConfig reads.
 */
final class CredentialsExampleTest extends TestCase
{
    private const EXAMPLE = __DIR__ . '/../../../config/credentials-example.php';

    public function testTheExampleWithPlaceholdersReplacedIsAValidConfiguration(): void
    {
        $example = require self::EXAMPLE;
        self::assertIsArray($example);
        foreach (['CT_API_URL', 'CT_API_TOKEN', 'CORS', 'OAUTH_CLIENT_ID', 'OAUTH_CLIENT_SECRET', 'JWT_SECRET'] as $key) {
            self::assertArrayHasKey($key, $example);
        }
        self::assertArrayNotHasKey('LOG_LEVEL', $example, 'LOG_LEVEL is optional and only a comment.');
        self::assertStringContainsString('random_bytes(32)', (string) file_get_contents(self::EXAMPLE));
        self::assertStringContainsString('LOG_LEVEL', (string) file_get_contents(self::EXAMPLE));

        $example['CT_API_URL'] = 'https://example.church.tools/api';
        $example['CORS'] = ['https://example.church.tools'];
        $example['JWT_SECRET'] = bin2hex(random_bytes(32));
        $config = BackendConfig::fromArray($example, '/x/config/credentials.php', sys_get_temp_dir());

        self::assertInstanceOf(BackendConfig::class, $config);
    }

    public function testTheExampleStillPassesTheDeployCheck(): void
    {
        $folder = sys_get_temp_dir() . '/ctps-example-' . bin2hex(random_bytes(6));
        foreach (['public', 'src', 'vendor', 'config'] as $d) {
            mkdir("$folder/$d", 0o700, true);
        }
        file_put_contents("$folder/public/index.php", "<?php\n");
        file_put_contents("$folder/src/Kernel.php", "<?php\n");
        file_put_contents("$folder/vendor/autoload.php", "<?php\n");
        file_put_contents("$folder/version.txt", "0.1.0\n");
        copy(self::EXAMPLE, "$folder/config/credentials-example.php");

        $result = PhpProcess::run([dirname(__DIR__, 3) . '/bin/check-deploy.php', $folder], [], dirname(__DIR__, 3));

        foreach (['public/index.php', 'src/Kernel.php', 'vendor/autoload.php', 'version.txt', 'config/credentials-example.php'] as $f) {
            @unlink("$folder/$f");
        }
        foreach (['public', 'src', 'vendor', 'config'] as $d) {
            @rmdir("$folder/$d");
        }
        @rmdir($folder);
        self::assertSame(0, $result['exit'], $result['output']);
    }
}
