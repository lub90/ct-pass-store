<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Infrastructure\SelfCheck;

use CtPassStore\Infrastructure\Kv\ExtensionData;
use CtPassStore\Infrastructure\Kv\KvSchema;
use CtPassStore\Infrastructure\SelfCheck\ServiceUserRightsCheck;
use CtPassStore\Tests\Support\FakeChurchToolsClient;
use PHPUnit\Framework\TestCase;

/**
 * The service user has no more rights than needed (spec 4.8; catalog TS-03).
 */
final class ServiceUserRightsCheckTest extends TestCase
{
    private const PERSONS_RIGHT = ['churchdb' => ['view' => true, 'view alldata' => [1], 'view archive' => true, 'view hidden persons' => true]];

    private FakeChurchToolsClient $fake;

    private int $settings;

    private int $encryption;

    private int $passwords;

    protected function setUp(): void
    {
        $this->fake = new FakeChurchToolsClient();
        $ids = $this->fake->addModule(KvSchema::EXTENSION_KEY, [KvSchema::SETTINGS_CATEGORY, KvSchema::ENCRYPTION_CATEGORY, KvSchema::PASSWORD_CATEGORY]);
        [$this->settings, $this->encryption, $this->passwords] = [$ids[KvSchema::SETTINGS_CATEGORY], $ids[KvSchema::ENCRYPTION_CATEGORY], $ids[KvSchema::PASSWORD_CATEGORY]];
    }

    /**
     * @param array<string, mixed> $overrides on top of the minimal service user
     * @return array<string, mixed>
     */
    private function minimal(array $overrides = []): array
    {
        $all = [$this->settings, $this->encryption, $this->passwords];

        return [KvSchema::EXTENSION_KEY => $overrides + [
            'view' => true,
            'view custom category' => $all,
            'view custom data' => $all,
            'create custom data' => [$this->passwords],
            'edit custom data' => [$this->passwords],
            'delete custom data' => [$this->passwords],
            'create custom category' => false,
            'edit custom category' => [],
            'delete custom category' => [],
        ]];
    }

    /**
     * @param array<string, mixed> $permissions
     */
    private function check(array $permissions): \CtPassStore\Application\SelfCheck\CheckOutcome
    {
        $this->fake->setServiceUserPermissions($permissions + self::PERSONS_RIGHT);

        return (new ServiceUserRightsCheck($this->fake, new ExtensionData($this->fake)))->run();
    }

    public function testAnAdministratorFailsNamingAllThreeRights(): void
    {
        $result = $this->check(['churchcore' => ['administer settings' => true, 'administer persons' => true, 'administer custom modules' => true]] + $this->minimal());

        self::assertFalse($result->ok);
        foreach (['administer settings', 'administer persons', 'administer custom modules'] as $right) {
            self::assertStringContainsString($right, $result->message);
        }
    }

    public function testAMinimalServiceUserPasses(): void
    {
        self::assertTrue($this->check($this->minimal())->ok);
    }

    public function testNoRightsAtAllFailOnlyForThePersonsRight(): void
    {
        $this->fake->setServiceUserPermissions([]);

        $result = (new ServiceUserRightsCheck($this->fake, new ExtensionData($this->fake)))->run();

        self::assertFalse($result->ok);
        self::assertStringContainsString("can't read persons (missing: churchdb view,", $result->message);
        self::assertStringNotContainsString('more rights than needed', $result->message);
    }

    public function testNoExtraRightsPass(): void
    {
        self::assertTrue($this->check([])->ok);
    }

    public function testFalseAdministrativeFlagsPass(): void
    {
        self::assertTrue($this->check(['churchcore' => ['administer settings' => false, 'administer persons' => false]] + $this->minimal())->ok);
    }

    public function testWritingTheSettingsCategoryFails(): void
    {
        $result = $this->check($this->minimal(['edit custom data' => [$this->settings, $this->passwords]]));

        self::assertFalse($result->ok);
        self::assertStringContainsString('edit custom data', $result->message);
    }

    public function testCreatingAndDeletingInOtherCategoriesFails(): void
    {
        foreach (['create custom data', 'delete custom data'] as $right) {
            $result = $this->check($this->minimal([$right => [$this->encryption]]));

            self::assertFalse($result->ok, $right);
            self::assertStringContainsString($right, $result->message);
        }
    }

    public function testCategoryRightsFail(): void
    {
        foreach (['create custom category' => true, 'edit custom category' => [$this->passwords], 'delete custom category' => [$this->passwords]] as $right => $value) {
            $result = $this->check($this->minimal([$right => $value]));

            self::assertFalse($result->ok, $right);
            self::assertStringContainsString($right, $result->message);
        }
    }

    public function testAMalformedRightFailsClosed(): void
    {
        $result = $this->check($this->minimal(['edit custom data' => 'all']));

        self::assertFalse($result->ok);
        self::assertStringContainsString('edit custom data', $result->message);
    }
}
