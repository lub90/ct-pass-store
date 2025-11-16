<?php

namespace CtPassStore\Tests\EndToEnd\Helpers;

use CtPassStore\Config\AppConfig;
use CtPassStore\Service\ExtensionDataService;
use CtPassStore\Tests\Helpers\Helpers;

/**
 * Class to manage the sandbox backend for end to end testing
 */
class ChurchToolsSandboxManager
{

    private static ?ChurchToolsSandboxManager $instance = null;

    public static function getInstance(string $fixturePath = __DIR__ . '/../fixtures') {
        if (self::$instance === null) {
            self::$instance = new ChurchToolsSandboxManager($fixturePath);
        }
        return self::$instance;
    }


    private string $fixturePath;

    private function __construct(string $fixturePath = __DIR__ . '/../fixtures')
    {
        $this->fixturePath = rtrim($fixturePath, '/');
    }

    public function start(): void
    {
        // TODO: Later on, we can implement an automatic setup of the sandbox ChurchTools backend here
    }

    public function stop(): void
    {
        // TODO: Later on, we can implement an automatic tear down of the sandbox Churchtools backend here...
    }

    public function loadSettings(array $settings): void {
        $ctConfig = Helpers::getConfiguration();

        $extensionDataService = new ExtensionDataService($ctConfig, AppConfig::CT_EXTENSION_ID);

        $currentSettings = $extensionDataService->getCategoryData(AppConfig::CT_SETTINGS_CATEGORY_NAME);

        // Ensure it's an array
        if (!is_array($currentSettings)) {
            throw new \RuntimeException("Expected current settings to be an array, got " . gettype($currentSettings));
        }

        // Ensure it's empty
        if (!empty($currentSettings)) {
            throw new \RuntimeException("Settings category '" . AppConfig::CT_SETTINGS_CATEGORY_NAME . "' is not empty.");
        }

        $extensionDataService->createCategoryEntry(AppConfig::CT_SETTINGS_CATEGORY_NAME, $settings);
    }

    public function unloadSettings(): void {
        $ctConfig = Helpers::getConfiguration();
        $extensionDataService = new ExtensionDataService($ctConfig, AppConfig::CT_EXTENSION_ID);
        $currentSettings = $extensionDataService->getCategoryData(AppConfig::CT_SETTINGS_CATEGORY_NAME, true);
        $extensionDataService->deleteCategoryEntry(AppConfig::CT_SETTINGS_CATEGORY_NAME, $currentSettings['id']);
    }

    public function checkPwdDatabase(): void {
        $ctConfig = Helpers::getConfiguration();
        $extensionDataService = new ExtensionDataService($ctConfig, AppConfig::CT_EXTENSION_ID);

        // Query all entries in the pwd store category
        $entries = $extensionDataService->getCategoryData(AppConfig::CT_PWD_CATEGORY_NAME);

        if (!is_array($entries)) {
            throw new \RuntimeException(
                "Expected pwd store category data to be an array, got " . gettype($entries)
            );
        }

        if (!empty($entrie)) {
            throw new \RuntimeException(
                "Pwd store is not empty!"
            );
        }
    }

    public function cleanPwdDatabase(): void {
        $ctConfig = Helpers::getConfiguration();
        $extensionDataService = new ExtensionDataService($ctConfig, AppConfig::CT_EXTENSION_ID);

        // Query all entries in the pwd store category
        $entries = $extensionDataService->getCategoryData(AppConfig::CT_PWD_CATEGORY_NAME);

        if (!is_array($entries)) {
            throw new \RuntimeException(
                "Expected pwd store category data to be an array, got " . gettype($entries)
            );
        }

        // Delete each entry by its id
        foreach ($entries as $entry) {
            if (!isset($entry['id'])) {
                throw new \RuntimeException("Pwd store entry is missing 'id' field");
            }

            $extensionDataService->deleteCategoryEntry(AppConfig::CT_PWD_CATEGORY_NAME, $entry['id']);
        }
    }


    public function getNormalUsers(): array
    {
        return $this->loadUsersFromFixture('normal_users.json');
    }

    public function getAdminUsers(): array
    {
        return $this->loadUsersFromFixture('admin_users.json');
    }

    public function getReadAccessUsers(): array
    {
        return $this->loadUsersFromFixture('read_access_users.json');
    }

    public function getNoAccessAllowedUsers(): array
    {
        return $this->loadUsersFromFixture('no_access_allowed_users.json');
    }

    public function getInvalidAccessTokens(): array
    {
        return $this->loadUsersFromFixture('invalid_tokens.json', true);
    }

    private function loadUsersFromFixture(string $filename, bool $ignoreUserId = false): array
    {
        $path = $this->fixturePath . '/' . $filename;

        if (!file_exists($path)) {
            throw new \RuntimeException("Fixture file not found: $path");
        }

        $json = file_get_contents($path);
        $data = json_decode($json, true);

        if (empty($data)) {
            throw new \RuntimeException("Fixture file '$filename' is empty or contains no valid users.");
        }

        if (!is_array($data)) {
            throw new \RuntimeException("Invalid JSON format in fixture: $filename");
        }

        foreach ($data as $user) {
            if (!$ignoreUserId) {
                if (!isset($user['id'], $user['token'])) {
                    throw new \RuntimeException("Each user must have 'id' and 'token' fields in $filename");
                }
            } else {
                if (!isset($user['token'])) {
                    throw new \RuntimeException("Each array entry must have at least a 'token' field in $filename");
                }
            }
        }

        return $data;
    }
}
