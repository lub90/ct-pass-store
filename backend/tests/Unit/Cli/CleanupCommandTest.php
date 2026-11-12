<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Cli;

use CtPassStore\Application\Cleanup\CleanupLock;
use CtPassStore\Cli\CleanupCommand;
use CtPassStore\Config\BackendConfig;
use CtPassStore\Infrastructure\ChurchTools\Exception\UnavailableException;
use CtPassStore\Infrastructure\Kv\KvSchema;
use CtPassStore\Kernel;
use CtPassStore\Tests\Support\FakeChurchToolsClient;
use CtPassStore\Tests\Support\FrozenClock;
use Monolog\Handler\TestHandler;
use Monolog\Logger;
use PHPUnit\Framework\TestCase;

/**
 * Catalog GP-16 to GP-18.
 */
final class CleanupCommandTest extends TestCase
{
    private FakeChurchToolsClient $fake;

    private TestHandler $log;

    private CleanupCommand $command;

    private string $cacheDir;

    /** @var array<string, int> */
    private array $categories;

    protected function setUp(): void
    {
        $this->cacheDir = sys_get_temp_dir() . '/ctps-cli-' . bin2hex(random_bytes(6));
        mkdir($this->cacheDir, 0o700);
        $this->fake = new FakeChurchToolsClient();
        $this->fake->setServiceUserPermissions(['churchdb' => [
            'view' => true,
            'view alldata' => [1],
            'view archive' => true,
            'view hidden persons' => true,
        ]]);
        $this->categories = $this->fake->addModule(KvSchema::EXTENSION_KEY, [
            KvSchema::PASSWORD_CATEGORY,
            KvSchema::SETTINGS_CATEGORY,
            KvSchema::ENCRYPTION_CATEGORY,
        ]);
        $this->setAdmins([10]);
        $this->log = new TestHandler();
        $logger = new Logger('test', [$this->log]);
        $config = new BackendConfig('https://example.church.tools/api', 'service-token', [], $this->cacheDir . '/credentials.php', $this->cacheDir, 'client', 'secret', 'jwt-secret-for-the-cli-tests-0123456789');
        $services = Kernel::cleanupServices($config, $this->fake, $logger, new FrozenClock());
        $this->command = new CleanupCommand($services['cleanup'], $services['lock'], $logger);
    }

    protected function tearDown(): void
    {
        foreach (glob($this->cacheDir . '/*') ?: [] as $file) {
            unlink($file);
        }
        rmdir($this->cacheDir);
    }

    /**
     * @param list<int> $admins
     */
    private function setAdmins(array $admins): void
    {
        $this->fake->clearValues($this->categories[KvSchema::SETTINGS_CATEGORY]);
        $this->fake->seedValue($this->categories[KvSchema::SETTINGS_CATEGORY], json_encode([
            KvSchema::SETTING_REQUIRE_PRIMARY_PASSWORD => true,
            KvSchema::SETTING_ALLOW_CUSTOM_PASSWORD => false,
            KvSchema::SETTING_PASSWORD_LENGTH => 16,
            KvSchema::SETTING_ADMIN_USERS => $admins,
            KvSchema::SETTING_BACKEND_URL => 'https://backend.example.org/ctpassstore',
        ], JSON_THROW_ON_ERROR));
    }

    private function entry(int $personId): void
    {
        $this->fake->seedValue($this->categories[KvSchema::PASSWORD_CATEGORY], json_encode([
            KvSchema::ENTRY_PERSON_ID => $personId,
            KvSchema::ENTRY_CIPHERTEXT => 'c2VjcmV0',
        ], JSON_THROW_ON_ERROR));
    }

    private function seedMixed(): void
    {
        $this->fake->addPerson(10);
        $this->fake->addPerson(57, archived: true);
        $this->entry(10);
        $this->entry(56);
        $this->entry(57);
    }

    /**
     * @param list<string> $arguments
     * @return array{exit: int, out: string, err: string}
     */
    private function execute(array $arguments): array
    {
        $out = fopen('php://memory', 'w+');
        $err = fopen('php://memory', 'w+');
        self::assertIsResource($out);
        self::assertIsResource($err);
        $exit = $this->command->run($arguments, $out, $err);
        rewind($out);
        rewind($err);

        return ['exit' => $exit, 'out' => (string) stream_get_contents($out), 'err' => (string) stream_get_contents($err)];
    }

    public function testEmptyStoreExitsZero(): void
    {
        $this->setAdmins([]);
        $result = $this->execute([]);

        self::assertSame(0, $result['exit']);
        self::assertSame("checked 0 persons, would delete 0 entries (dry run)\n", $result['out']);
        self::assertSame('', $result['err']);
        self::assertSame(0, $this->fake->countCalls(['personStatus', 'activePersonIds']));
    }

