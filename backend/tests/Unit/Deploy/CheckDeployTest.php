<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Deploy;

use CtPassStore\Tests\Support\PhpProcess;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Catalog DP-01 (spec 6.6): `bin/check-deploy.php` fails on a deploy folder with a real credentials.php, dev files,
 * an instance URL or something that looks like a login token, or with a missing part of the expected layout.
 */
final class CheckDeployTest extends TestCase
{
    private string $folder;

    protected function setUp(): void
    {
        $this->folder = sys_get_temp_dir() . '/ctps-deploy-' . bin2hex(random_bytes(6));
        $this->write('public/index.php', "<?php\n// example.church.tools is a placeholder\n");
        $this->write('src/Kernel.php', "<?php\n");
        $this->write('vendor/autoload.php', "<?php\n");
        $this->write('vendor/some/lib/Lib.php', "<?php\n// https://docs.church.tools/ is fine in a dependency\n");
        $this->write('version.txt', "0.1.0\n");
        $this->write('config/credentials-example.php', "<?php\nreturn ['CT_API_URL' => 'https://your.church.tools/api', 'CORS' => ['https://your.church.tools']];\n");
    }

    protected function tearDown(): void
    {
        $this->remove($this->folder);
    }

    public function testACleanFolderPasses(): void
    {
        $result = $this->check();

        self::assertSame(0, $result['exit'], $result['output']);
    }

    /**
     * @return iterable<string, array{string, string, string}>
     */
    public static function forbiddenItems(): iterable
    {
        yield 'real credentials.php' => ['config/credentials.php', "<?php\nreturn [];\n", 'config/credentials.php'];
        yield 'phpunit.xml' => ['phpunit.xml', '<phpunit/>', 'phpunit.xml'];
        yield 'phpunit.xml.dist' => ['phpunit.xml.dist', '<phpunit/>', 'phpunit.xml.dist'];
        yield 'tests folder' => ['tests/Unit/FooTest.php', "<?php\n", 'tests'];
        yield '.git folder' => ['.git/HEAD', 'ref: refs/heads/main', '.git'];
        yield 'phpunit in vendor' => ['vendor/phpunit/phpunit/composer.json', '{}', 'vendor/phpunit'];
        yield 'phpstan in vendor' => ['vendor/phpstan/phpstan/composer.json', '{}', 'vendor/phpstan'];
        yield 'friendsofphp in vendor' => ['vendor/friendsofphp/php-cs-fixer/composer.json', '{}', 'vendor/friendsofphp'];
        yield 'instance URL' => ['src/Settings.php', "<?php\n// https://jeremia.church.tools/api\n", 'src/Settings.php'];
        yield 'instance URL in a hidden file' => ['.htaccess', "# jeremia.church.tools\n", '.htaccess'];
        yield 'login token' => ['config/notes.txt', str_repeat('aB3', 40), 'config/notes.txt'];
    }

    #[DataProvider('forbiddenItems')]
    public function testEachForbiddenItemFailsWithItsLine(string $path, string $content, string $named): void
    {
        $this->write($path, $content);

        $result = $this->check();

        self::assertSame(1, $result['exit'], $result['output']);
        self::assertStringContainsString($named, $result['output']);
        self::assertStringNotContainsString(str_repeat('aB3', 40), $result['output'], 'the output must not echo a token');
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function requiredItems(): iterable
    {
        yield 'public/index.php' => ['public/index.php'];
        yield 'src' => ['src'];
        yield 'vendor/autoload.php' => ['vendor/autoload.php'];
        yield 'version.txt' => ['version.txt'];
    }

    #[DataProvider('requiredItems')]
    public function testAMissingRequiredItemFails(string $item): void
    {
        $this->remove($this->folder . '/' . $item);

        $result = $this->check();

        self::assertSame(1, $result['exit'], $result['output']);
        self::assertStringContainsString($item, $result['output']);
    }

    public function testVendorMayContainLongStringsAndInstanceNames(): void
    {
        $this->write('vendor/some/lib/data.json', str_repeat('x', 300) . ' church.tools');

        self::assertSame(0, $this->check()['exit']);
    }

    public function testAMissingFolderArgumentFails(): void
    {
        $result = PhpProcess::run([dirname(__DIR__, 3) . '/bin/check-deploy.php'], [], dirname(__DIR__, 3));

        self::assertSame(1, $result['exit']);
    }

    /**
     * @return array{exit: int, output: string}
     */
    private function check(): array
    {
        return PhpProcess::run([dirname(__DIR__, 3) . '/bin/check-deploy.php', $this->folder], [], dirname(__DIR__, 3));
    }

    private function write(string $relative, string $content): void
    {
        $path = $this->folder . '/' . $relative;
        if (!is_dir(dirname($path))) {
            mkdir(dirname($path), 0o700, true);
        }
        file_put_contents($path, $content);
    }

    private function remove(string $path): void
    {
        if (is_dir($path) && !is_link($path)) {
            foreach (scandir($path) ?: [] as $entry) {
                if ($entry !== '.' && $entry !== '..') {
                    $this->remove($path . '/' . $entry);
                }
            }
            rmdir($path);
        } elseif (file_exists($path) || is_link($path)) {
            unlink($path);
        }
    }
}
