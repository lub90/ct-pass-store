<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Infrastructure\ChurchTools;

use CtPassStore\Infrastructure\ChurchTools\ChurchToolsClient;
use CtPassStore\Infrastructure\ChurchTools\Credential;
use CtPassStore\Infrastructure\ChurchTools\Exception\ServiceCredentialRejectedException;
use CtPassStore\Infrastructure\ChurchTools\PersonStatus;
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
        $this->fake->setServiceUserPermissions([
            'churchcore' => ['administer settings' => false],
            'churchdb' => ['view' => true, 'view alldata' => [1], 'view archive' => true, 'view hidden persons' => true],
            KvSchema::EXTENSION_KEY => ['view' => true, 'edit custom data' => [$ids[KvSchema::PASSWORD_CATEGORY]]],
        ]);
        $this->fake->addPerson(12);
        $this->fake->addPerson(34, archived: true);
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

    protected function personIds(): array
    {
        return ['active' => 12, 'archived' => 34, 'deleted' => 56];
    }

    public function testWithoutThePersonsRightTheFakeBehavesLikeChurchTools(): void
    {
        $this->fake->setServiceUserPermissions(['churchdb' => ['view' => true, 'view alldata' => [1], 'view archive' => false, 'view hidden persons' => true]]);

        self::assertSame(PersonStatus::Gone, $this->fake->personStatus(56));
        self::assertSame([], $this->fake->activePersonIds([12, 34, 56]));
        $this->expectException(ServiceCredentialRejectedException::class);
        $this->fake->personStatus(12);
    }

    public function testTheFakeRecordsAndFailsThePersonCalls(): void
    {
        $this->fake->failNext('personStatus', new ServiceCredentialRejectedException('boom'));

        try {
            $this->fake->personStatus(12);
            self::fail('Expected the queued failure.');
        } catch (ServiceCredentialRejectedException) {
        }
        $this->fake->activePersonIds([12]);
        $this->fake->personDepartmentIds();

        self::assertSame(['personStatus', 'activePersonIds', 'personDepartmentIds'], array_column($this->fake->calls(), 'method'));
    }
}
