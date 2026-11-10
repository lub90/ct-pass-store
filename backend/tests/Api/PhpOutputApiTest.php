<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Api;

use CtPassStore\Tests\Support\PhpProcess;
use PHPUnit\Framework\TestCase;

/**
 * Catalog ER-08 (spec 4.1): PHP warnings never reach a response body, even if the host's php.ini shows them; they go
 * to the error log. Runs the real public/index.php in a fresh PHP with display_errors=1.
 */
final class PhpOutputApiTest extends TestCase
{
    private string $root;

    protected function setUp(): void
    {
        // A copy of the deploy layout: public/index.php, vendor, and a config whose loading raises a warning.
        $this->root = sys_get_temp_dir() . '/ctps-php-' . bin2hex(random_bytes(6));
        mkdir($this->root . '/public', 0o700, true);
        mkdir($this->root . '/config', 0o700);
        copy(__DIR__ . '/../../public/index.php', $this->root . '/public/index.php');
        symlink(realpath(__DIR__ . '/../../vendor'), $this->root . '/vendor');
        file_put_contents($this->root . '/config/credentials.php', "<?php\n\$none = [];\n\$unused = \$none['warning-trigger'];\nreturn 'not an array';\n");
    }

    protected function tearDown(): void
    {
        @unlink($this->root . '/public/index.php');
        @unlink($this->root . '/config/credentials.php');
        @unlink($this->root . '/vendor');
        @unlink($this->root . '/php-errors.log');
        @rmdir($this->root . '/public');
        @rmdir($this->root . '/config');
        @rmdir($this->root);
    }

    public function testWarningsGoToTheLogNotIntoTheResponse(): void
    {
        $log = $this->root . '/php-errors.log';

        $result = PhpProcess::run(
            ['-d', 'display_errors=1', '-d', 'display_startup_errors=1', '-d', 'error_reporting=-1', '-d', 'log_errors=1', '-d', 'error_log=' . $log, $this->root . '/public/index.php'],
            ['REQUEST_METHOD' => 'GET', 'REQUEST_URI' => '/v1/entries/1', 'HTTPS' => 'on', 'PATH' => (string) getenv('PATH')],
            $this->root,
        );

        self::assertStringStartsWith('{', $result['output'], 'Nothing but the problem details may be sent.');
        $body = json_decode($result['output'], true);
        self::assertIsArray($body, $result['output']);
        self::assertStringEndsWith('#misconfigured', (string) $body['type']);
        self::assertStringNotContainsString('Warning', $result['output']);
        self::assertStringNotContainsString('warning-trigger', $result['output']);
        self::assertStringContainsString('warning-trigger', (string) @file_get_contents($log), 'The warning went to the log.');
    }
}
