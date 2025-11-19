<?php

namespace CtPassStore\Tests\EndToEnd\Helpers;

use ChurchTools\Api\GeneralApi;
use ChurchTools\Api\PersonApi;
use ChurchTools\Configuration;
use ChurchTools\Model\PostLoginRequest;
use CtPassStore\Config\AppConfig;
use CtPassStore\Service\ExtensionDataService;
use CtPassStore\Tests\Helpers\Helpers;
use GuzzleHttp\Client;
use GuzzleHttp\Cookie\CookieJar;

/**
 * Class to manage the sandbox backend for end to end testing
 */
class ChurchToolsSandboxManager
{
    private static ?ChurchToolsSandboxManager $instance = null;

    private string $fixturePath;


    private ?array $adminUsers;

    private ?array $normalUsers;

    private ?array $readAccessUsers;

    private ?array $noAccessAllowedUsers;

    public static function getInstance(string $fixturePath = __DIR__ . '/../fixtures'): ChurchToolsSandboxManager
    {
        if (self::$instance === null) {
            self::$instance = new ChurchToolsSandboxManager($fixturePath);
        }
        return self::$instance;
    }

    private function __construct(string $fixturePath = __DIR__ . '/../fixtures')
    {
        $this->fixturePath = rtrim($fixturePath, '/');
        // Load the user data...
        $this->adminUsers = $this->loadUsersFromFixture('admin_users.json');
        $this->normalUsers = $this->loadUsersFromFixture('normal_users.json');
        $this->readAccessUsers = $this->loadUsersFromFixture('read_access_users.json');
        $this->noAccessAllowedUsers = $this->loadUsersFromFixture('no_access_allowed_users.json');
    }

    public function loadSettings(array $settings): void
    {
        $currentSettings = Helpers::getExtensionDataService()->getCategoryData(AppConfig::CT_SETTINGS_CATEGORY_NAME);

        if (!is_array($currentSettings)) {
            throw new \RuntimeException("Expected current settings to be an array, got " . gettype($currentSettings));
        }

        if (!empty($currentSettings)) {
            throw new \RuntimeException("Settings category '" . AppConfig::CT_SETTINGS_CATEGORY_NAME . "' is not empty.");
        }

        Helpers::getExtensionDataService()->createCategoryEntry(AppConfig::CT_SETTINGS_CATEGORY_NAME, $settings);
    }

    public function loadPublicKey(array $publicKey): void
    {
        $currentPublicKey = Helpers::getExtensionDataService()->getCategoryData(AppConfig::CT_ENCRYPTION_SETTINGS_CATEGORY_NAME);

        if (!is_array($currentPublicKey)) {
            throw new \RuntimeException("Expected current public key to be an array, got " . gettype($publicKey));
        }

        if (!empty($currentPublicKey)) {
            throw new \RuntimeException("Public key category '" . AppConfig::CT_ENCRYPTION_SETTINGS_CATEGORY_NAME . "' is not empty.");
        }

        Helpers::getExtensionDataService()->createCategoryEntry(AppConfig::CT_ENCRYPTION_SETTINGS_CATEGORY_NAME, $publicKey);
    }

    public function unloadSettings(): void
    {
        $currentSettings = Helpers::getExtensionDataService()->getCategoryData(AppConfig::CT_SETTINGS_CATEGORY_NAME, true);
        Helpers::getExtensionDataService()->deleteCategoryEntry(AppConfig::CT_SETTINGS_CATEGORY_NAME, $currentSettings['id']);
    }

    public function unloadPublicKey(): void
    {
        $currentPublicKey = Helpers::getExtensionDataService()->getCategoryData(AppConfig::CT_ENCRYPTION_SETTINGS_CATEGORY_NAME, true);
        Helpers::getExtensionDataService()->deleteCategoryEntry(AppConfig::CT_ENCRYPTION_SETTINGS_CATEGORY_NAME, $currentPublicKey['id']);
    }

    public function checkPwdDatabase(): void
    {
        $entries = Helpers::getExtensionDataService()->getCategoryData(AppConfig::CT_PWD_CATEGORY_NAME);

        if (!is_array($entries)) {
            throw new \RuntimeException("Expected pwd store category data to be an array, got " . gettype($entries));
        }

        if (!empty($entries)) {
            throw new \RuntimeException("Pwd store is not empty!");
        }
    }

    public function cleanPwdDatabase(): void
    {
        $entries = Helpers::getExtensionDataService()->getCategoryData(AppConfig::CT_PWD_CATEGORY_NAME);

        if (!is_array($entries)) {
            throw new \RuntimeException("Expected pwd store category data to be an array, got " . gettype($entries));
        }

        foreach ($entries as $entry) {
            if (!isset($entry['id'])) {
                throw new \RuntimeException("Pwd store entry is missing 'id' field");
            }

            Helpers::getExtensionDataService()->deleteCategoryEntry(AppConfig::CT_PWD_CATEGORY_NAME, $entry['id']);
        }
    }

    public function getNormalUsers(): array
    {
        return $this->normalUsers;
    }

    public function getAdminUsers(): array
    {
        return $this->adminUsers;
    }

    public function getReadAccessUsers(): array
    {
        return $this->readAccessUsers;
    }

    public function getNoAccessAllowedUsers(): array
    {
        return $this->noAccessAllowedUsers;
    }

    public function getInvalidAccessTokens(): array
    {
        $filename = 'invalid_tokens.json';

        $data = $this->loadFixture($filename);
        foreach ($data as $user) {
            if (!isset($user['token'])) {
                throw new \RuntimeException("Each entry in the invalid token test fixtures must have 'token' fields in $filename");
            }
        }
        return $data;
    }


    private function loadFixture(string $filename): array
    {
        $path = $this->fixturePath . '/' . $filename;

        if (!file_exists($path)) {
            throw new \RuntimeException("Fixture file not found: $path");
        }

        $json = file_get_contents($path);
        $data = json_decode($json, true);

        if (empty($data)) {
            throw new \RuntimeException("Fixture file '$filename' is empty.");
        }

        if (!is_array($data)) {
            throw new \RuntimeException("Invalid JSON format in fixture: $filename");
        }

        return $data;
    }

    private function loadUsersFromFixture(string $filename, bool $ignoreUserId = false): array
    {
        $data = $this->loadFixture($filename);

        foreach ($data as $i => $user) {
            if (!isset($user['id'], $user['pwd'], $user['username'])) {
                throw new \RuntimeException("Each user must have 'id', 'username' and 'pwd' fields in $filename");
            }

            // Log the user in
            // Create a shared cookie jar
            $cookieJar = new CookieJar();
            $httpClient = new Client([
                'cookies' => $cookieJar,
            ]);
            $ctClientConfig = (new Configuration())->setHost(getenv('CT_API_URL'));
            $ctGeneralClient = new GeneralApi($httpClient, $ctClientConfig);
            $loginRequest = new PostLoginRequest();
            $loginRequest->setUsername($user['username']);
            $loginRequest->setPassword($user['pwd']);
            $loginRequest->setRememberMe(false);
            $ctGeneralClient->postLogin($loginRequest);

            // Get the users access token
            $ctPersonClient = new PersonApi($httpClient, $ctClientConfig);
            $accessToken = $ctPersonClient->getPersonsIdLogintoken($user['id']);

            $data[$i]['token'] = $accessToken->getData();
        }

        return $data;
    }

}