    public function testEmptyStoreAppliedSaysDeleted(): void
    {
        $this->setAdmins([]);
        $result = $this->execute(['--apply']);

        self::assertSame(0, $result['exit']);
        self::assertSame("checked 0 persons, deleted 0 entries\n", $result['out']);
    }

    public function testDryRunIsTheDefault(): void
    {
        $this->seedMixed();

        $result = $this->execute([]);

        self::assertSame(0, $result['exit']);
        self::assertSame(
            "would delete entry of person 56 (dry run)\nwould delete entry of person 57 (dry run)\nchecked 3 persons, would delete 2 entries (dry run)\n",
            $result['out'],
        );
        self::assertSame(0, $this->fake->writeCount());
    }

    public function testApplyDeletesAndExitsZero(): void
    {
        $this->seedMixed();

        $result = $this->execute(['--apply']);

        self::assertSame(0, $result['exit']);
        self::assertSame("deleted entry of person 56\ndeleted entry of person 57\nchecked 3 persons, deleted 2 entries\n", $result['out']);
        self::assertSame(1, count($this->fake->storedValues($this->categories[KvSchema::PASSWORD_CATEGORY])));
    }

    public function testSingularSummary(): void
    {
        $this->fake->addPerson(10);
        $this->entry(56);

        $result = $this->execute(['--apply']);

        self::assertStringContainsString("checked 1 person, deleted 1 entry\n", $result['out']);
    }

    public function testGoneAdminExitsOne(): void
    {
        $this->entry(10);

        $result = $this->execute(['--apply']);

        self::assertSame(1, $result['exit']);
        self::assertSame("adminUsers contains person 10, who is deleted or archived; remove them in the extension settings\n", $result['err']);
        self::assertStringContainsString('deleted entry of person 10', $result['out']);
    }

    public function testFailedDeleteExitsOne(): void
    {
        $this->seedMixed();
        $this->fake->failNext('deleteValue', new UnavailableException('DELETE: unreachable.'));

        $result = $this->execute(['--apply']);

        self::assertSame(1, $result['exit']);
        self::assertMatchesRegularExpression('/^could not delete the entry of person 56: .+; the next run retries it$/m', $result['err']);
        self::assertStringContainsString("deleted entry of person 57\n", $result['out']);
        self::assertStringNotContainsString('deleted entry of person 56', $result['out']);
        self::assertStringContainsString("checked 3 persons, deleted 1 entry\n", $result['out']);
    }

    public function testFailedLookupExitsTwo(): void
    {
        $this->seedMixed();
        $this->fake->failNext('activePersonIds', new UnavailableException('POST: unreachable.'));

        $result = $this->execute(['--apply']);

        self::assertSame(2, $result['exit']);
        self::assertSame("Aborted, nothing was deleted: POST: unreachable.\n", $result['err']);
        self::assertSame('', $result['out']);
        self::assertSame(0, $this->fake->writeCount());
    }

    public function testMissingRightExitsTwo(): void
    {
        $this->fake->setServiceUserPermissions(['churchdb' => ['view' => true]]);
        $this->entry(56);

        $result = $this->execute(['--apply']);

        self::assertSame(2, $result['exit']);
        self::assertStringStartsWith("The service user can't read persons (missing: ", $result['err']);
        self::assertStringNotContainsString('Aborted', $result['err']);
        self::assertSame(0, $this->fake->writeCount());
    }

    public function testInvalidSettingsExitTwoWithTheirMessage(): void
    {
        $this->fake->clearValues($this->categories[KvSchema::SETTINGS_CATEGORY]);
        $this->fake->seedValue($this->categories[KvSchema::SETTINGS_CATEGORY], '{}');

        $result = $this->execute([]);

        self::assertSame(2, $result['exit']);
        self::assertStringNotContainsString('Aborted', $result['err']);
        self::assertNotSame('', $result['err']);
    }

    public function testHeldLockExitsTwo(): void
    {
        $this->seedMixed();
        $holder = fopen($this->cacheDir . '/cleanup.lock', 'c');
        self::assertIsResource($holder);
        self::assertTrue(flock($holder, LOCK_EX | LOCK_NB));

        $result = $this->execute(['--apply']);

        self::assertSame(2, $result['exit']);
        self::assertSame("Another cleanup is running.\n", $result['err']);
        self::assertSame('', $result['out']);
        self::assertSame(0, $this->fake->writeCount());

        flock($holder, LOCK_UN);
        fclose($holder);
    }

