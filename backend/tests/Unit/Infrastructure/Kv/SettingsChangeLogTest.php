<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Infrastructure\Kv;

use CtPassStore\Domain\MachineClient;
use CtPassStore\Domain\Settings;
use CtPassStore\Infrastructure\Auth\FileMachineClientUsage;
use CtPassStore\Infrastructure\Kv\SettingsChangeLog;
use CtPassStore\Infrastructure\Store\SignedFileStore;
use CtPassStore\Tests\Support\FrozenClock;
use Monolog\Handler\TestHandler;
use Monolog\Logger;
use PHPUnit\Framework\TestCase;

/**
 * Point-B audit trail: a change of the enabled machine clients or of the backend address is logged at notice, once
 * (backend spec 6.4).
 */
final class SettingsChangeLogTest extends TestCase
{
    private const SECRET = 'settings-change-log-test-secret-32-bytes';
    private const URL = 'https://backend.example.org/ctpassstore';

    private string $dir;

    private TestHandler $log;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/ctps-changelog-' . bin2hex(random_bytes(6));
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

    /** A new instance per call, like a new request: the state must come from the folder, not from memory. */
    private function observe(Settings $settings): void
    {
        $logger = new Logger('test', [$this->log]);
        $store = new SignedFileStore($this->dir, self::SECRET, $logger);
        (new SettingsChangeLog($store, $logger, new FileMachineClientUsage($store, new FrozenClock(), $logger)))->observe($settings);
    }

    private function recordPath(string $name = 'audit:settings'): string
    {
        return $this->dir . '/sec-' . hash('sha256', $name) . '.json';
    }

    /**
     * @return list<string>
     */
    private function warnings(): array
    {
        return array_values(array_map(
            static fn(array $r): string => $r['message'],
            array_filter($this->log->getRecords(), static fn(array $r): bool => $r['level'] === Logger::WARNING),
        ));
    }

    private static function key(int $byte): string
    {
        return str_repeat(chr($byte), 32);
    }

    /**
     * @param list<MachineClient> $clients
     */
    private static function settings(array $clients, ?string $backendUrl = self::URL, ?int $adminGroupId = 12): Settings
    {
        $byId = [];
        foreach ($clients as $client) {
            $byId[$client->id] = $client;
        }

        return new Settings(false, true, 12, $backendUrl, $byId, $adminGroupId);
    }

    private static function radius(string ...$permissions): MachineClient
    {
        return new MachineClient('ct-radius', 'RADIUS', [self::key(1)], array_values($permissions));
    }

    /**
     * @return list<string>
     */
    private function notices(): array
    {
        return array_values(array_map(
            static fn(array $r): string => $r['message'],
            array_filter($this->log->getRecords(), static fn(array $r): bool => $r['level'] === Logger::NOTICE),
        ));
    }

    private function clearLog(): void
    {
        $this->log->clear();
    }

    public function testTheFirstLoadLogsTheInitialSetAndAddressOnce(): void
    {
        $this->observe(self::settings([self::radius('entries:read')]));
        $this->observe(self::settings([self::radius('entries:read')]));

        self::assertSame([
            'Enabled machine clients, first seen: ct-radius (permissions: entries:read; keys: ' . MachineClient::keyFingerprint(self::key(1)) . ').',
            'Admin group, first seen: 12.',
            'Backend address, first seen: ' . self::URL . '.',
        ], $this->notices());
    }

    public function testNoClientsAndNoAddressAreLoggedAsNone(): void
    {
        $this->observe(self::settings([], null, null));

        self::assertSame(['Enabled machine clients, first seen: none.', 'Admin group, first seen: none.', 'Backend address, first seen: none.'], $this->notices());
    }

