<?php

namespace CtPassStore\Tests\EndToEnd;

use CtPassStore\Config\AppConfig;
use CtPassStore\Tests\EndToEnd\Helpers\AbstractTestPrototype;
use CtPassStore\Tests\EndToEnd\Helpers\ChurchToolsSandboxManager;
use CtPassStore\Tests\EndToEnd\Helpers\PersistenceChecker;
use CtPassStore\Service\ExtensionDataService;
use CtPassStore\Tests\Helpers\Helpers;


class EntriesGetTest extends AbstractTestPrototype {

    protected ?ExtensionDataService $extensionDataService = null;

    public function getSettingsPath(): string
    {
        return __DIR__ . '/../settings/false_false_12.json';
    }

    public function getEndpoint(): string {
        return "entries";
    }

    protected function generateEntries(array $allPwdEntries): void {
        foreach($allPwdEntries as $entry) {
            // For simplicity, we generate a deterministic password per target user
            $password = $this->getPwdForUser($entry);

            Helpers::getExtensionDataService()->createCategoryEntry(AppConfig::CT_PWD_CATEGORY_NAME, [
                AppConfig::CT_PERSON_ID_PWD_FIELD => $entry,
                AppConfig::CT_ENCRYPTED_PWD_FIELD => $password,
            ]);
        }
    }

    protected function getPwdForUser(int $targetId): string {
        return "pwd-for-user-" . $targetId;
    }

    /**
     * @dataProvider normalAccessProvider
     */
    public function testNormalAccess(int $userId, string $token, int $targetId, bool $hasAccess, array $otherPwdEntryIds): void
    {
        // 1. Create entries in pwd_category for each user
        $allPwdEntries = [...$otherPwdEntryIds, $targetId];
        $this->generateEntries($allPwdEntries);

        // 2. Save current database state
        $persCheck = new PersistenceChecker(AppConfig::CT_PWD_CATEGORY_NAME);
        $persCheck->saveStatus();

        // 3. Perform GET request as acting user
        $client = $this->getClient();
        $response = $client->get($this->getEndpoint() . '/' . $targetId, [
            'headers' => ['Authorization' => self::AUTH_HEADER_PREFIX . $token]
        ]);

        if ($hasAccess) {
            // 4a. Allowed → expect 200 and correct password in body
            $this->assertSame(200, $response->getStatusCode(), "Expected 200 for user $userId accessing $targetId");

            $body = json_decode((string) $response->getBody(), true);
            $this->assertIsArray($body);
            $this->assertArrayHasKey('secondaryPwd', $body);
            $this->assertSame($this->getPwdForUser($targetId), $body['secondaryPwd'], "Password mismatch for user $userId accessing $targetId");
        } else {
            // 4b. Not allowed → expect 401/403
            $this->assertSame(403, $response->getStatusCode(), "Expected 403 for user $userId accessing $targetId"
            );
        }

        // 5. Ensure database state unchanged
        $persCheck->assertUnchanged();
    }

    /**
     * @dataProvider normalAccessProvider
     */
    public function testMissingEntry(int $userId, string $token, int $targetId, bool $hasAccess, array $otherPwdEntryIds): void
    {
        // 1. Create entries in pwd_category for each user except the target id
        $allPwdEntries = [...$otherPwdEntryIds];
        $this->generateEntries($allPwdEntries);

        // 2. Save current database state
        $persCheck = new PersistenceChecker(AppConfig::CT_PWD_CATEGORY_NAME);
        $persCheck->saveStatus();

        // 3. Perform GET request as acting user
        $client = $this->getClient();
        $response = $client->get($this->getEndpoint() . '/' . $targetId, [
            'headers' => ['Authorization' => self::AUTH_HEADER_PREFIX . $token]
        ]);

        if ($hasAccess) {
            // 4a. Allowed → expect 404 because entry is not present
            $this->assertSame(404, $response->getStatusCode(), "Expected 404 for user $userId accessing $targetId");

            $body = json_decode((string) $response->getBody(), true);
            $this->assertIsArray($body);
            $this->assertArrayHasKey('error', $body);
            $this->assertArrayHasKey('message', $body);
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
        $allIds   = array_column($allUsers, 'id');

        $cases = [];

        $makeVariants = function (string $label, array $baseCase) use (&$cases, $allIds) {
            $targetId = $baseCase['targetId'];

            // 1. Empty array
            $cases[$label . ' (empty otherPwdEntryIds)'] = $baseCase + [
                'otherPwdEntryIds' => []
            ];

            // 2. One element (pick first id that is not targetId)
            $oneId = null;
            foreach ($allIds as $id) {
                if ($id !== $targetId) {
                    $oneId = $id;
                    break;
                }
            }
            if ($oneId !== null) {
                $cases[$label . " (one otherPwdEntryId $oneId)"] = $baseCase + [
                    'otherPwdEntryIds' => [$oneId]
                ];
            }

            // 3. All ids (except targetId)
            $allExceptTarget = array_values(array_filter($allIds, fn($id) => $id !== $targetId));
            $cases[$label . ' (all otherPwdEntryIds)'] = $baseCase + [
                'otherPwdEntryIds' => $allExceptTarget
            ];
        };

        // Normal users
        foreach ($normalUsers as $user) {
            foreach ($allUsers as $target) {
                $hasAccess = ($user['id'] === $target['id']);
                $baseCase = [
                    'userId'    => $user['id'],
                    'token'     => $user['token'],
                    'targetId'  => $target['id'],
                    'hasAccess' => $hasAccess,
                ];
                $makeVariants("normal user {$user['id']} accessing {$target['id']}", $baseCase);
            }
        }

        // Admin users
        foreach ($adminUsers as $user) {
            foreach ($allUsers as $target) {
                $baseCase = [
                    'userId'    => $user['id'],
                    'token'     => $user['token'],
                    'targetId'  => $target['id'],
                    'hasAccess' => true,
                ];
                $makeVariants("admin user {$user['id']} accessing {$target['id']}", $baseCase);
            }
        }

        // Read access users
        foreach ($readAccessUsers as $user) {
            foreach ($allUsers as $target) {
                $baseCase = [
                    'userId'    => $user['id'],
                    'token'     => $user['token'],
                    'targetId'  => $target['id'],
                    'hasAccess' => true,
                ];
                $makeVariants("read access user {$user['id']} accessing {$target['id']}", $baseCase);
            }
        }

        return $cases;
    }



}

    