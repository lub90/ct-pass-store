<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Infrastructure\Auth;

use CtPassStore\Infrastructure\Auth\FileMachineClientUsage;
use CtPassStore\Infrastructure\Store\SignedFileStore;
use CtPassStore\Tests\Support\FrozenClock;
use Monolog\Handler\TestHandler;
use Monolog\Logger;
use PHPUnit\Framework\TestCase;

/**
 * Point-B audit trail: a rate-limited usage summary per machine client, the first request of each hour (backend spec
 * 6.4), with bounded state.
 */
final class FileMachineClientUsageTest extends TestCase
{
    private const SECRET = 'machine-client-usage-test-secret-32-bytes';

    private string $dir;

    private FrozenClock $clock;

    private TestHandler $log;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/ctps-usage-' . bin2hex(random_bytes(6));
        $this->clock = new FrozenClock('2026-11-01T12:00:00Z');
        $this->log = new TestHandler();
    }

    protected function tearDown(): void
    {
        foreach (glob($this->dir . '/*') ?: [] as $file) {
            @unlink($file);
        }
        @chmod($this->dir, 0o700);
        @rmdir($this->dir);
    }

    /** A new instance per call, like a new request. */
    private function use(string $client, string $ip): void
    {
        $logger = new Logger('test', [$this->log]);
        (new FileMachineClientUsage(new SignedFileStore($this->dir, self::SECRET, $logger), $this->clock, $logger))->record($client, $ip);
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function summaries(): array
    {
        return array_values(array_filter($this->log->getRecords(), static fn(array $r): bool => $r['level'] === Logger::INFO));
    }

    public function testTheFirstRequestEverIsLoggedWithClientAndAddress(): void
    {
        $this->use('ct-radius', '203.0.113.7');

        $summaries = $this->summaries();
        self::assertCount(1, $summaries);
        self::assertSame('Machine client ct-radius is in use; first request seen.', $summaries[0]['message']);
        self::assertSame(['ip' => '203.0.113.7'], $summaries[0]['context']);
    }

    public function testFurtherRequestsWithinTheHourAreCountedNotLogged(): void
    {
        for ($i = 0; $i < 5; $i++) {
            $this->use('ct-radius', '203.0.113.7');
            $this->clock->advance(60);
        }

        self::assertCount(1, $this->summaries());
    }

    public function testTheFirstRequestOfANewHourSummarizesTheRequestsSinceTheLastSummary(): void
    {
        $this->use('ct-radius', '203.0.113.7');
        $this->clock->advance(1800);
        $this->use('ct-radius', '198.51.100.2');
        $this->use('ct-radius', '203.0.113.7');
        $this->clock->advance(1799);
        $this->use('ct-radius', '203.0.113.7');
        self::assertCount(1, $this->summaries(), 'still the same hour');

        $this->clock->advance(1);
        $this->use('ct-radius', '192.0.2.1');

        $summaries = $this->summaries();
        self::assertCount(2, $summaries);
        self::assertSame('Machine client ct-radius is in use; 4 requests from 2 addresses since the last summary at 2026-11-01T12:00:00+00:00.', $summaries[1]['message']);
        self::assertSame(['ip' => '192.0.2.1', 'addresses' => ['203.0.113.7', '198.51.100.2']], $summaries[1]['context']);

        // The new hour counts from that request on.
        $this->clock->advance(3600);
        $this->use('ct-radius', '192.0.2.1');
        self::assertSame('Machine client ct-radius is in use; 1 request from 1 address since the last summary at 2026-11-01T13:00:00+00:00.', $this->summaries()[2]['message']);
    }

    public function testClientsAreCountedSeparately(): void
    {
        $this->use('ct-radius', '203.0.113.7');
        $this->use('backup-reader', '203.0.113.7');
        $this->use('ct-radius', '203.0.113.7');

        self::assertSame(['ct-radius', 'backup-reader'], array_map(static fn(array $r): string => explode(' ', $r['message'])[2], $this->summaries()));
    }

    public function testTheAddressesKeptPerHourAreBounded(): void
    {
        $this->use('ct-radius', '192.0.2.0');
        for ($i = 1; $i < 30; $i++) {
            $this->use('ct-radius', "192.0.2.$i");
        }
        self::assertLessThan(2048, max(array_map('filesize', glob($this->dir . '/*.json') ?: [0])));
        $this->clock->advance(3600);
        $this->use('ct-radius', '203.0.113.7');

        $last = $this->summaries()[1];
        self::assertSame('Machine client ct-radius is in use; 30 requests from more than ' . FileMachineClientUsage::MAX_ADDRESSES . ' addresses since the last summary at 2026-11-01T12:00:00+00:00.', $last['message']);
        self::assertCount(FileMachineClientUsage::MAX_ADDRESSES, $last['context']['addresses']);
    }

    public function testAClockThatWentBackStartsANewHour(): void
    {
        $this->use('ct-radius', '203.0.113.7');
        $this->clock->advance(-7200);
        $this->use('ct-radius', '203.0.113.7');

        self::assertCount(2, $this->summaries());
    }

    public function testAnUnusableFolderIsAWarningAndTheRequestGoesOn(): void
    {
        mkdir($this->dir, 0o500);

        $this->use('ct-radius', '203.0.113.7');

        self::assertSame([], $this->summaries());
        self::assertCount(1, array_filter($this->log->getRecords(), static fn(array $r): bool => $r['level'] === Logger::WARNING));
    }
}
