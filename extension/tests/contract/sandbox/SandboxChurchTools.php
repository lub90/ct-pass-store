<?php

declare(strict_types=1);

namespace CtPassStore\ContractSandbox;

use CtPassStore\Infrastructure\ChurchTools\ChurchToolsClient;
use CtPassStore\Infrastructure\ChurchTools\Credential;
use CtPassStore\Infrastructure\ChurchTools\LoginResult;
use CtPassStore\Infrastructure\ChurchTools\Permissions;
use CtPassStore\Infrastructure\ChurchTools\PersonStatus;
use CtPassStore\Infrastructure\ChurchTools\WhoAmI;

/**
 * Test-only (extension contract tests, never part of the backend): the sandbox's view of the extension's KV data,
 * so the backend can be run in other settings than the test instance has, without changing the instance.
 *
 * - `CPS_SANDBOX_SETTINGS`: a JSON object with `requirePasswordForPasswordChange` and/or `allowCustomPassword`
 *   (booleans, nothing else). These keys replace the ones in the instance's `settings` value as the backend reads it
 *   (category `CPS_SANDBOX_SETTINGS_CATEGORY_ID`); every other setting stays the instance's.
 * - `CPS_SANDBOX_ADMIN_GROUP_ID`: the backend sees an `access` category whose only value names this group as the
 *   admin group (and no machine client), instead of the instance's (the test instance has none). Who is in the group
 *   is still read from ChurchTools with the user's own token.
 *
 * Without either variable the real client is used as it is. A malformed value is refused (the sandbox answers 500
 * and the test doesn't start). The sandbox never writes these two categories: a write to them is refused here.
 */
final class SandboxChurchTools implements ChurchToolsClient
{
    /** The id of the `access` category the sandbox makes up; negative, so it can't be a real one. */
    public const ACCESS_CATEGORY_ID = -1;

    private const SETTINGS_KEYS = ['requirePasswordForPasswordChange', 'allowCustomPassword'];

    /**
     * @param array<string, bool> $settings
     */
    private function __construct(
        private readonly ChurchToolsClient $inner,
        private readonly array $settings,
        private readonly ?int $settingsCategoryId,
        private readonly ?int $adminGroupId,
    ) {}

    /**
     * @param array<string, string|false> $env the variables, as `getenv()` gives them
     * @throws \InvalidArgumentException for a malformed value
     */
    public static function wrap(ChurchToolsClient $inner, array $env): ChurchToolsClient
    {
        $rawSettings = self::present($env['CPS_SANDBOX_SETTINGS'] ?? false);
        $rawAdminGroup = self::present($env['CPS_SANDBOX_ADMIN_GROUP_ID'] ?? false);
        if ($rawSettings === null && $rawAdminGroup === null) {
            return $inner;
        }

        $settings = [];
        $categoryId = null;
        if ($rawSettings !== null) {
            $decoded = json_decode($rawSettings, true);
            if (!is_array($decoded) || array_is_list($decoded)) {
                throw new \InvalidArgumentException('CPS_SANDBOX_SETTINGS must be a non-empty JSON object.');
            }
            foreach ($decoded as $key => $value) {
                if (!in_array($key, self::SETTINGS_KEYS, true) || !is_bool($value)) {
                    throw new \InvalidArgumentException('CPS_SANDBOX_SETTINGS may only set ' . implode(' and ', self::SETTINGS_KEYS) . ', as booleans.');
                }
                $settings[$key] = $value;
            }
            $categoryId = self::positiveInt($env['CPS_SANDBOX_SETTINGS_CATEGORY_ID'] ?? false, 'CPS_SANDBOX_SETTINGS_CATEGORY_ID');
        }
        $adminGroupId = $rawAdminGroup === null ? null : self::positiveInt($rawAdminGroup, 'CPS_SANDBOX_ADMIN_GROUP_ID');

        return new self($inner, $settings, $categoryId, $adminGroupId);
    }

    private static function present(string|false $value): ?string
    {
        return $value === false || $value === '' ? null : $value;
    }

