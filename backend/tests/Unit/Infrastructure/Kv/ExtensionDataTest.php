<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Infrastructure\Kv;

use CtPassStore\Application\Exception\ConfigurationException;
use CtPassStore\Application\Failure\Reason;
use CtPassStore\Infrastructure\ChurchTools\Exception\NotFoundException;
use CtPassStore\Infrastructure\Kv\ExtensionData;
use CtPassStore\Infrastructure\Kv\KvSchema;
use CtPassStore\Infrastructure\Store\RecordSigner;
use CtPassStore\Infrastructure\Store\SignedFileCache;
use CtPassStore\Tests\Support\FakeChurchToolsClient;
use CtPassStore\Tests\Support\FrozenClock;
use Monolog\Handler\TestHandler;
use Monolog\Logger;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Catalog ST-19 (spec 5.3.10): a missing module or category is "extension not installed" (500 misconfigured), naming
 * what's missing, and never "no entry". ST-18 and the ID cache (spec 5.3.10, 6.1): cached IDs, and their re-resolution
 * when ChurchTools answers 404 for them.
 */
final class ExtensionDataTest extends TestCase
{
    private const MODULE = KvSchema::EXTENSION_KEY;

    /** @var list<string> */
    private const CATEGORIES = [KvSchema::SETTINGS_CATEGORY, KvSchema::ENCRYPTION_CATEGORY, KvSchema::PASSWORD_CATEGORY];

    private string $cacheDir = '';

    private FrozenClock $clock;

    private TestHandler $log;

    protected function setUp(): void
    {
        $this->cacheDir = sys_get_temp_dir() . '/ctps-ids-cache-' . bin2hex(random_bytes(6));
        $this->clock = new FrozenClock();
        $this->log = new TestHandler();
    }

    protected function tearDown(): void
    {
        foreach (glob($this->cacheDir . '/*') ?: [] as $file) {
            @unlink($file);
        }
        @rmdir($this->cacheDir);
    }

    /**
     * ExtensionData as one request builds it, with the cache folder shared between requests.
     */
    private function data(FakeChurchToolsClient $fake): ExtensionData
    {
        $cache = new SignedFileCache($this->cacheDir, new RecordSigner('ids-cache-test-secret-with-at-least-32b', SignedFileCache::PURPOSE), $this->clock, new Logger('test', [$this->log]));

        return new ExtensionData($fake, KvSchema::EXTENSION_KEY, $cache);
    }

    private static function resolutions(FakeChurchToolsClient $fake): int
    {
        self::assertSame($fake->countCalls(['getModuleByKey']), $fake->countCalls(['getCategories']), 'Module and categories are resolved together.');

        return $fake->countCalls(['getModuleByKey']);
    }

    // ---------------------------------------------------------------- ID cache (spec 6.1)

    public function testIdsAreResolvedOnceWithinTtl(): void
    {
        $fake = new FakeChurchToolsClient();
        $ids = $fake->addModule(self::MODULE, self::CATEGORIES);
        $fake->seedValue($ids[KvSchema::PASSWORD_CATEGORY], '{"personId": 1}');

        $this->data($fake)->values(KvSchema::PASSWORD_CATEGORY);
        $this->clock->advance(ExtensionData::IDS_TTL - 1);
        $second = $this->data($fake);
        $second->values(KvSchema::SETTINGS_CATEGORY);
        self::assertCount(1, $second->values(KvSchema::PASSWORD_CATEGORY));

        self::assertSame(1, self::resolutions($fake));
    }

    public function testIdsAreResolvedAgainAfterTtl(): void
    {
        $fake = new FakeChurchToolsClient();
        $fake->addModule(self::MODULE, self::CATEGORIES);

        $this->data($fake)->values(KvSchema::PASSWORD_CATEGORY);
        $this->clock->advance(ExtensionData::IDS_TTL + 1);
        $this->data($fake)->values(KvSchema::PASSWORD_CATEGORY);

        self::assertSame(2, self::resolutions($fake));
    }

    /**
     * CA-05: a corrupt ID cache is a miss; the IDs come from ChurchTools.
     */
    public function testACorruptIdsCacheIsResolvedFromChurchTools(): void
    {
        $fake = new FakeChurchToolsClient();
        $fake->addModule(self::MODULE, self::CATEGORIES);
        mkdir($this->cacheDir, 0o700);
        file_put_contents($this->cacheDir . '/cache-' . hash('sha256', 'ids') . '.json', 'garbage');

        self::assertSame([], $this->data($fake)->values(KvSchema::PASSWORD_CATEGORY));
        self::assertSame(1, self::resolutions($fake));
    }

