<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Support;

use CtPassStore\Infrastructure\ChurchTools\ChurchToolsClient;
use CtPassStore\Infrastructure\ChurchTools\Credential;
use CtPassStore\Infrastructure\ChurchTools\Exception\NotAuthenticatedException;
use CtPassStore\Infrastructure\ChurchTools\Exception\NotFoundException;
use CtPassStore\Infrastructure\ChurchTools\Exception\OAuthClientRejectedException;
use CtPassStore\Infrastructure\ChurchTools\Exception\OAuthCodeRejectedException;
use CtPassStore\Infrastructure\ChurchTools\LoginResult;
use CtPassStore\Infrastructure\Kv\KvSchema;
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

    /**
     * The backend's OAuth client, or null if it isn't configured (the OAuth cases are then skipped).
     *
     * @return array{id: string, secret: string, redirectUri: string}|null
     */
    abstract protected function oauthClient(): ?array;

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
        $id = $this->client()->getModuleByKey(KvSchema::EXTENSION_KEY)['id'] ?? null;
        self::assertIsInt($id);

        return $id;
    }

    private function passwordStoreId(): int
    {
        foreach ($this->client()->getCategories($this->moduleId()) as $category) {
            if (($category['name'] ?? null) === KvSchema::PASSWORD_CATEGORY) {
                self::assertIsInt($category['id']);

                return $category['id'];
            }
        }
        self::fail('The passwordStore category is missing.');
    }

    private function testValue(string $marker): string
    {
        return json_encode([KvSchema::ENTRY_PERSON_ID => 0, KvSchema::ENTRY_CIPHERTEXT => $marker], JSON_THROW_ON_ERROR);
    }

    // ---------------------------------------------------------------- module and categories

    public function testModuleIsFoundByItsKeyWithAnIntegerId(): void
    {
        $module = $this->client()->getModuleByKey(KvSchema::EXTENSION_KEY);

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
        foreach ([KvSchema::PASSWORD_CATEGORY, KvSchema::SETTINGS_CATEGORY, KvSchema::ENCRYPTION_CATEGORY] as $required) {
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

    /**
     * CT-08: a write that loses the race against a delete must be recognizable, so the store can create the entry
     * again instead of failing (spec 5.3.6).
     */
    public function testUpdatingAMissingValueIsNotFound(): void
    {
        $module = $this->moduleId();
        $category = $this->passwordStoreId();
        $id = $this->client()->createValue($module, $category, $this->testValue('contract-update-deleted'));
        $this->client()->deleteValue($module, $category, $id);

        try {
            $this->client()->updateValue($module, $category, $id, $this->testValue('contract-update-deleted-2'));
            self::fail('Updating a deleted value must fail with NotFoundException.');
        } catch (NotFoundException) {
            self::assertNull($this->valueById($id), 'The update must not bring the value back.');
        }
    }

    /**
     * AX-12: an unknown code gives the "code rejected" error, not a misconfiguration (spec 4.4.2).
     */
    public function testAnUnknownAuthorizationCodeIsRejected(): void
    {
        $oauth = $this->oauthClient() ?? self::markTestSkipped('Add OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET to config/credentials.php for the OAuth cases.');

        $this->expectException(OAuthCodeRejectedException::class);
        $this->client()->exchangeAuthorizationCode($oauth['id'], $oauth['secret'], 'not-a-real-code-' . bin2hex(random_bytes(8)), $oauth['redirectUri'], str_repeat('v', 43));
    }

    /**
     * A wrong client secret is a misconfiguration (500), never "code invalid" (spec 4.4.2, catalog AX-05).
     */
    public function testAWrongClientSecretIsRejectedAsClient(): void
    {
        $oauth = $this->oauthClient() ?? self::markTestSkipped('Add OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET to config/credentials.php for the OAuth cases.');

        $this->expectException(OAuthClientRejectedException::class);
        $this->client()->exchangeAuthorizationCode($oauth['id'], 'wrong-secret-' . bin2hex(random_bytes(8)), 'not-a-real-code', $oauth['redirectUri'], str_repeat('v', 43));
    }

    /**
     * An unknown client ID is a misconfiguration (500), never "code invalid" or "not found" (spec 4.4.2). ChurchTools
     * answers it with its own 404 (`error.notfound`), not with an OAuth error (measured 2026-11-10). Needs no OAuth
     * credentials, so it always runs.
     */
    public function testAnUnknownClientIdIsRejectedAsClient(): void
    {
        $this->expectException(OAuthClientRejectedException::class);
        $redirectUri = $this->oauthClient()['redirectUri'] ?? 'https://example.church.tools/ccm/ctpassstore/';
        $this->client()->exchangeAuthorizationCode('unknown-client-' . bin2hex(random_bytes(8)), 'any-secret', 'not-a-real-code', $redirectUri, str_repeat('v', 43));
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
        // WhoAmI can only be built from an integer id and a string cmsUserId.
        $person = $this->client()->whoami($this->validUserCredential());

        self::assertGreaterThan(0, $person->id);
        self::assertNotSame('', $person->username);
    }

    public function testGlobalPermissionsHaveTheExtensionsViewFlag(): void
    {
        $permissions = $this->client()->globalPermissions($this->validUserCredential())->of(KvSchema::EXTENSION_KEY);

        self::assertIsArray($permissions);
        self::assertIsBool($permissions['view'] ?? null);
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
