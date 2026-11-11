<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Infrastructure\ChurchTools;

use CtPassStore\Infrastructure\ChurchTools\ChurchToolsClient;
use CtPassStore\Infrastructure\ChurchTools\Credential;
use CtPassStore\Infrastructure\Kv\KvSchema;
use CtPassStore\Tests\Support\ChurchToolsClientContractTestCase;
use CtPassStore\Tests\Support\FakeChurchToolsClient;

/**
 * The fake passes the same contract as the real ChurchTools (catalog CT-06a).
 */
final class FakeChurchToolsClientContractTest extends ChurchToolsClientContractTestCase
{
    private FakeChurchToolsClient $fake;

    protected function setUp(): void
    {
        $this->fake = new FakeChurchToolsClient();
        $ids = $this->fake->addModule(KvSchema::EXTENSION_KEY, [
            KvSchema::SETTINGS_CATEGORY,
            KvSchema::ENCRYPTION_CATEGORY,
            KvSchema::PASSWORD_CATEGORY,
        ]);
        $this->fake->seedValue($ids[KvSchema::PASSWORD_CATEGORY], '{"personId":5,"secondaryPwd":"x"}');
        $this->fake->addUser($this->validUserCredential(), 5, 'jdoe', [KvSchema::EXTENSION_KEY => ['view' => true]]);
        $this->fake->setServiceUserPermissions(['churchcore' => ['administer settings' => false], KvSchema::EXTENSION_KEY => ['view' => true, 'edit custom data' => [$ids[KvSchema::PASSWORD_CATEGORY]]]]);
        $this->fake->addLogin('jdoe', 'Secret-1!', 5);
        $this->fake->setOAuthClient('oauth-client', 'oauth-secret');
    }

    protected function client(): ChurchToolsClient
    {
        return $this->fake;
    }

    protected function validUserCredential(): Credential
    {
        return Credential::loginToken('contract-user-token');
    }

    /**
     * @return array{id: string, secret: string, redirectUri: string}
     */
    protected function oauthClient(): array
    {
        return ['id' => 'oauth-client', 'secret' => 'oauth-secret', 'redirectUri' => 'https://example.church.tools/ccm/ctpassstore/'];
    }

    protected function loginUser(): array
    {
        return ['username' => 'jdoe', 'password' => 'Secret-1!', 'personId' => 5];
    }
}
