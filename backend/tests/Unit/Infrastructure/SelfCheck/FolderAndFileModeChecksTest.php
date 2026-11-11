<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Infrastructure\SelfCheck;

use CtPassStore\Infrastructure\SelfCheck\CacheFolderCheck;
use CtPassStore\Infrastructure\SelfCheck\CredentialsFileCheck;
use CtPassStore\Infrastructure\Store\SignedFileStore;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;

/**
 * Spec 3.1 and 6.1: the modes the self-test accepts for `cache/` and `config/credentials.php`.
 */
final class FolderAndFileModeChecksTest extends TestCase
{
    private string $dir;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/ctps-modes-' . bin2hex(random_bytes(6));
        mkdir($this->dir, 0o700);
    }

    protected function tearDown(): void
    {
        foreach (glob($this->dir . '/cache/*') ?: [] as $f) {
            @unlink($f);
        }
        @unlink($this->dir . '/credentials.php');
        @rmdir($this->dir . '/cache');
        @rmdir($this->dir);
    }

    /**
     * @return iterable<string, array{int, bool}>
     */
    public static function cacheModes(): iterable
    {
        yield '0700' => [0o700, true];
        yield '0770 group variant' => [0o770, true];
        yield '0707' => [0o707, false];
        yield '0702' => [0o702, false];
        yield '0701' => [0o701, false];
    }

    #[DataProvider('cacheModes')]
    public function testCacheFolderModes(int $mode, bool $passes): void
    {
        $cache = $this->dir . '/cache';
        $check = new CacheFolderCheck($cache, new SignedFileStore($cache, str_repeat('s', 40), new NullLogger()));
        $check->run();
        chmod($cache, $mode);

        $outcome = $check->run();

        self::assertSame($passes, $outcome->ok, $outcome->message);
        if (!$passes) {
            self::assertStringContainsString('0770', $outcome->message);
            self::assertStringContainsString('0700', $outcome->message);
        }
    }

    /**
     * @return iterable<string, array{int, bool}>
     */
    public static function credentialsModes(): iterable
    {
        yield '0600' => [0o600, true];
        yield '0640' => [0o640, true];
        yield '0660' => [0o660, false];
        yield '0670' => [0o670, false];
        yield '0604' => [0o604, false];
    }

    #[DataProvider('credentialsModes')]
    public function testCredentialsFileModes(int $mode, bool $passes): void
    {
        $path = $this->dir . '/credentials.php';
        file_put_contents($path, "<?php\nreturn [];\n");
        chmod($path, $mode);

        $outcome = (new CredentialsFileCheck($path))->run();

        self::assertSame($passes, $outcome->ok, $outcome->message);
    }
}
