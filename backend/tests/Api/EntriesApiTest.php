<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Api;

use CtPassStore\Config\AppConfig;
use CtPassStore\Http\Problem\ProblemType;
use PHPUnit\Framework\Attributes\DataProvider;

/**
 * Today's behavior of `/entries/{id}` (plan item 2.0).
 *
 * These tests pin the current behavior before phase 2 and 3 change it on purpose. When an item changes the
 * behavior (e.g. Problem Details in 2.1, bearer tokens in 3.4), the affected assertions change with it.
 */
final class EntriesApiTest extends ApiTestCase
{
    // ---------------------------------------------------------------- authentication

    public function testMissingAuthorizationHeaderIs401(): void
    {
        $response = $this->request('GET', '/entries/' . self::USER);

        $this->assertProblem(ProblemType::MissingToken, $response);
        self::assertSame(0, $this->churchTools->countCalls(['whoami']));
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function invalidAuthorizationHeaders(): iterable
    {
        yield 'other scheme' => ['Basic dXNlcjpwYXNz'];
        yield 'unknown token' => ['Login not-a-known-token'];
        yield 'token with a space' => ['Login a b'];
    }

    #[DataProvider('invalidAuthorizationHeaders')]
    public function testInvalidAuthorizationIs401WithoutSideEffects(string $header): void
    {
        $response = $this->request('PUT', '/entries/' . self::USER, headers: ['Authorization' => $header]);

        $this->assertProblem(ProblemType::InvalidToken, $response);
        self::assertSame(0, $this->churchTools->writeCount());
    }

    public function testUserWithoutViewPermissionIs403(): void
    {
        $response = $this->request('GET', '/entries/' . self::NO_ACCESS, self::NO_ACCESS);

        $this->assertProblem(ProblemType::NoServiceAccess, $response);
    }

    // ---------------------------------------------------------------- GET

    public function testUserReadsOwnEntry(): void
    {
        $this->seedEntry(self::USER, 'Y2lwaGVydGV4dA==');

        $response = $this->request('GET', '/entries/' . self::USER, self::USER);

        self::assertSame(200, $response->getStatusCode());
        self::assertSame([AppConfig::REQUEST_SECONDARY_PWD_FIELD => 'Y2lwaGVydGV4dA=='], $this->json($response));
    }

    public function testMissingEntryIs404(): void
    {
        $this->seedEntry(self::OTHER);

        $response = $this->request('GET', '/entries/' . self::USER, self::USER);

        $this->assertProblem(ProblemType::EntryNotFound, $response);
    }

    public function testUserCantReadAnotherPersonsEntry(): void
    {
        $this->seedEntry(self::OTHER);

        $response = $this->request('GET', '/entries/' . self::OTHER, self::USER);

        $this->assertProblem(ProblemType::Forbidden, $response);
    }

    /**
     * @return iterable<string, array{int}>
     */
    public static function privilegedReaders(): iterable
    {
        yield 'admin' => [self::ADMIN];
        yield 'read-access user' => [self::READER];
    }

    #[DataProvider('privilegedReaders')]
    public function testAdminsAndReadersReadOtherEntries(int $reader): void
    {
        $this->seedEntry(self::OTHER, 'b3RoZXI=');

        $response = $this->request('GET', '/entries/' . self::OTHER, $reader);

        self::assertSame(200, $response->getStatusCode());
        self::assertSame('b3RoZXI=', $this->json($response)[AppConfig::REQUEST_SECONDARY_PWD_FIELD]);
    }

    // ---------------------------------------------------------------- PUT

    public function testGeneratedPasswordIsReturnedAndStoredEncrypted(): void
    {
        $response = $this->request('PUT', '/entries/' . self::USER, self::USER);

        self::assertSame(200, $response->getStatusCode());
        $password = $this->json($response)[AppConfig::REQUEST_SECONDARY_PWD_FIELD];
        self::assertIsString($password);
        self::assertSame(12, strlen($password));

        $entries = $this->storedEntries();
        self::assertCount(1, $entries);
        self::assertSame(self::USER, $entries[0][AppConfig::CT_PERSON_ID_PWD_FIELD]);
        self::assertSame($password, $this->decrypt($entries[0][AppConfig::CT_ENCRYPTED_PWD_FIELD]));
    }

    public function testCustomPasswordIsStoredEncrypted(): void
    {
        $response = $this->request('PUT', '/entries/' . self::USER, self::USER, [AppConfig::REQUEST_SECONDARY_PWD_FIELD => 'Custom-pass12!']);

        self::assertSame(204, $response->getStatusCode());
        self::assertSame('', (string) $response->getBody());
        $entries = $this->storedEntries();
        self::assertCount(1, $entries);
        self::assertSame('Custom-pass12!', $this->decrypt($entries[0][AppConfig::CT_ENCRYPTED_PWD_FIELD]));
    }

    public function testUpdatingKeepsExactlyOneEntry(): void
    {
        $this->seedEntry(self::USER);
        $this->seedEntry(self::OTHER);

        $response = $this->request('PUT', '/entries/' . self::USER, self::USER, [AppConfig::REQUEST_SECONDARY_PWD_FIELD => 'Custom-pass12!']);

        self::assertSame(204, $response->getStatusCode());
        $mine = array_values(array_filter($this->storedEntries(), static fn(array $e): bool => $e[AppConfig::CT_PERSON_ID_PWD_FIELD] === self::USER));
        self::assertCount(1, $mine);
        self::assertSame('Custom-pass12!', $this->decrypt($mine[0][AppConfig::CT_ENCRYPTED_PWD_FIELD]));
        self::assertCount(2, $this->storedEntries(), 'The other person\'s entry must stay.');
    }

    public function testCustomPasswordWhileNotAllowedIs400AndStoresNothing(): void
    {
        $this->setSettings([AppConfig::CT_ALLOW_CUSTOM_PASSWORD_FIELD_NAME => false]);

        $response = $this->request('PUT', '/entries/' . self::USER, self::USER, [AppConfig::REQUEST_SECONDARY_PWD_FIELD => 'Custom-pass12!']);

        $this->assertProblem(ProblemType::CustomPasswordNotAllowed, $response);
        self::assertSame(0, $this->churchTools->writeCount());
    }

    public function testInvalidCustomPasswordIs400AndStoresNothing(): void
    {
        $response = $this->request('PUT', '/entries/' . self::USER, self::USER, [AppConfig::REQUEST_SECONDARY_PWD_FIELD => 'tooshort']);

        $this->assertProblem(ProblemType::PasswordInvalid, $response);
        self::assertSame(0, $this->churchTools->writeCount());
    }

    public function testUserCantChangeAnotherPersonsEntry(): void
    {
        $response = $this->request('PUT', '/entries/' . self::OTHER, self::USER);

        $this->assertProblem(ProblemType::Forbidden, $response);
        self::assertSame(0, $this->churchTools->writeCount());
    }

    public function testReaderCantChangeAnotherPersonsEntry(): void
    {
        $response = $this->request('PUT', '/entries/' . self::OTHER, self::READER);

        $this->assertProblem(ProblemType::Forbidden, $response);
        self::assertSame(0, $this->churchTools->writeCount());
    }

    public function testAdminChangesAnotherPersonsEntry(): void
    {
        $response = $this->request('PUT', '/entries/' . self::OTHER, self::ADMIN);

        self::assertSame(200, $response->getStatusCode());
        self::assertSame(self::OTHER, $this->storedEntries()[0][AppConfig::CT_PERSON_ID_PWD_FIELD]);
    }

    // ---------------------------------------------------------------- primary password

    public function testPrimaryPasswordRequiredButMissingIs400(): void
    {
        $this->setSettings([AppConfig::CT_REQUIRE_PWD_FOR_PWD_CHANGE_FIELD_NAME => true]);

        $response = $this->request('PUT', '/entries/' . self::USER, self::USER, []);

        $this->assertProblem(ProblemType::PrimaryPasswordRequired, $response);
        self::assertSame(0, $this->churchTools->writeCount());
    }

    public function testWrongPrimaryPasswordIs403(): void
    {
        $this->setSettings([AppConfig::CT_REQUIRE_PWD_FOR_PWD_CHANGE_FIELD_NAME => true]);

        $response = $this->request('PUT', '/entries/' . self::USER, self::USER, [AppConfig::REQUEST_PRIMARY_PWD_FIELD => 'wrong']);

        $this->assertProblem(ProblemType::InvalidPrimaryPassword, $response);
        self::assertSame(0, $this->churchTools->writeCount());
    }

    public function testCorrectPrimaryPasswordAllowsTheChange(): void
    {
        $this->setSettings([AppConfig::CT_REQUIRE_PWD_FOR_PWD_CHANGE_FIELD_NAME => true]);

        $response = $this->request('PUT', '/entries/' . self::USER, self::USER, [AppConfig::REQUEST_PRIMARY_PWD_FIELD => $this->primaryPasswordOf(self::USER)]);

        self::assertSame(200, $response->getStatusCode());
        self::assertCount(1, $this->storedEntries());
    }

    public function testAdminIsCheckedAgainstTheirOwnPrimaryPassword(): void
    {
        $this->setSettings([AppConfig::CT_REQUIRE_PWD_FOR_PWD_CHANGE_FIELD_NAME => true]);

        $withTargetsPassword = $this->request('PUT', '/entries/' . self::OTHER, self::ADMIN, [AppConfig::REQUEST_PRIMARY_PWD_FIELD => $this->primaryPasswordOf(self::OTHER)]);
        $withOwnPassword = $this->request('PUT', '/entries/' . self::OTHER, self::ADMIN, [AppConfig::REQUEST_PRIMARY_PWD_FIELD => $this->primaryPasswordOf(self::ADMIN)]);

        $this->assertProblem(ProblemType::InvalidPrimaryPassword, $withTargetsPassword);
        self::assertSame(200, $withOwnPassword->getStatusCode());
    }

    // ---------------------------------------------------------------- DELETE

    public function testUserDeletesOwnEntryOnly(): void
    {
        $this->seedEntry(self::USER);
        $this->seedEntry(self::OTHER);

        $response = $this->request('DELETE', '/entries/' . self::USER, self::USER);

        self::assertSame(204, $response->getStatusCode());
        $remaining = $this->storedEntries();
        self::assertCount(1, $remaining);
        self::assertSame(self::OTHER, $remaining[0][AppConfig::CT_PERSON_ID_PWD_FIELD]);
    }

    public function testDeletingWithoutAnEntryIs204(): void
    {
        $response = $this->request('DELETE', '/entries/' . self::USER, self::USER);

        self::assertSame(204, $response->getStatusCode());
    }

    // ---------------------------------------------------------------- logging

    public function testNoSecretReachesTheLog(): void
    {
        $this->setSettings([AppConfig::CT_REQUIRE_PWD_FOR_PWD_CHANGE_FIELD_NAME => true]);

        $this->request('PUT', '/entries/' . self::USER, self::USER, [AppConfig::REQUEST_PRIMARY_PWD_FIELD => 'wrong-primary', AppConfig::REQUEST_SECONDARY_PWD_FIELD => 'Custom-pass12!']);
        $this->request('PUT', '/entries/' . self::USER, self::USER, [AppConfig::REQUEST_PRIMARY_PWD_FIELD => $this->primaryPasswordOf(self::USER), AppConfig::REQUEST_SECONDARY_PWD_FIELD => 'Custom-pass12!']);
        $this->request('GET', '/entries/' . self::USER, self::USER);

        $secrets = ['wrong-primary', $this->primaryPasswordOf(self::USER), 'Custom-pass12!', $this->tokenOf(self::USER)];
        foreach ($this->log->getRecords() as $record) {
            $line = $record['message'] . ' ' . json_encode($record['context']);
            foreach ($secrets as $secret) {
                self::assertStringNotContainsString($secret, $line);
            }
        }
    }
}