    /**
     * A validly signed entry of the wrong shape is a miss, not a crash.
     */
    public function testACachedEntryOfTheWrongShapeIsResolvedFromChurchTools(): void
    {
        $fake = new FakeChurchToolsClient();
        $fake->addModule(self::MODULE, self::CATEGORIES);
        $cache = new SignedFileCache($this->cacheDir, new RecordSigner('ids-cache-test-secret-with-at-least-32b', SignedFileCache::PURPOSE), $this->clock, new Logger('test', [$this->log]));
        $cache->put('ids', ['moduleId' => '1', 'categories' => [['id' => 'x', 'name' => 7]]], ExtensionData::IDS_TTL);

        self::assertSame([], $this->data($fake)->values(KvSchema::PASSWORD_CATEGORY));
        self::assertSame(1, self::resolutions($fake));
    }

    // ---------------------------------------------------------------- ST-18 stale cached IDs (spec 5.3.10)

    /**
     * @return iterable<string, array{\Closure(ExtensionData): mixed, string}> the operation and the ChurchTools call it makes
     */
    public static function retriedOperations(): iterable
    {
        yield 'values' => [static fn(ExtensionData $data): mixed => $data->values(KvSchema::PASSWORD_CATEGORY), 'getValues'];
        yield 'create' => [static fn(ExtensionData $data): mixed => $data->create(KvSchema::PASSWORD_CATEGORY, '{"personId": 1}'), 'createValue'];
    }

    /**
     * ST-18: after a reinstall, the cached IDs answer 404; they're resolved exactly once more and the request succeeds.
     *
     * @param \Closure(ExtensionData): mixed $operation
     */
    #[DataProvider('retriedOperations')]
    public function testStaleCachedIdsAreResolvedExactlyOnceMore(\Closure $operation, string $call): void
    {
        $fake = new FakeChurchToolsClient();
        $old = $fake->addModule(self::MODULE, self::CATEGORIES);
        $this->data($fake)->values(KvSchema::SETTINGS_CATEGORY);
        $fake->removeModule(self::MODULE);
        $new = $fake->addModule(self::MODULE, self::CATEGORIES);
        self::assertNotSame($old, $new);

        $operation($this->data($fake));

        self::assertSame(2, self::resolutions($fake), 'One extra getModuleByKey and getCategories.');
        $last = $fake->calls()[array_key_last($fake->calls())];
        self::assertSame($call, $last['method']);
        self::assertSame($new[KvSchema::PASSWORD_CATEGORY], $last['args'][1], 'The retry uses the new category ID.');

        // The new IDs are cached: the next request resolves nothing.
        $this->data($fake)->values(KvSchema::PASSWORD_CATEGORY);
        self::assertSame(2, self::resolutions($fake));
    }

    /**
     * ST-18: if ChurchTools keeps answering 404, there's one re-resolution and one retry, no loop; the 404 propagates
     * (500 misconfigured, never entry-not-found).
     *
     * @param \Closure(ExtensionData): mixed $operation
     */
    #[DataProvider('retriedOperations')]
    public function testPersistentNotFoundIsNoLoop(\Closure $operation, string $call): void
    {
        $fake = new FakeChurchToolsClient();
        $fake->addModule(self::MODULE, self::CATEGORIES);
        $this->data($fake)->values(KvSchema::SETTINGS_CATEGORY);
        $before = $fake->countCalls([$call]);
        for ($i = 0; $i < 5; $i++) {
            $fake->failNext($call, new NotFoundException('customdatacategories: ChurchTools answered 404.'));
        }

        try {
            $operation($this->data($fake));
            self::fail('Expected a NotFoundException.');
        } catch (NotFoundException $e) {
            self::assertSame(Reason::ExtensionNotInstalled, $e->reason());
        }

        self::assertSame(2, self::resolutions($fake), 'Exactly one re-resolution.');
        self::assertSame($before + 2, $fake->countCalls([$call]), 'Exactly one retry.');
    }

