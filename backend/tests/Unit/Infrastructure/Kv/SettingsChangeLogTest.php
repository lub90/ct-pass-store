<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Infrastructure\Kv;

use CtPassStore\Domain\MachineClient;
use CtPassStore\Domain\Settings;
use CtPassStore\Infrastructure\Kv\SettingsChangeLog;
use CtPassStore\Infrastructure\Store\SignedFileStore;
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
        (new SettingsChangeLog(new SignedFileStore($this->dir, self::SECRET, $logger), $logger))->observe($settings);
    }

    private static function key(int $byte): string
    {
        return str_repeat(chr($byte), 32);
    }

    /**
     * @param list<MachineClient> $clients
     */
    private static function settings(array $clients, ?string $backendUrl = self::URL): Settings
    {
        $byId = [];
        foreach ($clients as $client) {
            $byId[$client->id] = $client;
        }

        return new Settings(false, true, 12, $backendUrl, $byId);
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
            'Backend address, first seen: ' . self::URL . '.',
        ], $this->notices());
    }

    public function testNoClientsAndNoAddressAreLoggedAsNone(): void
    {
        $this->observe(self::settings([], null));

        self::assertSame(['Enabled machine clients, first seen: none.', 'Backend address, first seen: none.'], $this->notices());
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
        $warnings = array_filter($this->log->getRecords(), static fn(array $r): bool => $r['level'] === Logger::WARNING);
        self::assertCount(1, $warnings);
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
