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
 * 6.4), with bounded state that keeps no address longer than the log does (14 days).
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
        @chmod($this->dir, 0o700);
        foreach (glob($this->dir . '/*') ?: [] as $file) {
            is_dir($file) ? @rmdir($file) : @unlink($file);
        }
        @rmdir($this->dir);
    }

    private function usage(): FileMachineClientUsage
    {
        $logger = new Logger('test', [$this->log]);

        return new FileMachineClientUsage(new SignedFileStore($this->dir, self::SECRET, $logger), $this->clock, $logger);
    }

    /** A new instance per call, like a new request. */
    private function use(string $client, string $ip): void
    {
        $this->usage()->record($client, $ip);
    }

    private function recordPath(): string
    {
        return $this->dir . '/sec-' . hash('sha256', FileMachineClientUsage::RECORD) . '.json';
    }

    /**
     * @return array<string, mixed> the stored record's data
     */
    private function stored(): array
    {
        $file = json_decode((string) file_get_contents($this->recordPath()), true);
        self::assertIsArray($file);
        $data = json_decode((string) $file['data'], true);
        self::assertIsArray($data);

        return $data;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function summaries(): array
    {
        return array_values(array_filter($this->log->getRecords(), static fn(array $r): bool => $r['level'] === Logger::INFO));
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function warnings(): array
    {
        return array_values(array_filter($this->log->getRecords(), static fn(array $r): bool => $r['level'] === Logger::WARNING));
    }

    /** Distinct addresses from 192.0.2.0 on, one request each, then the first request of the next hour. */
    private function useFromAddresses(int $count): void
    {
        for ($i = 0; $i < $count; $i++) {
            $this->use('ct-radius', "192.0.2.$i");
        }
        $this->clock->advance(3600);
        $this->use('ct-radius', '203.0.113.7');
    }

    public function testTheFirstRequestIsLoggedWithClientAndAddress(): void
    {
        $this->use('ct-radius', '203.0.113.7');

        $summaries = $this->summaries();
        self::assertCount(1, $summaries);
        self::assertSame('Machine client ct-radius is in use; first request in the last 14 days.', $summaries[0]['message']);
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

    /** A numeric ID stays a key of the record's object; the record never becomes a JSON list. */
    public function testNumericClientIdsKeepTheirOwnCount(): void
    {
        $this->use('123', '203.0.113.7');
        $this->use('0', '203.0.113.7');
        $this->clock->advance(3600);
        $this->use('123', '203.0.113.7');

        self::assertSame('Machine client 123 is in use; 1 request from 1 address since the last summary at 2026-11-01T12:00:00+00:00.', $this->summaries()[2]['message']);
    }

    public function testTenAddressesAreListedInFull(): void
    {
        $this->useFromAddresses(FileMachineClientUsage::MAX_ADDRESSES);

        $last = $this->summaries()[1];
        self::assertSame('Machine client ct-radius is in use; 10 requests from 10 addresses since the last summary at 2026-11-01T12:00:00+00:00.', $last['message']);
        self::assertCount(10, $last['context']['addresses']);
    }

    public function testElevenAddressesAreMoreThanTen(): void
    {
        $this->useFromAddresses(FileMachineClientUsage::MAX_ADDRESSES + 1);

        $last = $this->summaries()[1];
        self::assertSame('Machine client ct-radius is in use; 11 requests from more than 10 addresses since the last summary at 2026-11-01T12:00:00+00:00.', $last['message']);
        self::assertSame(array_map(static fn(int $i): string => "192.0.2.$i", range(0, 9)), $last['context']['addresses']);
    }

    public function testTheStoredAddressesAreBoundedToOneMoreThanListed(): void
    {
        for ($i = 0; $i < 30; $i++) {
            $this->use('ct-radius', "192.0.2.$i");
        }

        $state = $this->stored()['c:ct-radius'] ?? null;
        self::assertIsArray($state);
        self::assertSame(30, $state['count']);
        self::assertSame(array_map(static fn(int $i): string => "192.0.2.$i", range(0, FileMachineClientUsage::MAX_ADDRESSES)), $state['addresses']);
    }

    public function testAClockThatWentBackStartsANewHour(): void
    {
        $this->use('ct-radius', '203.0.113.7');
        $this->clock->advance(-7200);
        $this->use('ct-radius', '203.0.113.7');

        self::assertCount(2, $this->summaries());
    }

    /** M-2: no address is kept longer than the 14 days the log keeps it. */
    public function testAddressesOlderThanFourteenDaysAreDropped(): void
    {
        $this->use('ct-radius', '203.0.113.7');
        $this->use('backup-reader', '198.51.100.2');
        $this->clock->advance(FileMachineClientUsage::RETENTION_SECONDS - 1);
        $this->use('backup-reader', '198.51.100.2');
        self::assertArrayHasKey('c:ct-radius', $this->stored(), 'still within 14 days');

        $this->clock->advance(1);
        $this->use('backup-reader', '198.51.100.2');

        self::assertSame(['c:backup-reader'], array_keys($this->stored()), 'Any write drops the entries of every client that are 14 days old.');
        $this->use('ct-radius', '192.0.2.1');
        self::assertSame('Machine client ct-radius is in use; first request in the last 14 days.', $this->summaries()[array_key_last($this->summaries())]['message']);
    }

    /** M-2: clients no longer configured lose their entry when the access value is loaded. */
    public function testPruneKeepsOnlyTheConfiguredClients(): void
    {
        $this->use('ct-radius', '203.0.113.7');
        $this->use('old-reader', '198.51.100.2');

        $this->usage()->prune(['ct-radius', 'not-used-yet']);

        self::assertSame(['c:ct-radius'], array_keys($this->stored()));
    }

    public function testPruneAlsoDropsOldEntries(): void
    {
        $this->use('ct-radius', '203.0.113.7');
        $this->clock->advance(FileMachineClientUsage::RETENTION_SECONDS);

        $this->usage()->prune(['ct-radius']);

        self::assertSame([], $this->stored());
    }

    public function testPruneWithoutARecordCreatesNone(): void
    {
        $this->usage()->prune(['ct-radius']);

        self::assertFileDoesNotExist($this->recordPath());
    }

    public function testAnUnusableFolderIsAWarningAndTheRequestGoesOn(): void
    {
        mkdir($this->dir, 0o500);

        $this->use('ct-radius', '203.0.113.7');

        self::assertSame([], $this->summaries());
        self::assertFalse($this->log->hasErrorRecords());
        self::assertSame(["The usage of machine client ct-radius can't be counted, because the cache folder can't be used."], array_column($this->warnings(), 'message'));
    }

    /** The write fails after the record was read: the summary that wasn't stored isn't logged either. */
    public function testAWriteThatFailsAfterTheReadLogsNoSummary(): void
    {
        $this->use('ct-radius', '203.0.113.7');
        $this->log->clear();
        $this->clock->advance(3600);
        chmod($this->dir, 0o500);

        $this->use('ct-radius', '203.0.113.7');

        self::assertSame([], $this->summaries());
        self::assertCount(1, $this->warnings());
    }

    public function testATamperedRecordIsAWarningNotARefusal(): void
    {
        $this->use('ct-radius', '203.0.113.7');
        $this->log->clear();
        $this->clock->advance(3600);
        $raw = (string) file_get_contents($this->recordPath());
        file_put_contents($this->recordPath(), str_replace('ct-radius', 'ct-radiuz', $raw));

        $this->use('ct-radius', '203.0.113.7');

        self::assertSame([], $this->summaries());
        self::assertSame(['The usage record of the machine clients failed its integrity check, so usage isn\'t counted. Check the server for unauthorized access, then empty the folder cache/.'], array_column($this->warnings(), 'message'));
    }
}
