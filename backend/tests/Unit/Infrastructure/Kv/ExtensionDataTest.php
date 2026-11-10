<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Infrastructure\Kv;

use CtPassStore\Application\Exception\ConfigurationException;
use CtPassStore\Application\Failure\Reason;
use CtPassStore\Infrastructure\ChurchTools\Exception\NotFoundException;
use CtPassStore\Infrastructure\Kv\ExtensionData;
use CtPassStore\Infrastructure\Kv\KvSchema;
use CtPassStore\Tests\Support\FakeChurchToolsClient;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Catalog ST-19 (spec 5.3.10): a missing module or category is "extension not installed" (500 misconfigured), naming
 * what's missing, and never "no entry".
 */
final class ExtensionDataTest extends TestCase
{
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