    /**
     * IDs resolved in this very request can't be stale: a 404 propagates without a second resolution.
     *
     * @param \Closure(ExtensionData): mixed $operation
     */
    #[DataProvider('retriedOperations')]
    public function testFreshIdsAreNotReresolved(\Closure $operation, string $call): void
    {
        $fake = new FakeChurchToolsClient();
        $fake->addModule(self::MODULE, self::CATEGORIES);
        $fake->failNext($call, new NotFoundException('customdatacategories: ChurchTools answered 404.'));

        try {
            $operation($this->data($fake));
            self::fail('Expected a NotFoundException.');
        } catch (NotFoundException) {
        }

        self::assertSame(1, self::resolutions($fake));
        self::assertSame(1, $fake->countCalls([$call]));
    }

    /**
     * Spec 5.3.6: a 404 on update or delete means the value is gone (another request deleted it); the cached IDs
     * aren't discarded and nothing is retried.
     */
    public function testUpdateAndDeleteDontReresolve(): void
    {
        $fake = new FakeChurchToolsClient();
        $fake->addModule(self::MODULE, self::CATEGORIES);
        $this->data($fake)->values(KvSchema::PASSWORD_CATEGORY);

        foreach (['update', 'delete'] as $operation) {
            $data = $this->data($fake);
            try {
                $operation === 'update' ? $data->update(KvSchema::PASSWORD_CATEGORY, 999, '{}') : $data->delete(KvSchema::PASSWORD_CATEGORY, 999);
                self::fail("Expected a NotFoundException from $operation.");
            } catch (NotFoundException) {
            }
        }

        self::assertSame(1, self::resolutions($fake));
        self::assertSame(1, $fake->countCalls(['updateValue']));
        self::assertSame(1, $fake->countCalls(['deleteValue']));
    }

    /**
     * A category created after the IDs were cached (setup completed later) is found without waiting for the TTL.
     */
    public function testACategoryMissingFromTheCachedIdsIsResolvedOnceMore(): void
    {
        $fake = new FakeChurchToolsClient();
        $fake->addModule(self::MODULE, [KvSchema::SETTINGS_CATEGORY]);
        $this->data($fake)->values(KvSchema::SETTINGS_CATEGORY);
        $fake->removeModule(self::MODULE);
        $fake->addModule(self::MODULE, self::CATEGORIES);

        self::assertSame([], $this->data($fake)->values(KvSchema::PASSWORD_CATEGORY));
        self::assertSame(2, self::resolutions($fake));
    }

    /**
     * A category that's missing in ChurchTools too stays a configuration error, after one re-resolution.
     */
    public function testACategoryMissingEverywhereIsResolvedOnlyOnceMore(): void
    {
        $fake = new FakeChurchToolsClient();
        $fake->addModule(self::MODULE, [KvSchema::SETTINGS_CATEGORY]);
        $this->data($fake)->values(KvSchema::SETTINGS_CATEGORY);

        try {
            $this->data($fake)->values(KvSchema::PASSWORD_CATEGORY);
            self::fail('Expected a ConfigurationException.');
        } catch (ConfigurationException $e) {
            self::assertSame(Reason::ExtensionNotInstalled, $e->reason());
        }
        self::assertSame(2, self::resolutions($fake));
    }

    // ---------------------------------------------------------------- ST-19

    public function testAMissingModuleIsExtensionNotInstalled(): void
    {
        $data = new ExtensionData(new FakeChurchToolsClient());

        try {
            $data->values(KvSchema::PASSWORD_CATEGORY);
            self::fail('Expected a failure.');
        } catch (NotFoundException $e) {
            self::assertSame(Reason::ExtensionNotInstalled, $e->reason());
            self::assertStringContainsString(KvSchema::EXTENSION_KEY, $e->getMessage());
        }
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function categories(): iterable
    {
        foreach ([KvSchema::PASSWORD_CATEGORY, KvSchema::SETTINGS_CATEGORY, KvSchema::ENCRYPTION_CATEGORY] as $category) {
            yield $category => [$category];
        }
    }

    #[DataProvider('categories')]
    public function testAMissingCategoryIsNamed(string $missing): void
    {
        $fake = new FakeChurchToolsClient();
        $others = array_values(array_diff([KvSchema::PASSWORD_CATEGORY, KvSchema::SETTINGS_CATEGORY, KvSchema::ENCRYPTION_CATEGORY], [$missing]));
        $fake->addModule(KvSchema::EXTENSION_KEY, $others);

        try {
            (new ExtensionData($fake))->values($missing);
            self::fail('Expected a ConfigurationException.');
        } catch (ConfigurationException $e) {
            self::assertSame(Reason::ExtensionNotInstalled, $e->reason());
            self::assertStringContainsString("'$missing'", $e->getMessage());
            self::assertSame(0, $fake->writeCount());
        }
    }
}
