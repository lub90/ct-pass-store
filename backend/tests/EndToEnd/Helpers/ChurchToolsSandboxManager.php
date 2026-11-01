<?php

namespace CtPassStore\Tests\EndToEnd\Helpers;

use CtPassStore\Infrastructure\Kv\KvSchema;
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
            EndToEndPrerequisites::assertMet();
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
        $currentSettings = Helpers::getExtensionData()->values(KvSchema::SETTINGS_CATEGORY);

        if (!is_array($currentSettings)) {
            throw new \RuntimeException('Expected current settings to be an array, got ' . gettype($currentSettings));
        }

        if (!empty($currentSettings)) {
            throw new \RuntimeException("Settings category '" . KvSchema::SETTINGS_CATEGORY . "' is not empty.");
        }

        Helpers::createEntry(KvSchema::SETTINGS_CATEGORY, $settings);
    }

    public function loadPublicKey(array $publicKey): void
    {
        $currentPublicKey = Helpers::getExtensionData()->values(KvSchema::ENCRYPTION_CATEGORY);

        if (!is_array($currentPublicKey)) {
            throw new \RuntimeException('Expected current public key to be an array, got ' . gettype($publicKey));
        }

        if (!empty($currentPublicKey)) {
            throw new \RuntimeException("Public key category '" . KvSchema::ENCRYPTION_CATEGORY . "' is not empty.");
        }

        Helpers::createEntry(KvSchema::ENCRYPTION_CATEGORY, $publicKey);
    }

    public function unloadSettings(): void
    {
        $currentSettings = Helpers::getExtensionData()->values(KvSchema::SETTINGS_CATEGORY)[0];
        Helpers::getExtensionData()->delete(KvSchema::SETTINGS_CATEGORY, $currentSettings['id']);
    }

    public function unloadPublicKey(): void
    {
        $currentPublicKey = Helpers::getExtensionData()->values(KvSchema::ENCRYPTION_CATEGORY)[0];
        Helpers::getExtensionData()->delete(KvSchema::ENCRYPTION_CATEGORY, $currentPublicKey['id']);
    }

    public function checkPwdDatabase(): void
    {
        $entries = Helpers::getExtensionData()->values(KvSchema::PASSWORD_CATEGORY);

        if (!is_array($entries)) {
            throw new \RuntimeException('Expected pwd store category data to be an array, got ' . gettype($entries));
        }

        if (!empty($entries)) {
            throw new \RuntimeException('Pwd store is not empty!');
        }
    }

    public function cleanPwdDatabase(): void
    {
        $entries = Helpers::getExtensionData()->values(KvSchema::PASSWORD_CATEGORY);

        if (!is_array($entries)) {
            throw new \RuntimeException('Expected pwd store category data to be an array, got ' . gettype($entries));
        }

        foreach ($entries as $entry) {
            if (!isset($entry['id'])) {
                throw new \RuntimeException("Pwd store entry is missing 'id' field");
            }

            Helpers::getExtensionData()->delete(KvSchema::PASSWORD_CATEGORY, $entry['id']);
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

            // Log the user in with a session cookie, then fetch the user's login token
            $httpClient = new Client([
                'base_uri' => rtrim((string) getenv('CT_API_URL'), '/') . '/',
                'cookies' => new CookieJar(),
            ]);
            $httpClient->post('login', ['json' => [
                'username' => $user['username'],
                'password' => $user['pwd'],
                'rememberMe' => false,
            ]]);
            $tokenResponse = json_decode((string) $httpClient->get('persons/' . (int) $user['id'] . '/logintoken')->getBody(), true);

            $data[$i]['token'] = $tokenResponse['data'] ?? throw new \RuntimeException("Could not get a login token for user {$user['username']}.");
        }

        return $data;
    }

}