    public function testAnAddedClientIsLoggedWithTheNewSet(): void
    {
        $this->observe(self::settings([self::radius('entries:read')]));
        $this->clearLog();
        $other = new MachineClient('backup-reader', 'Backup', [self::key(2), self::key(3)], []);
        $this->observe(self::settings([self::radius('entries:read'), $other]));

        $added = 'backup-reader (permissions: none; keys: ' . implode(', ', self::sortedPrints(self::key(2), self::key(3))) . ')';
        $radius = 'ct-radius (permissions: entries:read; keys: ' . MachineClient::keyFingerprint(self::key(1)) . ')';
        self::assertSame(["The enabled machine clients changed. Added: $added. Now enabled: $added, $radius."], $this->notices());
    }

    public function testARemovedClientIsLogged(): void
    {
        $this->observe(self::settings([self::radius('entries:read')]));
        $this->clearLog();
        $this->observe(self::settings([]));

        $radius = 'ct-radius (permissions: entries:read; keys: ' . MachineClient::keyFingerprint(self::key(1)) . ')';
        self::assertSame(["The enabled machine clients changed. Removed: $radius. Now enabled: none."], $this->notices());
    }

    public function testAChangedPermissionIsLoggedAsRemovedAndAdded(): void
    {
        $this->observe(self::settings([self::radius()]));
        $this->clearLog();
        $this->observe(self::settings([self::radius('entries:read')]));

        $print = MachineClient::keyFingerprint(self::key(1));
        self::assertSame([
            "The enabled machine clients changed. Added: ct-radius (permissions: entries:read; keys: $print). Removed: ct-radius (permissions: none; keys: $print). Now enabled: ct-radius (permissions: entries:read; keys: $print).",
        ], $this->notices());
    }

    public function testAReplacedKeyIsAChange(): void
    {
        $this->observe(self::settings([self::radius('entries:read')]));
        $this->clearLog();
        $this->observe(self::settings([new MachineClient('ct-radius', 'RADIUS', [self::key(9)], ['entries:read'])]));

        self::assertCount(1, $this->notices());
        self::assertStringContainsString(MachineClient::keyFingerprint(self::key(9)), $this->notices()[0]);
    }

    public function testTheOrderOfClientsKeysAndPermissionsIsNoChange(): void
    {
        $a = new MachineClient('client-a', 'A', [self::key(1), self::key(2)], ['entries:read']);
        $b = new MachineClient('client-b', 'B', [self::key(3)], []);
        $this->observe(self::settings([$a, $b]));
        $this->clearLog();
        $this->observe(self::settings([$b, new MachineClient('client-a', 'A renamed', [self::key(2), self::key(1)], ['entries:read'])]));

        self::assertSame([], $this->notices());
    }

    public function testAChangedAddressLogsTheOldAndTheNewValue(): void
    {
        $this->observe(self::settings([]));
        $this->clearLog();
        $this->observe(self::settings([], 'https://evil.example.com/ctpassstore'));
        $this->observe(self::settings([], null));

        self::assertSame([
            'The backend address changed from ' . self::URL . ' to https://evil.example.com/ctpassstore.',
            'The backend address changed from https://evil.example.com/ctpassstore to none.',
        ], $this->notices());
    }

    public function testNeitherKeysNorNamesReachTheLog(): void
    {
        $this->observe(self::settings([new MachineClient('ct-radius', 'Secret-Name', [self::key(7)], ['entries:read'])]));

        foreach ($this->log->getRecords() as $record) {
            $line = (string) json_encode([$record['message'], $record['context']], JSON_UNESCAPED_SLASHES);
            self::assertStringNotContainsString(base64_encode(self::key(7)), $line);
            self::assertStringNotContainsString(rtrim(strtr(base64_encode(self::key(7)), '+/', '-_'), '='), $line);
            self::assertStringNotContainsString('Secret-Name', $line);
        }
    }

    public function testAnUnusableFolderIsAWarningAndNeverAnError(): void
    {
        mkdir($this->dir, 0o500);

        $this->observe(self::settings([self::radius('entries:read')]));

        self::assertSame([], $this->notices());
        self::assertFalse($this->log->hasErrorRecords());
        self::assertSame(['Changes of the machine clients, the admin group and the backend address can\'t be checked, because the cache folder can\'t be used.'], $this->warnings());
    }

