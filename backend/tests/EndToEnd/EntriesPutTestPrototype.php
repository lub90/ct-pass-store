<?php

namespace CtPassStore\Tests\EndToEnd;

use CtPassStore\Config\AppConfig;
use CtPassStore\Tests\EndToEnd\Helpers\AbstractTestPrototype;
use CtPassStore\Tests\EndToEnd\Helpers\ChurchToolsSandboxManager;
use CtPassStore\Tests\EndToEnd\Helpers\PersistenceChecker;
use CtPassStore\Tests\Helpers\Helpers;

abstract class EntriesPutTestPrototype extends AbstractTestPrototype
{

    public static function getValidPwdPath(): string {
        throw new \LogicException("Subclass must override");
    }

    public function getEndpoint(): string
    {
        return "entries";
    }

    public function getBody(string $ctPwd, string $newPwd): array
    {
        $body = [];

        if ($this->allowCustomPassword()) {
            $body[AppConfig::REQUEST_SECONDARY_PWD_FIELD] = $newPwd;
        }

        if ($this->requirePasswordForPasswordChange()) {
            $body[AppConfig::REQUEST_PRIMARY_PWD_FIELD] = $ctPwd;
        }

        return $body;
    }


    protected function getPwdForUser(int $targetId): string {
        return "pwd-for-user-" . $targetId;
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

    /**
     * @dataProvider normalAccessProvider
     */
    public function testNormalSetPwd(int $userId, string $token, int $targetId, bool $hasAccess, string $ctPwd, array $otherPwdEntryIds, string $newPwd): void
    {
        // Create entries in pwd_category for each user, except the one we want to test
        $allPwdEntries = [...$otherPwdEntryIds];
        $this->generateEntries($allPwdEntries);

        // Perform and check
        $this->performAndCheckNormalPutPwd($userId, $token, $targetId, $hasAccess, $ctPwd, $otherPwdEntryIds, $newPwd);
    }

    /**
     * @dataProvider normalAccessProvider
     */
    public function testNormalUpdatePwd(int $userId, string $token, int $targetId, bool $hasAccess, string $ctPwd, array $otherPwdEntryIds, string $newPwd): void
    {
        // Create entries in pwd_category for each user, except the one we want to test
        $allPwdEntries = [...$otherPwdEntryIds, $targetId];
        $this->generateEntries($allPwdEntries);

        // Perform and check
        $this->performAndCheckNormalPutPwd($userId, $token, $targetId, $hasAccess, $ctPwd, $otherPwdEntryIds, $newPwd);
    }

    protected function performAndCheckNormalPutPwd(int $userId, string $token, int $targetId, bool $hasAccess, string $ctPwd, array $otherPwdEntryIds, string $newPwd): void {
        // 1. Save current database state
        $persCheck = new PersistenceChecker(AppConfig::CT_PWD_CATEGORY_NAME);
        $persCheck->saveStatus();

        // 2. Perform PUT request as acting user
        $client = $this->getClient();

        $response = $client->put($this->getEndpoint() . '/' . $targetId, [
                    'headers' => ['Authorization' => self::AUTH_HEADER_PREFIX . $token],
                    'json'    => $this->getBody($ctPwd, $newPwd),
                ]);

        if ($hasAccess) {
            // The new password might not have been set at all, if we have a config type, that does not allow custom passwords...
            $expectedPwd = $newPwd;

            if (!$this->allowCustomPassword()) {
                // 4a. Allowed → expect 200 and correct password in body
                $this->assertSame(200, $response->getStatusCode(), "Expected 200 for user $userId accessing $targetId");

                $body = json_decode((string) $response->getBody(), true);
                $this->assertIsArray($body);
                $this->assertArrayHasKey(AppConfig::REQUEST_SECONDARY_PWD_FIELD, $body);
                $returnedPwd = $body[AppConfig::REQUEST_SECONDARY_PWD_FIELD];
                $this->assertNotEmpty($returnedPwd);
                $expectedPwd = $returnedPwd;
            } else {
                // 4a. Allowed → expect 204 and correct password in body
                $this->assertSame(204, $response->getStatusCode(), "Expected 200 for user $userId accessing $targetId");
                $this->assertEmpty((string) $response->getBody());
            }

            // Ensure database state changed
            $persCheck->assertChanged();
            // Ensure only one value is present per user in the databes. Make this check before getting an comparing the pwd, because otherwise we might fail to fetch
            $this->checkUniqueUsers();


            $this->getAndCheckPwd($targetId, $token, $expectedPwd);

            

        } else {
            // 4b. Not allowed → expect 403
            $this->assertSame(403, $response->getStatusCode(), "Expected 403 for user $userId accessing $targetId"
            );
        }
        
    }

    protected function checkUniqueUsers(): void {
        $extensionDataService = Helpers::getExtensionDataService();
        $allPwdEntries = $extensionDataService->getCategoryData(AppConfig::CT_PWD_CATEGORY_NAME);

        $allPwdIds = [];
        foreach($allPwdEntries as $pwdEntry) {
            $allPwdIds[] = json_decode($pwdEntry["value"], true)[AppConfig::CT_PERSON_ID_PWD_FIELD];
        }

        $this->assertSame(count($allPwdIds), count(array_unique($allPwdIds)), "Duplicate password entries found!");
    }

    protected function getAndCheckPwd(int $userId, string $token, string $newPwd): void
    {
        // 1. GET request for the password
        $client = $this->getClient();
        $response = $client->get($this->getEndpoint() . '/' . $userId, [
            'headers' => ['Authorization' => self::AUTH_HEADER_PREFIX . $token]
        ]);

        $this->assertSame(
            200,
            $response->getStatusCode(),
            "Expected 200 when fetching new pwd for user $userId"
        );

        $body = json_decode((string) $response->getBody(), true);
        $this->assertIsArray($body);
        $this->assertArrayHasKey(AppConfig::REQUEST_SECONDARY_PWD_FIELD, $body);

        $encryptedPwd = $body[AppConfig::REQUEST_SECONDARY_PWD_FIELD];

        // 2. Load private key
        $privateKey = $this->getPrivateKey();
        $privateKey = openssl_pkey_get_private($privateKey);
        if ($privateKey === false) {
            $keyPath = $this->getPrivateKeyPath();
            throw new \RuntimeException("Could not load private key from $keyPath");
        }

        // 3. Decode from Base64 and decrypt with RSA 4096 OAEP SHA256
        $decodedCipher = base64_decode($encryptedPwd, true);
        if ($decodedCipher === false) {
            throw new \RuntimeException("Encrypted password is not valid base64");
        }

        $decrypted = '';
        $success = openssl_private_decrypt(
            $decodedCipher,
            $decrypted,
            $privateKey,
            OPENSSL_PKCS1_OAEP_PADDING
        );

        if (!$success) {
            throw new \RuntimeException("Failed to decrypt password for user $userId");
        }

        // 4. Check that both encrypted passwords are the same
        $this->assertSame(
            $newPwd,
            $decrypted,
            "Decrypted password does not match expected newPwd for user $userId"
        );
    }

    protected static function getValidPwds(): array
    {
        $filePath = static::getValidPwdPath();

        if (!is_readable($filePath)) {
            throw new \RuntimeException("Password file not readable at: $filePath");
        }

        $json = file_get_contents($filePath);
        if ($json === false) {
            throw new \RuntimeException("Failed to read file: $filePath");
        }

        $data = json_decode($json, true);

        if (json_last_error() !== JSON_ERROR_NONE) {
            throw new \RuntimeException("Invalid JSON in file $filePath: " . json_last_error_msg());
        }

        if (!is_array($data)) {
            throw new \RuntimeException("Expected JSON array in file $filePath");
        }

        return $data;
    }

    public static function normalAccessProvider(): array
    {
        $ct = ChurchToolsSandboxManager::getInstance();

        $normalUsers = $ct->getNormalUsers();
        $adminUsers = $ct->getAdminUsers();
        $readAccessUsers = $ct->getReadAccessUsers();

        $allUsers = array_merge($normalUsers, $adminUsers, $readAccessUsers);
        $allIds   = array_column($allUsers, 'id');

        $cases = [];


        // List of passwords to test
        $newPwdsToTest = self::getValidPwds();

        $makeVariants = function (string $label, array $baseCase) use (&$cases, $allIds, $newPwdsToTest) {

            $variants = [];

            $targetId = $baseCase['targetId'];

            $variants[$label . ' (empty otherPwdEntryIds)'] = $baseCase + [
                'otherPwdEntryIds' => []
            ];

            $oneId = null;
            foreach ($allIds as $id) {
                if ($id !== $targetId) {
                    $oneId = $id;
                    break;
                }
            }
            if ($oneId !== null) {
                $variants[$label . " (one otherPwdEntryId $oneId)"] = $baseCase + [
                    'otherPwdEntryIds' => [$oneId]
                ];
            }

            $allExceptTarget = array_values(array_filter($allIds, fn($id) => $id !== $targetId));
            $variants[$label . ' (all otherPwdEntryIds)'] = $baseCase + [
                'otherPwdEntryIds' => $allExceptTarget
            ];

            // Now generate this foreach password possibility
            foreach ($variants as $variantLabel => $variantCase) {
                foreach ($newPwdsToTest as $pwd) {
                    $cases[$variantLabel . " (newPwd=$pwd)"] = $variantCase + [
                        'newPwd' => $pwd
                    ];
                }
            }
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
                    'ctPwd' => $user['pwd'],
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
                    'ctPwd' => $user['pwd'],
                ];
                $makeVariants("admin user {$user['id']} accessing {$target['id']}", $baseCase);
            }
        }

        // Read access users → only own targetId for put
        foreach ($readAccessUsers as $user) {
            foreach ($allUsers as $target) {
                $hasAccess = ($user['id'] === $target['id']);
                $baseCase = [
                    'userId'    => $user['id'],
                    'token'     => $user['token'],
                    'targetId'  => $target['id'],
                    'hasAccess' => $hasAccess,
                    'ctPwd' => $user['pwd'],
                ];
                $makeVariants("read access user {$user['id']} accessing {$target['id']}", $baseCase);
            }
        }

        return $cases;
    }
}
