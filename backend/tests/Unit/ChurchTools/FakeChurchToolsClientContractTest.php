<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\ChurchTools;

use CtPassStore\ChurchTools\ChurchToolsClient;
use CtPassStore\ChurchTools\Credential;
use CtPassStore\Config\AppConfig;
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
        $ids = $this->fake->addModule(AppConfig::CT_EXTENSION_ID, [
            AppConfig::CT_SETTINGS_CATEGORY_NAME,
            AppConfig::CT_ENCRYPTION_SETTINGS_CATEGORY_NAME,
            AppConfig::CT_PWD_CATEGORY_NAME,
        ]);
        $this->fake->seedValue($ids[AppConfig::CT_PWD_CATEGORY_NAME], '{"personId":5,"secondaryPwd":"x"}');
        $this->fake->addUser($this->validUserCredential(), 5, 'jdoe', [AppConfig::CT_EXTENSION_ID => ['view' => true]]);
        $this->fake->addLogin('jdoe', 'Secret-1!', 5);
    }

    protected function client(): ChurchToolsClient
    {
        return $this->fake;
    }

    protected function validUserCredential(): Credential
    {
        return Credential::loginToken('contract-user-token');
    }

    protected function loginUser(): array
    {
        return ['username' => 'jdoe', 'password' => 'Secret-1!', 'personId' => 5];
    }
}
