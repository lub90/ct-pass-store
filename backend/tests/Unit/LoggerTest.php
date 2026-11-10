<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit;

use CtPassStore\Kernel;
use PHPUnit\Framework\TestCase;

/**
 * Catalog IJ-03 (spec 6.4): input that reaches the production log can't forge log lines.
 */
final class LoggerTest extends TestCase
{
    private string $file;

    protected function setUp(): void
    {
        $this->file = (string) tempnam(sys_get_temp_dir(), 'ctps-log-');
    }

    protected function tearDown(): void
    {
        @unlink($this->file);
    }

    public function testControlCharactersInMessagesAndContextAreEscaped(): void
    {
        $forged = "x\n[2026-11-01T00:00:00+00:00] ct-pass-store.ERROR: forged line";
        $logger = Kernel::logger($this->file, 'debug');

        $logger->warning('Unauthorized access attempt for ' . $forged, [
            'ip' => "203.0.113.7\r\nfake",
            'nested' => ['path' => "/v1/entries/1\x1b[31m\x00"],
            'id' => 5,
        ]);

        $content = (string) file_get_contents($this->file);
        $lines = explode("\n", rtrim($content, "\n"));
        self::assertCount(1, $lines, 'One log call, one line.');
        self::assertStringContainsString('x\x0A[2026-11-01', $content);
        // Context values are JSON-encoded in the line, so the escape's backslash appears doubled.
        self::assertStringContainsString('203.0.113.7\\\\x0D\\\\x0Afake', $content);
        self::assertStringContainsString('\\\\x1B[31m\\\\x00', $content);
        self::assertDoesNotMatchRegularExpression('/[\x00-\x09\x0B-\x1F\x7F]/', $content, 'No raw control characters at all.');
        self::assertStringContainsString('"id":5', $content, 'Non-strings stay as they are.');
    }

    public function testTheLevelIsRespected(): void
    {
        $logger = Kernel::logger($this->file, 'warning');

        $logger->info('not written');
        $logger->warning('written');

        $content = (string) file_get_contents($this->file);
        self::assertStringNotContainsString('not written', $content);
        self::assertStringContainsString('written', $content);
    }
}