    private static function positiveInt(string|false $value, string $name): int
    {
        if (!is_string($value) || preg_match('/^[1-9][0-9]{0,17}$/', $value) !== 1) {
            throw new \InvalidArgumentException("$name must be a positive whole number.");
        }

        return (int) $value;
    }

    public function getCategories(int $moduleId): array
    {
        $categories = $this->inner->getCategories($moduleId);
        if ($this->adminGroupId === null) {
            return $categories;
        }
        $categories = array_values(array_filter($categories, static fn(array $c): bool => ($c['name'] ?? null) !== 'access'));
        $categories[] = ['id' => self::ACCESS_CATEGORY_ID, 'customModuleId' => $moduleId, 'name' => 'access', 'shorty' => 'access'];

        return $categories;
    }

    public function getValues(int $moduleId, int $categoryId): array
    {
        if ($this->adminGroupId !== null && $categoryId === self::ACCESS_CATEGORY_ID) {
            $access = ['groups' => ['admins' => ['groupId' => $this->adminGroupId]], 'machineClients' => []];

            return [['id' => self::ACCESS_CATEGORY_ID, 'dataCategoryId' => self::ACCESS_CATEGORY_ID, 'value' => json_encode($access, JSON_THROW_ON_ERROR)]];
        }
        $values = $this->inner->getValues($moduleId, $categoryId);
        if ($this->settingsCategoryId === null || $categoryId !== $this->settingsCategoryId) {
            return $values;
        }

        return array_map(function (array $v): array {
            // Anything that isn't a JSON object stays as it is: the backend's own checks report it.
            $decoded = is_string($v['value'] ?? null) ? json_decode($v['value'], false) : null;
            if ($decoded instanceof \stdClass) {
                foreach ($this->settings as $key => $value) {
                    $decoded->{$key} = $value;
                }
                $v['value'] = json_encode($decoded, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            }

            return $v;
        }, $values);
    }

    public function createValue(int $moduleId, int $categoryId, string $value): int
    {
        $this->refuseOverridden($categoryId);

        return $this->inner->createValue($moduleId, $categoryId, $value);
    }

    public function updateValue(int $moduleId, int $categoryId, int $valueId, string $value): void
    {
        $this->refuseOverridden($categoryId);
        $this->inner->updateValue($moduleId, $categoryId, $valueId, $value);
    }

    public function deleteValue(int $moduleId, int $categoryId, int $valueId): void
    {
        $this->refuseOverridden($categoryId);
        $this->inner->deleteValue($moduleId, $categoryId, $valueId);
    }

    private function refuseOverridden(int $categoryId): void
    {
        if ($categoryId === $this->settingsCategoryId || ($this->adminGroupId !== null && $categoryId === self::ACCESS_CATEGORY_ID)) {
            throw new \LogicException('The backend sandbox never writes the settings or access it overrides.');
        }
    }

    public function exchangeAuthorizationCode(string $clientId, #[\SensitiveParameter] string $clientSecret, #[\SensitiveParameter] string $code, string $redirectUri, #[\SensitiveParameter] string $codeVerifier): string
    {
        return $this->inner->exchangeAuthorizationCode($clientId, $clientSecret, $code, $redirectUri, $codeVerifier);
    }

    public function whoami(Credential $user): WhoAmI
    {
        return $this->inner->whoami($user);
    }

    public function globalPermissions(Credential $user): Permissions
    {
        return $this->inner->globalPermissions($user);
    }

    public function activeGroupIds(Credential $user, int $personId): array
    {
        return $this->inner->activeGroupIds($user, $personId);
    }

    public function serviceUserGlobalPermissions(): Permissions
    {
        return $this->inner->serviceUserGlobalPermissions();
    }

    public function verifyLogin(string $username, #[\SensitiveParameter] string $password): ?LoginResult
    {
        return $this->inner->verifyLogin($username, $password);
    }

    public function personStatus(int $personId): PersonStatus
    {
        return $this->inner->personStatus($personId);
    }

    public function activePersonIds(array $personIds): array
    {
        return $this->inner->activePersonIds($personIds);
    }

    public function personDepartmentIds(): array
    {
        return $this->inner->personDepartmentIds();
    }

    public function getModuleByKey(string $key): array
    {
        return $this->inner->getModuleByKey($key);
    }
}
