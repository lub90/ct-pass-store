<?php

namespace CtPassStore\Tests\EndToEnd;

/**
 * Class to manage the sandbox backend for end to end testing
 */
class ChurchToolsSandboxManager
{

    private static ?ChurchToolsSandboxManager $instance = null;

    public static function getInstance(string $fixturePath = __DIR__ . '/fixtures') {
        if (self::$instance === null) {
            self::$instance = new ChurchToolsSandboxManager($fixturePath);
        }
        return self::$instance;
    }


    private string $fixturePath;

    private function __construct(string $fixturePath = __DIR__ . '/fixtures')
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
