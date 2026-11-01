<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Support;

use CtPassStore\ChurchTools\ChurchToolsClient;
use CtPassStore\ChurchTools\Credential;
use CtPassStore\ChurchTools\Exception\NotAuthenticatedException;
use CtPassStore\ChurchTools\Exception\NotFoundException;
use CtPassStore\ChurchTools\LoginResult;
use CtPassStore\Config\AppConfig;
use PHPUnit\Framework\TestCase;

/**
 * The contract between the backend and ChurchTools (catalog CT-06, CT-06a, CT-01, CT-03, CC-10, CC-11, ST-16,
 * PP-10).
 *
 * The same cases run against the real ChurchTools (end-to-end layer) and against the fake (unit layer), so the fake
 * that the API tests rely on can't drift from real ChurchTools.
 *
 * Writes use only the reserved person ID 0 (spec 5.3.11) and are removed again.
 */
abstract class ChurchToolsClientContractTestCase extends TestCase
{
    /** The client under test, with the service user's credential. */
    abstract protected function client(): ChurchToolsClient;

    /** A user credential that ChurchTools accepts. */
    abstract protected function validUserCredential(): Credential;

    /**
     * A user who can log in with a password.
     *
     * @return array{username: string, password: string, personId: int}
     */
    abstract protected function loginUser(): array;

    /** @var list<int> value IDs to delete after the test */
    private array $created = [];

    protected function tearDown(): void
    {
        foreach ($this->created as $valueId) {
            try {
                $this->client()->deleteValue($this->moduleId(), $this->passwordStoreId(), $valueId);
            } catch (NotFoundException) {
                // already deleted by the test
            }
        }
        $this->created = [];
    }

    private function moduleId(): int
    {
        $id = $this->client()->getModuleByKey(AppConfig::CT_EXTENSION_ID)['id'] ?? null;
        self::assertIsInt($id);

        return $id;
    }

    private function passwordStoreId(): int
    {
        foreach ($this->client()->getCategories($this->moduleId()) as $category) {
            if (($category['name'] ?? null) === AppConfig::CT_PWD_CATEGORY_NAME) {
                self::assertIsInt($category['id']);

                return $category['id'];
            }
        }
        self::fail('The passwordStore category is missing.');
    }

    private function testValue(string $marker): string
    {
        return json_encode([AppConfig::CT_PERSON_ID_PWD_FIELD => 0, AppConfig::CT_ENCRYPTED_PWD_FIELD => $marker], JSON_THROW_ON_ERROR);
    }

    // ---------------------------------------------------------------- module and categories

    public function testModuleIsFoundByItsKeyWithAnIntegerId(): void
    {
        $module = $this->client()->getModuleByKey(AppConfig::CT_EXTENSION_ID);

        self::assertIsInt($module['id'] ?? null);
        self::assertGreaterThan(0, $module['id']);
    }

    public function testUnknownModuleKeyIsNotFound(): void
    {
        $this->expectException(NotFoundException::class);
        $this->client()->getModuleByKey('ctpassstore-contract-does-not-exist');
    }

    public function testCategoriesHaveTheFieldsTheBackendReads(): void
    {
        $categories = $this->client()->getCategories($this->moduleId());

        $names = [];
        foreach ($categories as $category) {
            self::assertIsInt($category['id'] ?? null);
            self::assertIsInt($category['customModuleId'] ?? null);
            self::assertIsString($category['name'] ?? null);
            $names[] = $category['name'];
        }
        foreach ([AppConfig::CT_PWD_CATEGORY_NAME, AppConfig::CT_SETTINGS_CATEGORY_NAME, AppConfig::CT_ENCRYPTION_SETTINGS_CATEGORY_NAME] as $required) {
            self::assertContains($required, $names);
        }
    }

    public function testValuesHaveTheFieldsTheBackendReads(): void
    {
        foreach ($this->client()->getValues($this->moduleId(), $this->passwordStoreId()) as $value) {
            self::assertIsInt($value['id'] ?? null);
            self::assertIsString($value['value'] ?? null);
        }
    }

    // ---------------------------------------------------------------- writing values

    public function testCreateReadUpdateDeleteAValue(): void
    {
        $module = $this->moduleId();
        $category = $this->passwordStoreId();

        $id = $this->client()->createValue($module, $category, $this->testValue('contract-created'));
        $this->created[] = $id;
        self::assertGreaterThan(0, $id);
        self::assertSame($this->testValue('contract-created'), $this->valueById($id));

        $this->client()->updateValue($module, $category, $id, $this->testValue('contract-updated'));
        self::assertSame($this->testValue('contract-updated'), $this->valueById($id));

        $this->client()->deleteValue($module, $category, $id);
        self::assertNull($this->valueById($id));
    }

    public function testNewValuesGetHigherIdsThanExistingOnes(): void
    {
        $module = $this->moduleId();
        $category = $this->passwordStoreId();

        $first = $this->client()->createValue($module, $category, $this->testValue('contract-first'));
        $this->created[] = $first;
        $second = $this->client()->createValue($module, $category, $this->testValue('contract-second'));
        $this->created[] = $second;

        self::assertGreaterThan($first, $second);
        foreach ($this->client()->getValues($module, $category) as $value) {
            self::assertLessThanOrEqual($second, $value['id']);
        }
    }

    public function testDeletingAMissingValueIsNotFound(): void
    {
        $module = $this->moduleId();
        $category = $this->passwordStoreId();
        $id = $this->client()->createValue($module, $category, $this->testValue('contract-delete-twice'));
        $this->client()->deleteValue($module, $category, $id);

        $this->expectException(NotFoundException::class);
        $this->client()->deleteValue($module, $category, $id);
    }

    private function valueById(int $id): ?string
    {
        foreach ($this->client()->getValues($this->moduleId(), $this->passwordStoreId()) as $value) {
            if ($value['id'] === $id) {
                self::assertIsString($value['value']);

                return $value['value'];
            }
        }

        return null;
    }

    // ---------------------------------------------------------------- users

    public function testWhoamiHasIdAndUsername(): void
    {
        $person = $this->client()->whoami($this->validUserCredential());

        self::assertIsInt($person['id'] ?? null);
        self::assertGreaterThan(0, $person['id']);
        self::assertIsString($person['cmsUserId'] ?? null);
    }

    public function testGlobalPermissionsHaveTheExtensionsViewFlag(): void
    {
        $permissions = $this->client()->globalPermissions($this->validUserCredential());

        self::assertIsArray($permissions[AppConfig::CT_EXTENSION_ID] ?? null);
        self::assertIsBool($permissions[AppConfig::CT_EXTENSION_ID]['view'] ?? null);
    }

    public function testUnknownTokenIsNotAuthenticated(): void
    {
        $this->expectException(NotAuthenticatedException::class);
        $this->client()->whoami(Credential::loginToken('contract-test-unknown-token'));
    }

    public function testCorrectPasswordGivesThePersonId(): void
    {
        $user = $this->loginUser();

        $result = $this->client()->verifyLogin($user['username'], $user['password']);

        self::assertNotNull($result);
        self::assertSame($user['personId'], $result->personId);
        self::assertContains($result->status, [LoginResult::STATUS_SUCCESS, LoginResult::STATUS_TOTP, LoginResult::STATUS_TWO_FACTOR_SETUP]);
    }

    public function testWrongPasswordGivesNull(): void
    {
        $user = $this->loginUser();

        self::assertNull($this->client()->verifyLogin($user['username'], $user['password'] . '-wrong'));
    }
}
