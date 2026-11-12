<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Infrastructure\SelfCheck;

use CtPassStore\Infrastructure\Kv\ExtensionData;
use CtPassStore\Infrastructure\Kv\KvSchema;
use CtPassStore\Infrastructure\SelfCheck\ServiceUserRightsCheck;
use CtPassStore\Tests\Support\FakeChurchToolsClient;
use PHPUnit\Framework\TestCase;

/**
 * The service user has no more rights than needed (spec 4.8; catalog TS-03, TS-12).
 */
final class ServiceUserRightsCheckTest extends TestCase
{
    /**
     * The `churchdb` permissions of the minimal service user as measured on the test instance (design 9.1): the four
     * granted rights plus ChurchTools' default read values.
     */
    private const PERSONS_RIGHT = ['churchdb' => [
        'view' => true, 'view station' => [], 'view persons from campus' => [], 'view alldata' => [1],
        'security level person' => [1], 'security level view own data' => [1], 'security level edit own data' => [2],
        'create person' => false, 'write access' => false, 'delete persons' => false, 'view hidden persons' => true,
        'edit person visibility' => false, 'push/pull archive' => false, 'view archive' => true, 'view statistics' => false,
        'view person tags' => false, 'view comments' => [], 'export data' => false, 'edit bulkletter' => false,
        'create print labels' => false, 'send sms' => false, 'view person history' => false, 'edit relations' => false,
        'view memberliste' => false, 'complex filter' => false, 'administer global filters' => false,
        'edit masterdata' => false, 'view history' => false, 'view tags' => false, 'view group' => [11], 'edit group' => [],
        'delete group' => [], 'create groups of grouptype' => [], 'view groups of grouptype' => [],
        'edit groups of grouptype' => [], 'delete groups of grouptype' => [], 'edit group memberships of grouptype' => [],
        'edit group memberships of group' => [], 'administer groups' => false, 'security level group' => [],
        'edit group memberships' => false,
    ]];

    /** The `churchdb` rights that write, create, delete, export or administer (TS-12). */
    private const CHURCHDB_EXCESS = [
        'create person', 'write access', 'delete persons', 'edit person visibility', 'push/pull archive', 'export data',
        'edit bulkletter', 'create print labels', 'send sms', 'edit relations', 'administer global filters',
        'edit masterdata', 'edit group', 'delete group', 'create groups of grouptype', 'edit groups of grouptype',
        'delete groups of grouptype', 'edit group memberships of grouptype', 'edit group memberships of group',
        'administer groups', 'edit group memberships',
    ];

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

    // ---------------------------------------------------------------- churchdb (TS-12)

    /**
     * @param array<string, mixed> $churchdb overrides on top of the measured minimal churchdb permissions
     */
    private function checkChurchdb(array $churchdb): \CtPassStore\Application\SelfCheck\CheckOutcome
    {
        $this->fake->setServiceUserPermissions(['churchdb' => $churchdb + self::PERSONS_RIGHT['churchdb']] + $this->minimal());

        return (new ServiceUserRightsCheck($this->fake, new ExtensionData($this->fake)))->run();
    }

    /**
     * @return iterable<string, array{string, mixed}>
     */
    public static function grantedChurchdbRights(): iterable
    {
        foreach (self::CHURCHDB_EXCESS as $right) {
            yield "$right: true" => [$right, true];
            yield "$right: a list" => [$right, [3]];
        }
        // Anything but exactly false or [] counts as granted.
        foreach (['"false"' => 'false', 'null' => null, '0' => 0, '1' => 1, 'an object' => ['all' => true]] as $label => $value) {
            yield "write access: $label" => ['write access', $value];
            yield "edit group: $label" => ['edit group', $value];
        }
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('grantedChurchdbRights')]
    public function testAWritingChurchdbRightIsExcess(string $right, mixed $value): void
    {
        $result = $this->checkChurchdb([$right => $value]);

        self::assertFalse($result->ok);
        self::assertStringContainsString("more rights than needed: churchdb $right.", $result->message);
    }

    public function testTheMeasuredMinimalChurchdbRightsPass(): void
    {
        $result = $this->checkChurchdb([]);

        self::assertTrue($result->ok, $result->message);
    }

    public function testAbsentChurchdbRightsPass(): void
    {
        $this->fake->setServiceUserPermissions(['churchdb' => ['view' => true, 'view alldata' => [1], 'view archive' => true, 'view hidden persons' => true]] + $this->minimal());

        self::assertTrue((new ServiceUserRightsCheck($this->fake, new ExtensionData($this->fake)))->run()->ok);
    }

    /**
     * @return iterable<string, array{mixed}>
     */
    public static function highPersonSecurityLevels(): iterable
    {
        yield 'level 2' => [[2]];
        yield 'levels 1 and 2' => [[1, 2]];
        yield 'level 4' => [[1, 4]];
        yield 'a string' => [['2']];
        yield 'not a list' => [2];
        yield 'true' => [true];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('highPersonSecurityLevels')]
    public function testAPersonSecurityLevelAbove1IsExcess(mixed $levels): void
    {
        $result = $this->checkChurchdb(['security level person' => $levels]);

        self::assertFalse($result->ok);
        self::assertStringContainsString('more rights than needed: churchdb security level person above 1.', $result->message);
    }

    public function testPersonSecurityLevel1OrNoneIsFine(): void
    {
        self::assertTrue($this->checkChurchdb(['security level person' => [1]])->ok);
        self::assertTrue($this->checkChurchdb(['security level person' => []])->ok);
    }

    public function testSeveralExcessRightsAreListedTogether(): void
    {
        $result = $this->checkChurchdb(['write access' => true, 'security level person' => [1, 2, 3]]);

        self::assertStringContainsString('more rights than needed: churchdb write access, churchdb security level person above 1.', $result->message);
    }
}
