<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Api;

use CtPassStore\Http\Problem\ProblemType;
use CtPassStore\Infrastructure\ChurchTools\Exception\UnavailableException;
use CtPassStore\Infrastructure\Kv\KvSchema;
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
        $response = $this->request('GET', '/v1/entries/' . self::USER);

        $this->assertProblem(ProblemType::MissingToken, $response);
        self::assertSame(0, $this->churchTools->countCalls(['whoami']));
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function invalidAuthorizationHeaders(): iterable
    {
        yield 'other scheme' => ['Basic dXNlcjpwYXNz'];
        yield 'old Login scheme' => ['Login some-churchtools-login-token'];
        yield 'not a JWT' => ['Bearer not-a-known-token'];
        yield 'token with a space' => ['Bearer a b'];
    }

    #[DataProvider('invalidAuthorizationHeaders')]
    public function testInvalidAuthorizationIs401WithoutSideEffects(string $header): void
    {
        $response = $this->request('PUT', '/v1/entries/' . self::USER, headers: ['Authorization' => $header]);

        $this->assertProblem(ProblemType::InvalidToken, $response);
        self::assertSame(0, $this->churchTools->writeCount());
    }

    // ---------------------------------------------------------------- GET

    public function testUserReadsOwnEntry(): void
    {
        $this->seedEntry(self::USER, 'Y2lwaGVydGV4dA==');

        $response = $this->request('GET', '/v1/entries/' . self::USER, self::USER);

        self::assertSame(200, $response->getStatusCode());
        self::assertSame(['secondaryPwd' => 'Y2lwaGVydGV4dA=='], $this->json($response));
    }

    public function testMissingEntryIs404(): void
    {
        $this->seedEntry(self::OTHER);

        $response = $this->request('GET', '/v1/entries/' . self::USER, self::USER);

        $this->assertProblem(ProblemType::EntryNotFound, $response);
    }

    public function testUserCantReadAnotherPersonsEntry(): void
    {
        $this->seedEntry(self::OTHER);

        $response = $this->request('GET', '/v1/entries/' . self::OTHER, self::USER);

        $this->assertProblem(ProblemType::Forbidden, $response);
    }

    /**
     * @return iterable<string, array{int|string}>
     */
    public static function privilegedReaders(): iterable
    {
        yield 'admin' => [self::ADMIN];
        yield 'machine client with entries:read' => [self::READER_CLIENT];
    }

    #[DataProvider('privilegedReaders')]
    public function testAdminsAndReadersReadOtherEntries(int|string $reader): void
    {
        $this->seedEntry(self::OTHER, 'b3RoZXI=');

        $response = $this->request('GET', '/v1/entries/' . self::OTHER, $reader);

        self::assertSame(200, $response->getStatusCode());
        self::assertSame('b3RoZXI=', $this->json($response)['secondaryPwd']);
    }

    public function testMachineClientReadingAGonePersonGets404(): void
    {
        $this->churchTools->addPerson(50);
        $this->churchTools->removePerson(50);
        $this->seedEntry(50);

        $response = $this->request('GET', '/v1/entries/50', self::READER_CLIENT);

        $body = $this->assertProblem(ProblemType::PersonNotFound, $response);
        self::assertSame("Person 50 doesn't exist in ChurchTools or is archived.", $body['detail']);
        self::assertArrayNotHasKey('secondaryPwd', $body);
        self::assertTrue($this->log->hasInfoThatContains("Machine client ct-radius asked for person 50, who doesn't exist or is archived."));
    }

    public function testAdminReadingAnArchivedPersonGets404(): void
    {
        $this->churchTools->addPerson(51, archived: true);
        $this->seedEntry(51);

        $response = $this->request('GET', '/v1/entries/51', self::ADMIN);

        $this->assertProblem(ProblemType::PersonNotFound, $response);
    }

    /** EG-09 */
    public function testAForeign404OnTheLookupIs502NotPersonNotFound(): void
    {
        $this->seedEntry(self::OTHER);
        $this->churchTools->answerForeign404For(self::OTHER);

        $response = $this->request('GET', '/v1/entries/' . self::OTHER, self::READER_CLIENT);

        $this->assertProblem(ProblemType::UpstreamInvalid, $response);
        self::assertSame(502, $response->getStatusCode());
    }

    public function testReadingOwnEntryMakesNoLookup(): void
    {
        $this->seedEntry(self::USER);

        $response = $this->request('GET', '/v1/entries/' . self::USER, self::USER);

        self::assertSame(200, $response->getStatusCode());
        self::assertSame(0, $this->churchTools->countCalls(['personStatus']));
    }

    public function testUnauthorizedReadIs403WithoutLookup(): void
    {
        $this->churchTools->removePerson(self::OTHER);

        $response = $this->request('GET', '/v1/entries/' . self::OTHER, self::USER);

        $this->assertProblem(ProblemType::Forbidden, $response);
        self::assertSame(0, $this->churchTools->countCalls(['personStatus']));
    }

    /** EG-08 */
    public function testRepeatedReadsWithin600SecondsMakeOneLookup(): void
    {
        $this->seedEntry(self::OTHER);

        $first = $this->request('GET', '/v1/entries/' . self::OTHER, self::READER_CLIENT);
        $second = $this->request('GET', '/v1/entries/' . self::OTHER, self::READER_CLIENT);

        self::assertSame(200, $first->getStatusCode());
        self::assertSame(200, $second->getStatusCode());
        self::assertSame(1, $this->churchTools->countCalls(['personStatus']));
    }

    // ---------------------------------------------------------------- PUT

    public function testGeneratedPasswordIsReturnedAndStoredEncrypted(): void
    {
        $response = $this->request('PUT', '/v1/entries/' . self::USER, self::USER);

        self::assertSame(200, $response->getStatusCode());
        $password = $this->json($response)['secondaryPwd'];
        self::assertIsString($password);
        self::assertSame(12, strlen($password));
        self::assertSame([], (new \CtPassStore\Domain\PasswordPolicy())->violations($password, 12), 'EP-01: the generated password passes the policy.');

        $entries = $this->storedEntries();
        self::assertCount(1, $entries);
        self::assertSame(self::USER, $entries[0][KvSchema::ENTRY_PERSON_ID]);
        self::assertSame($password, $this->decrypt($entries[0][KvSchema::ENTRY_CIPHERTEXT]));
    }

    /**
     * EP-10.
     */
    public function testTwoGeneratedPasswordsDifferAndOnlyTheSecondIsStored(): void
    {
        $first = $this->json($this->request('PUT', '/v1/entries/' . self::USER, self::USER))['secondaryPwd'];
        $second = $this->json($this->request('PUT', '/v1/entries/' . self::USER, self::USER))['secondaryPwd'];

        self::assertIsString($first);
        self::assertIsString($second);
        self::assertNotSame($first, $second);
        $entries = $this->storedEntries();
        self::assertCount(1, $entries);
        self::assertSame($second, $this->decrypt($entries[0][KvSchema::ENTRY_CIPHERTEXT]));
    }

    public function testCustomPasswordIsStoredEncrypted(): void
    {
        $response = $this->request('PUT', '/v1/entries/' . self::USER, self::USER, ['secondaryPwd' => 'Custom-pass12!']);

        self::assertSame(204, $response->getStatusCode());
        self::assertSame('', (string) $response->getBody());
        $entries = $this->storedEntries();
        self::assertCount(1, $entries);
        self::assertSame('Custom-pass12!', $this->decrypt($entries[0][KvSchema::ENTRY_CIPHERTEXT]));
    }

    /**
     * EP-07.
     */
    public function testSettingTheSamePasswordAgainWorks(): void
    {
        for ($i = 0; $i < 2; $i++) {
            self::assertSame(204, $this->request('PUT', '/v1/entries/' . self::USER, self::USER, ['secondaryPwd' => 'Custom-pass12!'])->getStatusCode());
        }

        $entries = $this->storedEntries();
        self::assertCount(1, $entries);
        self::assertSame('Custom-pass12!', $this->decrypt($entries[0][KvSchema::ENTRY_CIPHERTEXT]));
    }

    public function testUpdatingKeepsExactlyOneEntry(): void
    {
        $this->seedEntry(self::USER);
        $this->seedEntry(self::OTHER);

        $response = $this->request('PUT', '/v1/entries/' . self::USER, self::USER, ['secondaryPwd' => 'Custom-pass12!']);

        self::assertSame(204, $response->getStatusCode());
        $mine = array_values(array_filter($this->storedEntries(), static fn(array $e): bool => $e[KvSchema::ENTRY_PERSON_ID] === self::USER));
        self::assertCount(1, $mine);
        self::assertSame('Custom-pass12!', $this->decrypt($mine[0][KvSchema::ENTRY_CIPHERTEXT]));
        self::assertCount(2, $this->storedEntries(), 'The other person\'s entry must stay.');
    }

    public function testCustomPasswordWhileNotAllowedIs400AndStoresNothing(): void
    {
        $this->setSettings([KvSchema::SETTING_ALLOW_CUSTOM_PASSWORD => false]);

        $response = $this->request('PUT', '/v1/entries/' . self::USER, self::USER, ['secondaryPwd' => 'Custom-pass12!']);

        $this->assertProblem(ProblemType::CustomPasswordNotAllowed, $response);
        self::assertSame(0, $this->churchTools->writeCount());
    }

    public function testInvalidCustomPasswordIs400AndStoresNothing(): void
    {
        $response = $this->request('PUT', '/v1/entries/' . self::USER, self::USER, ['secondaryPwd' => 'tooshort']);

        $this->assertProblem(ProblemType::PasswordInvalid, $response);
        self::assertSame(0, $this->churchTools->writeCount());
    }

    public function testUserCantChangeAnotherPersonsEntry(): void
    {
        $response = $this->request('PUT', '/v1/entries/' . self::OTHER, self::USER);

        $this->assertProblem(ProblemType::Forbidden, $response);
        self::assertSame(0, $this->churchTools->writeCount());
    }

    public function testReaderCantChangeAnotherPersonsEntry(): void
    {
        $response = $this->request('PUT', '/v1/entries/' . self::OTHER, self::READER_CLIENT);

        $this->assertProblem(ProblemType::Forbidden, $response);
        self::assertSame(0, $this->churchTools->writeCount());
    }

    public function testAdminChangesAnotherPersonsEntry(): void
    {
        $response = $this->request('PUT', '/v1/entries/' . self::OTHER, self::ADMIN);

        self::assertSame(200, $response->getStatusCode());
        self::assertSame(self::OTHER, $this->storedEntries()[0][KvSchema::ENTRY_PERSON_ID]);
    }

    // ---------------------------------------------------------------- primary password

    public function testPrimaryPasswordRequiredButMissingIs400(): void
    {
        $this->setSettings([KvSchema::SETTING_REQUIRE_PRIMARY_PASSWORD => true]);

        $response = $this->request('PUT', '/v1/entries/' . self::USER, self::USER, []);

        $this->assertProblem(ProblemType::PrimaryPasswordRequired, $response);
        self::assertSame(0, $this->churchTools->writeCount());
    }

    public function testWrongPrimaryPasswordIs403(): void
    {
        $this->setSettings([KvSchema::SETTING_REQUIRE_PRIMARY_PASSWORD => true]);

        $response = $this->request('PUT', '/v1/entries/' . self::USER, self::USER, ['primaryPwd' => 'wrong']);

        $this->assertProblem(ProblemType::InvalidPrimaryPassword, $response);
        self::assertSame(0, $this->churchTools->writeCount());
    }

    public function testCorrectPrimaryPasswordAllowsTheChange(): void
    {
        $this->setSettings([KvSchema::SETTING_REQUIRE_PRIMARY_PASSWORD => true]);

        $response = $this->request('PUT', '/v1/entries/' . self::USER, self::USER, ['primaryPwd' => $this->primaryPasswordOf(self::USER)]);

        self::assertSame(200, $response->getStatusCode());
        self::assertCount(1, $this->storedEntries());
    }

    public function testAdminIsCheckedAgainstTheirOwnPrimaryPassword(): void
    {
        $this->setSettings([KvSchema::SETTING_REQUIRE_PRIMARY_PASSWORD => true]);

        $withTargetsPassword = $this->request('PUT', '/v1/entries/' . self::OTHER, self::ADMIN, ['primaryPwd' => $this->primaryPasswordOf(self::OTHER)]);
        $withOwnPassword = $this->request('PUT', '/v1/entries/' . self::OTHER, self::ADMIN, ['primaryPwd' => $this->primaryPasswordOf(self::ADMIN)]);

        $this->assertProblem(ProblemType::InvalidPrimaryPassword, $withTargetsPassword);
        self::assertSame(200, $withOwnPassword->getStatusCode());
    }

    // ---------------------------------------------------------------- PUT and gone persons

    public function testAdminChangingADeletedPersonGets404AndStoresNothing(): void
    {
        $response = $this->request('PUT', '/v1/entries/60', self::ADMIN);

        $body = $this->assertProblem(ProblemType::PersonNotFound, $response);
        self::assertSame("Person 60 doesn't exist in ChurchTools or is archived.", $body['detail']);
        self::assertSame([], $this->storedEntries());
    }

    public function testAdminChangingAnArchivedPersonGets404AndStoresNothing(): void
    {
        $this->churchTools->addPerson(61, archived: true);

        $response = $this->request('PUT', '/v1/entries/61', self::ADMIN);

        $this->assertProblem(ProblemType::PersonNotFound, $response);
        self::assertSame([], $this->storedEntries());
    }

    public function testChangingOwnEntryMakesNoLookup(): void
    {
        $response = $this->request('PUT', '/v1/entries/' . self::USER, self::USER);

        self::assertSame(200, $response->getStatusCode());
        self::assertSame(0, $this->churchTools->countCalls(['personStatus']));
    }

    public function testRejectedCallersMakeNoLookup(): void
    {
        $this->setSettings([KvSchema::SETTING_REQUIRE_PRIMARY_PASSWORD => true]);

        $unauthorized = $this->request('PUT', '/v1/entries/60', self::USER, ['primaryPwd' => $this->primaryPasswordOf(self::USER)]);
        $wrongPassword = $this->request('PUT', '/v1/entries/60', self::ADMIN, ['primaryPwd' => 'wrong']);

        $this->assertProblem(ProblemType::Forbidden, $unauthorized);
        $this->assertProblem(ProblemType::InvalidPrimaryPassword, $wrongPassword);
        self::assertSame(0, $this->churchTools->countCalls(['personStatus']));
    }

    public function testFailingLookupIs502AndStoresNothing(): void
    {
        $this->churchTools->failNext('personStatus', new UnavailableException('down'));

        $response = $this->request('PUT', '/v1/entries/' . self::OTHER, self::ADMIN);

        $this->assertProblem(ProblemType::UpstreamUnavailable, $response);
        self::assertSame([], $this->storedEntries());
    }

    /** EP-20 */
    public function testAForeign404OnTheLookupIs502AndStoresNothing(): void
    {
        $this->churchTools->answerForeign404For(self::OTHER);

        $response = $this->request('PUT', '/v1/entries/' . self::OTHER, self::ADMIN);

        $this->assertProblem(ProblemType::UpstreamInvalid, $response);
        self::assertSame(502, $response->getStatusCode());
        self::assertSame([], $this->storedEntries());
    }

    public function testAdminChangingAnActivePersonStoresTheEntry(): void
    {
        $response = $this->request('PUT', '/v1/entries/' . self::OTHER, self::ADMIN);

        self::assertSame(200, $response->getStatusCode());
        self::assertSame(self::OTHER, $this->storedEntries()[0][KvSchema::ENTRY_PERSON_ID]);
        self::assertSame(1, $this->churchTools->countCalls(['personStatus']));
    }

    // ---------------------------------------------------------------- DELETE

    public function testUserDeletesOwnEntryOnly(): void
    {
        $this->seedEntry(self::USER);
        $this->seedEntry(self::OTHER);

        $response = $this->request('DELETE', '/v1/entries/' . self::USER, self::USER);

        self::assertSame(204, $response->getStatusCode());
        $remaining = $this->storedEntries();
        self::assertCount(1, $remaining);
        self::assertSame(self::OTHER, $remaining[0][KvSchema::ENTRY_PERSON_ID]);
    }

    public function testDeletingWithoutAnEntryIs204(): void
    {
        $response = $this->request('DELETE', '/v1/entries/' . self::USER, self::USER);

        self::assertSame(204, $response->getStatusCode());
    }

    // ---------------------------------------------------------------- logging

    public function testNoSecretReachesTheLog(): void
    {
        $this->setSettings([KvSchema::SETTING_REQUIRE_PRIMARY_PASSWORD => true]);

        $this->request('PUT', '/v1/entries/' . self::USER, self::USER, ['primaryPwd' => 'wrong-primary', 'secondaryPwd' => 'Custom-pass12!']);
        $this->request('PUT', '/v1/entries/' . self::USER, self::USER, ['primaryPwd' => $this->primaryPasswordOf(self::USER), 'secondaryPwd' => 'Custom-pass12!']);
        $this->request('GET', '/v1/entries/' . self::USER, self::USER);

        $secrets = ['wrong-primary', $this->primaryPasswordOf(self::USER), 'Custom-pass12!', $this->tokenOf(self::USER)];
        foreach ($this->log->getRecords() as $record) {
            $line = $record['message'] . ' ' . json_encode($record['context']);
            foreach ($secrets as $secret) {
                self::assertStringNotContainsString($secret, $line);
            }
        }
    }
}
