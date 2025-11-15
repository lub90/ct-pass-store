<?php

namespace CtPassStore\Tests\EndToEnd;

use CtPassStore\Config\AppConfig;
use CtPassStore\Tests\EndToEnd\Helpers\AccessTestPrototype;
use CtPassStore\Tests\EndToEnd\Helpers\ChurchToolsSandboxManager;
use CtPassStore\Tests\EndToEnd\Helpers\PersistenceChecker;


class TestAccessTest extends AccessTestPrototype {

    public function getEndpoint(): string {
        return '/test';
    }

    public function getMethods(): array {
        return ['get'];
    }

    // Default access tests are already included in the super class

    /**
     * @dataProvider authorizedUserProvider
     */
    public function testAuthorizedUsersHaveAccess(string $authHeader): void
    {
        // Save previous database status
        $persCheck = new PersistenceChecker(AppConfig::CT_PWD_CATEGORY_NAME);
        $persCheck->saveStatus();

        // Start request
        $client = $this->getClient();

        $response = $client->get( $this->getEndpoint(), [
            'headers' => ['Authorization' => $authHeader]
        ]);

        // Status code must be 200 or 207
        $this->assertContains(
            $response->getStatusCode(),
            [200, 207],
            "Expected 200 or 207 for get on /test and header: $authHeader"
        );

        // Body must contain summary and tests
        $body = json_decode((string)$response->getBody(), true);
        $this->assertIsArray($body);

        $this->assertArrayHasKey('summary', $body);
        $this->assertArrayHasKey('tests', $body);

        $this->assertIsString($body['summary']);
        $this->assertIsArray($body['tests']);

        foreach ($body['tests'] as $test) {
            $this->assertArrayHasKey('name', $test);
            $this->assertArrayHasKey('status', $test);
            $this->assertArrayHasKey('message', $test);

            $this->assertIsString($test['name']);
            $this->assertIsString($test['status']);
            $this->assertIsString($test['message']);
        }

        // Check that database state was not changed
        $persCheck->assertUnchanged();
    }

    public static function authorizedUserProvider(): array
    {
        $ct = ChurchToolsSandboxManager::getInstance();

        $tokens = array_merge(
            array_map(fn($u) => $u['token'], $ct->getNormalUsers()),
            array_map(fn($u) => $u['token'], $ct->getAdminUsers()),
            array_map(fn($u) => $u['token'], $ct->getReadAccessUsers())
        );

        $cases = [];
        foreach ($tokens as $token) {
            $cases['authorized user token ' . $token] = [self::AUTH_HEADER_PREFIX . $token];
        }

        return $cases;
    }

}

    