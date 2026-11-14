<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Api;

use CtPassStore\Domain\MachineClient;
use CtPassStore\Infrastructure\Kv\KvSettingsRepository;
use Monolog\Logger;

/**
 * Point-B audit trail end to end (backend spec 6.4): changes of the enabled machine clients and of the backend address
 * are logged once, when the settings are loaded from ChurchTools; machine clients get an hourly usage summary.
 */
final class AuditLogApiTest extends ApiTestCase
{
    /**
     * @return list<string>
     */
    private function messages(int $level): array
    {
        return array_values(array_map(static fn(array $r): string => $r['message'], array_filter($this->log->getRecords(), static fn(array $r): bool => $r['level'] === $level)));
    }

    private function print(string $client): string
    {
        return MachineClient::keyFingerprint((string) base64_decode($this->machinePublicKey($client), true));
    }

    private function defaultSet(): string
    {
        return 'ct-radius (permissions: entries:read; keys: ' . $this->print(self::READER_CLIENT) . '), no-rights (permissions: none; keys: ' . $this->print(self::NO_RIGHTS_CLIENT) . ')';
    }

    /**
     * A request that needs the settings (a person's own GET doesn't load them): a machine client's GET, answered 404
     * while the client is enabled and 401 once a change disabled it or its audience.
     */
    private function loadSettings(): void
    {
        self::assertContains($this->request('GET', '/v1/entries/' . self::USER, self::READER_CLIENT)->getStatusCode(), [401, 404]);
    }

    public function testTheFirstLoadLogsTheInitialClientsAndAddressOnce(): void
    {
        $this->loadSettings();
        $this->loadSettings();
        // The settings cache expired; the same values are loaded again.
        $this->forgetCache();
        $this->loadSettings();

        self::assertSame([
            'Enabled machine clients, first seen: ' . $this->defaultSet() . '.',
            'Backend address, first seen: ' . self::BACKEND_URL . '.',
        ], $this->messages(Logger::NOTICE));
    }

    /** The compare costs a locked write, so it runs only when the settings came from ChurchTools, not per request. */
    public function testTheLastSeenRecordIsWrittenOnlyWhenTheSettingsAreLoadedFromChurchTools(): void
    {
        $record = $this->cacheDir . '/sec-' . hash('sha256', 'audit:settings') . '.json';
        $this->loadSettings();
        clearstatcache();
        $written = fileinode($record);

        $this->loadSettings();
        clearstatcache();
        self::assertSame($written, fileinode($record), 'A request served from the settings cache rewrote the record.');

        $this->forgetCache();
        $this->loadSettings();
        clearstatcache();
        self::assertNotSame($written, fileinode($record), 'A load from ChurchTools must compare (and rewrite) the record.');
    }

    public function testARemovedClientIsLoggedOnceTheCacheExpired(): void
    {
        $this->loadSettings();
        $this->log->clear();
        $this->setAccess([
            'machineClients' => [
                ['id' => self::READER_CLIENT, 'name' => 'RADIUS', 'publicKeys' => [$this->machinePublicKey(self::READER_CLIENT)], 'permissions' => ['entries:read'], 'createdAt' => '2026-11-01'],
            ],
        ]);
        $this->loadSettings();
        $this->loadSettings();

        self::assertSame([
            'The enabled machine clients changed. Removed: no-rights (permissions: none; keys: ' . $this->print(self::NO_RIGHTS_CLIENT) . '). Now enabled: ct-radius (permissions: entries:read; keys: ' . $this->print(self::READER_CLIENT) . ').',
        ], $this->messages(Logger::NOTICE));
    }

    public function testAChangeIsLoggedWhenTheCacheExpiresByTime(): void
    {
        $this->loadSettings();
        $this->log->clear();
        // Changed in ChurchTools without clearing the cache: the backend sees it only after the TTL.
        $this->churchTools->clearValues($this->categoryIds['access']);
        $this->churchTools->seedValue($this->categoryIds['access'], (string) json_encode(['schema' => 2, 'revision' => 2, 'groups' => [], 'machineClients' => []]));
        $this->loadSettings();
        self::assertSame([], $this->messages(Logger::NOTICE));

        $this->clock->advance(KvSettingsRepository::SETTINGS_TTL);
        $this->loadSettings();

        self::assertSame(['The enabled machine clients changed. Removed: ' . $this->defaultSet() . '. Now enabled: none.'], $this->messages(Logger::NOTICE));
    }

    public function testAMissingAccessValueEmptiesTheSet(): void
    {
        $this->loadSettings();
        $this->log->clear();
        $this->forgetCache();
        $this->churchTools->clearValues($this->categoryIds['access']);
        $this->loadSettings();

        self::assertSame(['The enabled machine clients changed. Removed: ' . $this->defaultSet() . '. Now enabled: none.'], $this->messages(Logger::NOTICE));
    }

    public function testAChangedBackendAddressLogsOldAndNew(): void
    {
        $this->loadSettings();
        $this->log->clear();
        $this->setSettings(['backendUrl' => 'https://other.example.org/pass/']);
        $this->loadSettings();

        self::assertSame(['The backend address changed from ' . self::BACKEND_URL . ' to https://other.example.org/pass.'], $this->messages(Logger::NOTICE));
    }

    public function testMachineClientsGetAnHourlyUsageSummary(): void
    {
        $this->seedEntry(self::USER);
        for ($i = 0; $i < 3; $i++) {
            self::assertSame(200, $this->request('GET', '/v1/entries/' . self::USER, self::READER_CLIENT)->getStatusCode());
        }
        $this->clock->advance(3600);
        $this->clientIp = '198.51.100.2';
        $this->request('GET', '/v1/entries/' . self::USER, self::READER_CLIENT);

        $usage = array_values(array_filter($this->log->getRecords(), static fn(array $r): bool => str_contains($r['message'], ' is in use;')));
        self::assertCount(2, $usage);
        self::assertSame('Machine client ct-radius is in use; first request seen.', $usage[0]['message']);
        self::assertSame(self::CLIENT_IP, $usage[0]['context']['ip']);
        self::assertSame('Machine client ct-radius is in use; 3 requests from 1 address since the last summary at 2026-11-01T12:00:00+00:00.', $usage[1]['message']);
        self::assertSame(['ip' => '198.51.100.2', 'addresses' => [self::CLIENT_IP]], $usage[1]['context']);
    }

    public function testRejectedMachineTokensAndPersonsGetNoUsageSummary(): void
    {
        $this->request('GET', '/v1/entries/' . self::USER, null, null, ['Authorization' => 'Bearer ' . $this->machineTokenOf(self::READER_CLIENT, ['aud' => 'https://elsewhere.example.org'])]);
        $this->request('GET', '/v1/entries/' . self::USER, self::USER);

        self::assertSame([], array_values(array_filter($this->log->getRecords(), static fn(array $r): bool => str_contains($r['message'], ' is in use;'))));
    }
}
