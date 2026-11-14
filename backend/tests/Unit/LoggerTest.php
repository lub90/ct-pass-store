<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit;

use CtPassStore\Kernel;
use Monolog\Handler\RotatingFileHandler;
use Monolog\Logger;
use PHPUnit\Framework\TestCase;

/**
 * Catalog IJ-03, LG-04, LG-06, LG-07 (spec 6.4): the production logger.
 */
final class LoggerTest extends TestCase
{
    private string $dir;

    private string $file;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/ctps-log-' . bin2hex(random_bytes(6));
        mkdir($this->dir, 0o700);
        $this->file = $this->dir . '/app.log';
    }

    protected function tearDown(): void
    {
        foreach (glob($this->dir . '/*') ?: [] as $file) {
            @unlink($file);
        }
        @rmdir($this->dir);
    }

    /** The content of all log files in the folder. */
    private function content(): string
    {
        return implode('', array_map(static fn(string $f): string => (string) file_get_contents($f), glob($this->dir . '/app-*.log') ?: []));
    }

    public function testControlCharactersInMessagesAndContextAreEscaped(): void
    {
        $forged = "x\n[2026-11-01T00:00:00+00:00] ct-pass-store.ERROR: forged line";
        $logger = Kernel::logger($this->file, 'debug', '0.1.0');

        $logger->warning('Unauthorized access attempt for ' . $forged, [
            'ip' => "203.0.113.7\r\nfake",
            'nested' => ['path' => "/v1/entries/1\x1b[31m\x00"],
            'id' => 5,
        ]);

        $content = $this->content();
        $lines = explode("\n", rtrim($content, "\n"));
        self::assertCount(1, $lines, 'One log call, one line.');
        self::assertStringContainsString('x\x0A[2026-11-01', $content);
        // Context values are JSON-encoded in the line, so the escape's backslash appears doubled.
        self::assertStringContainsString('203.0.113.7\\\\x0D\\\\x0Afake', $content);
        self::assertStringContainsString('\\\\x1B[31m\\\\x00', $content);
        self::assertDoesNotMatchRegularExpression('/[\x00-\x09\x0B-\x1F\x7F]/', $content, 'No raw control characters at all.');
        self::assertStringContainsString('"id":5', $content, 'Non-strings stay as they are.');
    }

    /**
     * Unicode controls (C1, format characters such as the bidi override U+202E, the line and paragraph separators)
     * can reorder or break what a reader sees, e.g. in a logged backendUrl, so they're escaped too, as `\u{XXXX}`.
     */
    public function testUnicodeControlsInMessagesAndContextAreEscaped(): void
    {
        $logger = Kernel::logger($this->file, 'debug', '0.1.0');

        $logger->notice("The backend address changed to https://evil.example/\u{202E}gro.elpmaxe\u{2028}[2026-11-01] forged\u{2029}\u{200B}\u{0085}.", [
            'url' => "https://a.example/\u{202E}x\u{2028}y",
            'name' => 'Grüße, ok', // ordinary non-ASCII stays as it is
        ]);

        $content = $this->content();
        self::assertCount(1, explode("\n", rtrim($content, "\n")));
        self::assertStringContainsString('evil.example/\u{202E}gro.elpmaxe\u{2028}[2026-11-01] forged\u{2029}\u{200B}\u{0085}.', $content);
        self::assertStringContainsString('a.example/\\\\u{202E}x\\\\u{2028}y', $content);
        self::assertStringContainsString('Grüße', $content);
        self::assertDoesNotMatchRegularExpression('/[\x{80}-\x{9F}\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2028}\x{2029}\x{2066}-\x{2069}]/u', $content);
    }

    /** Invalid UTF-8 can't be matched as Unicode; its ASCII controls are still escaped and nothing is lost. */
    public function testInvalidUtf8StillHasItsControlsEscaped(): void
    {
        $logger = Kernel::logger($this->file, 'debug', '0.1.0');

        $logger->warning("bad \xFF\xFE bytes\nforged");

        $content = $this->content();
        self::assertCount(1, explode("\n", rtrim($content, "\n")));
        self::assertStringContainsString('bytes\x0Aforged', $content);
    }

    /**
     * One stray byte makes a string invalid UTF-8, which switches the Unicode match off; the byte sequences of C1
     * controls, the line and paragraph separators and the bidi controls are then escaped byte-wise.
     */
    public function testInvalidUtf8StillHasItsUnicodeControlsEscaped(): void
    {
        $logger = Kernel::logger($this->file, 'debug', '0.1.0');

        $logger->warning("stray \xFF https://evil.example/\u{202E}gro\u{2028}[2026] forged\u{2029}\u{0085}\u{2066}x\u{2069}\u{202A}", [
            'url' => "\xFF\u{202E}y",
        ]);

        $content = $this->content();
        self::assertCount(1, explode("\n", rtrim($content, "\n")));
        foreach (["\u{202E}", "\u{2028}", "\u{2029}", "\u{0085}", "\u{2066}", "\u{2069}", "\u{202A}"] as $control) {
            self::assertStringNotContainsString($control, $content, bin2hex($control));
        }
        self::assertStringContainsString('evil.example/\xE2\x80\xAEgro\xE2\x80\xA8[2026] forged\xE2\x80\xA9\xC2\x85\xE2\x81\xA6x\xE2\x81\xA9\xE2\x80\xAA', $content);
    }

    /** LG-04 */
    public function testTheLevelIsRespected(): void
    {
        $logger = Kernel::logger($this->file, 'warning', '0.1.0');

        $logger->info('not written');
        $logger->warning('written');

        $content = $this->content();
        self::assertStringNotContainsString('not written', $content);
        self::assertStringContainsString('written', $content);
    }

    /** LG-06 */
    public function testTheLoggerRotatesDailyAndKeeps14Files(): void
    {
        $handlers = Kernel::logger($this->file, 'info', '0.1.0')->getHandlers();

        self::assertCount(1, $handlers);
        self::assertInstanceOf(RotatingFileHandler::class, $handlers[0]);
        self::assertSame(14, (new \ReflectionProperty(RotatingFileHandler::class, 'maxFiles'))->getValue($handlers[0]));
        self::assertSame('Y-m-d', (new \ReflectionProperty(RotatingFileHandler::class, 'dateFormat'))->getValue($handlers[0]));
    }

    /** LG-06: the first write of a new day creates `app-YYYY-MM-DD.log` and deletes all but the newest 14 files. */
    public function testOlderFilesBeyondFourteenAreDeletedOnRotation(): void
    {
        for ($day = 1; $day <= 15; ++$day) {
            touch(sprintf('%s/app-2020-01-%02d.log', $this->dir, $day));
        }

        Kernel::logger($this->file, 'info', '0.1.0')->info('first write of the day');

        $files = array_map('basename', glob($this->dir . '/app-*.log') ?: []);
        sort($files);
        self::assertCount(14, $files);
        self::assertContains('app-' . date('Y-m-d') . '.log', $files);
        self::assertNotContains('app-2020-01-01.log', $files);
        self::assertNotContains('app-2020-01-02.log', $files);
        self::assertContains('app-2020-01-03.log', $files);
    }

    /** LG-07 */
    public function testErrorsCarryTheVersionAndLowerLevelsDont(): void
    {
        $logger = Kernel::logger($this->file, 'debug', '0.1.0+abc1234');

        $logger->info('an info');
        $logger->warning('a warning');
        $logger->error('an error');
        $logger->critical('a critical');

        $lines = explode("\n", trim($this->content()));
        self::assertCount(4, $lines);
        self::assertStringNotContainsString('0.1.0+abc1234', $lines[0]);
        self::assertStringNotContainsString('0.1.0+abc1234', $lines[1]);
        self::assertStringContainsString('"version":"0.1.0+abc1234"', $lines[2]);
        self::assertStringContainsString('"version":"0.1.0+abc1234"', $lines[3]);
    }

    /** LG-07: the version string is context like any other value, so it is escaped too (Version::base() is unvalidated). */
    public function testAVersionWithControlCharactersCantForgeLines(): void
    {
        $logger = Kernel::logger($this->file, 'debug', "0.1.0\n[2026-11-01T00:00:00+00:00] ct-pass-store.ERROR: forged");

        $logger->error('an error');

        $content = $this->content();
        self::assertCount(1, explode("\n", rtrim($content, "\n")));
        self::assertStringContainsString('0.1.0\\\\x0A[2026', $content);
    }

    /** Person IDs and addresses stay private: new log files are 0600 and a new logs folder 0700 (spec 6.3, 6.4). */
    public function testLogFilesAndANewFolderArePrivate(): void
    {
        if (function_exists('posix_geteuid') && posix_geteuid() === 0) {
            self::markTestSkipped('Modes are not enforced for root.');
        }
        $logs = $this->dir . '/logs';

        Kernel::logger($logs . '/app.log', 'info', '0.1.0+test')->info('x');

        $files = glob($logs . '/app-*.log') ?: [];
        self::assertCount(1, $files);
        self::assertSame(0o600, fileperms($files[0]) & 0o777);
        self::assertSame(0o700, fileperms($logs) & 0o777);
        foreach ($files as $f) {
            unlink($f);
        }
        rmdir($logs);
    }

    public function testTheLoggerIsALogger(): void
    {
        self::assertInstanceOf(Logger::class, Kernel::logger($this->file, 'info', '0.1.0'));
    }
}