    public function testUnopenableLockFileExitsTwoWithItsOwnMessage(): void
    {
        $blocker = $this->cacheDir . '/not-a-folder';
        touch($blocker);
        $services = Kernel::cleanupServices(new BackendConfig('https://example.church.tools/api', 'service-token', [], $blocker . '/credentials.php', $blocker, 'client', 'secret', 'jwt-secret-for-the-cli-tests-0123456789'), $this->fake, new Logger('test', [$this->log]));
        $command = new CleanupCommand($services['cleanup'], $services['lock'], new Logger('test', [$this->log]));
        $out = fopen('php://memory', 'w+');
        $err = fopen('php://memory', 'w+');
        self::assertIsResource($out);
        self::assertIsResource($err);

        self::assertSame(2, $command->run(['--apply'], $out, $err));

        rewind($err);
        self::assertSame("Cannot open the lock file cache/cleanup.lock; check that cache/ exists and is writable by this user.\n", stream_get_contents($err));
        self::assertSame(0, $this->fake->writeCount());
    }

    public function testMissingCacheFolderIsCreatedForTheLock(): void
    {
        $lock = new CleanupLock($this->cacheDir . '/new/cleanup.lock');

        self::assertTrue($lock->tryAcquire());
        self::assertFalse((new CleanupLock($this->cacheDir . '/new/cleanup.lock'))->tryAcquire());
        $lock->release();
        unlink($this->cacheDir . '/new/cleanup.lock');
        rmdir($this->cacheDir . '/new');
    }

    /** GP-26 */
    public function testLockFileIsCreatedWithMode600(): void
    {
        $previous = umask(0o022);
        try {
            $lock = new CleanupLock($this->cacheDir . '/cleanup.lock');
            self::assertTrue($lock->tryAcquire());
            clearstatcache();
            self::assertSame(0o600, fileperms($this->cacheDir . '/cleanup.lock') & 0o777);
            $lock->release();
        } finally {
            umask($previous);
        }
    }

    public function testLogLevels(): void
    {
        $this->seedMixed();
        $this->entry(10);
        $this->fake->removePerson(10);
        $this->fake->failNext('deleteValue', new UnavailableException('DELETE: unreachable.'));
        $this->execute(['--apply']);

        $levels = [];
        foreach ($this->log->getRecords() as $record) {
            $levels[(string) $record['message']] = $record['level'];
            self::assertStringNotContainsString('service-token', (string) $record['message']);
        }
        self::assertTrue($this->log->hasInfoThatContains('deleted entry of person '));
        self::assertTrue($this->log->hasInfoThatContains('checked '));
        self::assertSame(Logger::WARNING, $levels['adminUsers contains person 10, who is deleted or archived; remove them in the extension settings']);
        self::assertTrue($this->log->hasWarningThatContains('could not delete the entry of person '));

        $this->log->clear();
        $this->fake->failNext('activePersonIds', new UnavailableException('POST: unreachable.'));
        $this->execute([]);
        self::assertTrue($this->log->hasError('Aborted, nothing was deleted: POST: unreachable.'));
    }

    public function testLockIsReleasedAfterARunAndAfterAnAbort(): void
    {
        $this->setAdmins([]);
        $this->fake->failNext('activePersonIds', new UnavailableException('POST: unreachable.'));
        $this->entry(56);
        self::assertSame(2, $this->execute([])['exit']);

        self::assertSame(0, $this->execute([])['exit']);
        $lock = new CleanupLock($this->cacheDir . '/cleanup.lock');
        self::assertTrue($lock->tryAcquire());
        $lock->release();
    }

    public function testUnknownArgumentExitsTwo(): void
    {
        $this->entry(56);
        foreach ([['--force'], ['--apply', '--apply'], ['apply']] as $arguments) {
            $result = $this->execute($arguments);

            self::assertSame(2, $result['exit']);
            self::assertSame("Usage: php bin/cleanup.php [--apply]\n", $result['err']);
            self::assertSame('', $result['out']);
        }
        self::assertSame(0, $this->fake->countCalls(['personStatus', 'activePersonIds']));
    }

    public function testOutputNamesIdsOnly(): void
    {
        $this->seedMixed();
        $this->entry(10);
        $this->fake->removePerson(10);

        $result = $this->execute(['--apply']);

        $formats = [
            '/^deleted entry of person \d+$/',
            '/^checked \d+ persons?, deleted \d+ entr(y|ies)$/',
            '/^adminUsers contains person \d+, who is deleted or archived; remove them in the extension settings$/',
        ];
        $lines = array_filter(explode("\n", $result['out'] . $result['err']));
        self::assertNotEmpty($lines);
        foreach ($lines as $line) {
            $matches = array_filter($formats, static fn(string $f): bool => preg_match($f, $line) === 1);
            self::assertNotEmpty($matches, "Unexpected line: $line");
        }
        foreach ($this->log->getRecords() as $record) {
            self::assertStringNotContainsString('service-token', (string) $record['message']);
        }
    }

    public function testPrintedLinesAreLogged(): void
    {
        $this->seedMixed();

        $this->execute(['--apply']);

        self::assertTrue($this->log->hasInfoThatContains('deleted entry of person 56'));
        self::assertTrue($this->log->hasInfoThatContains('checked 3 persons, deleted 2 entries'));
    }
}
