<?php

namespace CtPassStore\Tests\EndToEnd;

use CtPassStore\Config\AppConfig;
use CtPassStore\Tests\EndToEnd\Helpers\AbstractTestPrototype;
use CtPassStore\Tests\EndToEnd\Helpers\ChurchToolsSandboxManager;
use CtPassStore\Tests\EndToEnd\Helpers\PersistenceChecker;
use CtPassStore\Service\ExtensionDataService;
use CtPassStore\Tests\Helpers\Helpers;


class EntriesGetTest extends AbstractTestPrototype {


    public function getSettingsPath(): string
    {
        return __DIR__ . '/../settings/false_false_12.json';
    }

    public function getEndpoint(): string {
        return "entries";
    }

    
    /**
     * @dataProvider normalAccessProvider
     */
    public function testNormalAccessMatrix(int $userId, string $token, int $targetId, bool $hasAccess): void
    {
        // 1. Create entries in pwd_category for each user
        $ctConfig = Helpers::getConfiguration();
        $extensionDataService = new ExtensionDataService($ctConfig, AppConfig::CT_EXTENSION_ID);

        // For simplicity, we generate a deterministic password per target user
        $password = "pwd-for-user-" . $targetId;

        $extensionDataService->createCategoryEntry(AppConfig::CT_PWD_CATEGORY_NAME, [
            AppConfig::CT_PERSON_ID_PWD_FIELD => $targetId,
            AppConfig::CT_ENCRYPTED_PWD_FIELD => $password,
        ]);

        // 2. Save current database state
        $persCheck = new PersistenceChecker(AppConfig::CT_PWD_CATEGORY_NAME);
        $persCheck->saveStatus();

        // 3. Perform GET request as acting user
        $client = $this->getClient();
        $response = $client->get($this->getEndpoint() . '/' . $targetId, [
            'headers' => ['Authorization' => self::AUTH_HEADER_PREFIX . $token]
        ]);

        print_r($this->getEndpoint() . '/' . $targetId);
        print_r((string) $response->getBody());

        if ($hasAccess) {
            // 4a. Allowed → expect 200 and correct password in body
            $this->assertSame(200, $response->getStatusCode(), "Expected 200 for user $userId accessing $targetId");

            $body = json_decode((string) $response->getBody(), true);
            $this->assertIsArray($body);
            $this->assertArrayHasKey('secondaryPwd', $body);
            $this->assertSame($password, $body['secondaryPwd'], "Password mismatch for user $userId accessing $targetId");
        } else {
            // 4b. Not allowed → expect 401/403
            $this->assertSame(403, $response->getStatusCode(), "Expected 403 for user $userId accessing $targetId"
            );
        }

        // 5. Ensure database state unchanged
        $persCheck->assertUnchanged();
    }

    public static function normalAccessProvider(): array
    {
        $ct = ChurchToolsSandboxManager::getInstance();

        $normalUsers      = $ct->getNormalUsers();
        $adminUsers       = $ct->getAdminUsers();
        $readAccessUsers  = $ct->getReadAccessUsers();

        // Collect all users together for "targets"
        $allUsers = array_merge($normalUsers, $adminUsers, $readAccessUsers);

        $cases = [];

        // Normal users: only allowed to access their own id
        foreach ($normalUsers as $user) {
            foreach ($allUsers as $target) {
                $hasAccess = ($user['id'] === $target['id']);
                $cases["normal user {$user['id']} accessing {$target['id']}"] = [
                    'userId'       => $user['id'],
                    'token'        => $user['token'],
                    'targetId'     => $target['id'],
                    'hasAccess'    => $hasAccess,
                ];
            }
        }

        // Admin users: allowed to access all ids
        foreach ($adminUsers as $user) {
            foreach ($allUsers as $target) {
                $cases["admin user {$user['id']} accessing {$target['id']}"] = [
                    'userId'       => $user['id'],
                    'token'        => $user['token'],
                    'targetId'     => $target['id'],
                    'hasAccess'    => true,
                ];
            }
        }

        // Read access users: allowed to access all ids
        foreach ($readAccessUsers as $user) {
            foreach ($allUsers as $target) {
                $cases["read access user {$user['id']} accessing {$target['id']}"] = [
                    'userId'       => $user['id'],
                    'token'        => $user['token'],
                    'targetId'     => $target['id'],
                    'hasAccess'    => true,
                ];
            }
        }

        return $cases;
    }


}

    