    /** I2: a missing address is remembered as such; the first address after it is a change, not a first sighting. */
    public function testAnAddressAfterNoneIsAChange(): void
    {
        $this->observe(self::settings([], null));
        $this->observe(self::settings([], null));
        self::assertSame(['Backend address, first seen: none.'], array_values(preg_grep('/^Backend address/', $this->notices())));
        $this->clearLog();

        $this->observe(self::settings([]));

        self::assertSame(['The backend address changed from none to ' . self::URL . '.'], $this->notices());
    }

    /** M-3: the admin group decides who is admin, so its change is logged like the clients'. */
    public function testAChangedAdminGroupIsLogged(): void
    {
        $this->observe(self::settings([]));
        $this->observe(self::settings([]));
        $this->clearLog();
        $this->observe(self::settings([], self::URL, 99));
        $this->observe(self::settings([], self::URL, null));
        $this->observe(self::settings([], self::URL, 12));

        self::assertSame([
            'The admin group changed from 12 to 99.',
            'The admin group changed from 99 to none.',
            'The admin group changed from none to 12.',
        ], $this->notices());
    }

    /** An older or foreign shape of a validly signed record counts as never seen. */
    public function testARecordOfAnotherShapeCountsAsNeverSeen(): void
    {
        $logger = new Logger('test', [$this->log]);
        (new SignedFileStore($this->dir, self::SECRET, $logger))->update('audit:settings', static fn(array $data): array => ['machineClients' => ['x' => 'y']]);

        $this->observe(self::settings([self::radius('entries:read')]));

        self::assertStringStartsWith('Enabled machine clients, first seen: ct-radius', $this->notices()[0]);
    }

    /** I3: a tampered record is a warning naming the cause; nothing is compared and the request goes on. */
    public function testATamperedRecordIsAWarningWithTheCause(): void
    {
        $this->observe(self::settings([self::radius('entries:read')]));
        $this->clearLog();
        file_put_contents($this->recordPath(), str_replace('ct-radius', 'ct-radiuz', (string) file_get_contents($this->recordPath())));

        $this->observe(self::settings([]));

        self::assertSame([], $this->notices());
        self::assertSame(['The record of the last seen machine clients, admin group and backend address failed its integrity check, so their changes aren\'t logged. Check the server for unauthorized access, then empty the folder cache/.'], $this->warnings());
        foreach ($this->log->getRecords() as $record) {
            self::assertStringNotContainsString('refused', $record['message'], 'The request goes on; no message may say otherwise.');
        }
    }

    /** I3: the write fails after the record was read: a change that wasn't stored isn't logged either. */
    public function testAWriteThatFailsAfterTheReadLogsNoChange(): void
    {
        $this->observe(self::settings([self::radius('entries:read')]));
        $this->clearLog();
        chmod($this->dir, 0o500);

        $this->observe(self::settings([]));

        self::assertSame([], $this->notices());
        self::assertSame(['Changes of the machine clients, the admin group and the backend address can\'t be checked, because the cache folder can\'t be used.'], $this->warnings());
    }

    /** M-2: the access load also drops the usage of clients that are no longer configured. */
    public function testTheUsageOfRemovedClientsIsDropped(): void
    {
        $logger = new Logger('test', [$this->log]);
        $usage = new FileMachineClientUsage(new SignedFileStore($this->dir, self::SECRET, $logger), new FrozenClock(), $logger);
        $usage->record('ct-radius', '203.0.113.7');
        $usage->record('old-reader', '198.51.100.2');

        $this->observe(self::settings([self::radius('entries:read')]));

        $file = json_decode((string) file_get_contents($this->recordPath(FileMachineClientUsage::RECORD)), true);
        self::assertIsArray($file);
        self::assertSame(['c:ct-radius'], array_keys((array) json_decode((string) $file['data'], true)));
    }

    /**
     * @return list<string>
     */
    private static function sortedPrints(string ...$keys): array
    {
        $prints = array_map(MachineClient::keyFingerprint(...), array_values($keys));
        sort($prints, SORT_STRING);

        return $prints;
    }
}
