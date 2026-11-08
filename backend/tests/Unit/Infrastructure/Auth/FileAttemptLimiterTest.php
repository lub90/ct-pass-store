<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Infrastructure\Auth;

use CtPassStore\Domain\PersonId;
use CtPassStore\Infrastructure\Auth\FileAttemptLimiter;
use CtPassStore\Infrastructure\Store\SignedFileStore;
use CtPassStore\Tests\Support\FrozenClock;
use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;

/**
 * Catalog RX-05 for the attempt counters: they stay bounded.
 */
final class FileAttemptLimiterTest extends TestCase
{
    private string $dir;
    private FrozenClock $clock;
    private FileAttemptLimiter $limiter;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/ctps-limit-' . bin2hex(random_bytes(6));
        $this->clock = new FrozenClock();
        $this->limiter = new FileAttemptLimiter(new SignedFileStore($this->dir, str_repeat('s', 40), new NullLogger()), $this->clock);
    }

    protected function tearDown(): void
    {
        foreach (glob($this->dir . '/*') ?: [] as $file) {
            @unlink($file);
        }
        @rmdir($this->dir);
    }

    private function storedAttempts(): int
    {
        $files = glob($this->dir . '/*.json') ?: [];
        self::assertCount(1, $files);
        $file = json_decode((string) file_get_contents($files[0]), true);
        self::assertIsArray($file);
        $data = json_decode((string) $file['data'], true);
        self::assertIsArray($data);

        return count(is_array($data['attempts'] ?? null) ? $data['attempts'] : []);
    }

    public function testAttemptsOlderThanTheWindowAreRemoved(): void
    {
        $person = new PersonId(5);
        for ($i = 0; $i < 4; $i++) {
            $this->limiter->begin($person);
        }
        self::assertSame(4, $this->storedAttempts());

        $this->clock->advance(FileAttemptLimiter::WINDOW_SECONDS);
        $this->limiter->begin($person);

        self::assertSame(1, $this->storedAttempts());
    }

    public function testAResetLeavesAnEmptyRecord(): void
    {
        $person = new PersonId(5);
        $this->limiter->begin($person);
        $this->limiter->succeed($person);

        self::assertSame(0, $this->storedAttempts());
    }

    public function testRecordsExistOnlyForPeopleWhoTriedAPrimaryPassword(): void
    {
        // Only authenticated persons reach the limiter, so the number of files is bounded by the number of users.
        $this->limiter->begin(new PersonId(5));
        $this->limiter->begin(new PersonId(6));

        self::assertCount(2, glob($this->dir . '/*.json') ?: []);
    }
}
