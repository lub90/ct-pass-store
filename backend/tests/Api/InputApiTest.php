<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Api;

use CtPassStore\Config\AppConfig;
use CtPassStore\Http\Problem\ProblemType;
use CtPassStore\Service\PasswordValidator;
use PHPUnit\Framework\Attributes\DataProvider;

/**
 * Input validation and the order of checks through the whole app (spec 4.1, 4.6). Catalog IN-01 to IN-06, AZ-02,
 * AZ-11, PR-01 (partly), EP-04, EP-05, EP-09, EP-11, PP-12, TY-01, TY-02, EC-01, HP-03.
 */
final class InputApiTest extends ApiTestCase
{
    // ---------------------------------------------------------------- IDs (IN-01, IN-02, AZ-02)

    public function testLargeValidIdIsAccepted(): void
    {
        $response = $this->request('GET', '/entries/' . PHP_INT_MAX, self::ADMIN);

        $this->assertProblem(ProblemType::EntryNotFound, $response);
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function invalidIds(): iterable
    {
        yield 'zero' => ['0'];
        yield 'leading zero' => ['010'];
        yield 'plus' => ['+10'];
        yield 'float' => ['10.0'];
        yield 'exponent' => ['1e1'];
        yield 'letters' => ['abc'];
        yield 'too large' => ['99999999999999999999'];
        yield 'encoded newline' => ['10%0A'];
    }

    #[DataProvider('invalidIds')]
    public function testInvalidIdsAre400WithoutTouchingTheStore(string $id): void
    {
        foreach (['GET', 'PUT', 'DELETE'] as $method) {
            $response = $this->request($method, '/entries/' . $id, self::USER);

            $this->assertProblem(ProblemType::InvalidId, $response);
        }
        self::assertSame(0, $this->churchTools->writeCount());
        self::assertSame(0, $this->churchTools->countCalls(['getModuleByKey']), 'Invalid IDs are rejected before any KV access.');
    }

    // ---------------------------------------------------------------- order of checks (PR-01, AZ-11, EP-09)

    public function testWithoutTokenAnInvalidIdIs401(): void
    {
        $this->assertProblem(ProblemType::MissingToken, $this->request('GET', '/entries/abc'));
    }

    public function testInvalidBodyComesBeforeAuthorization(): void
    {
        $response = $this->rawRequest('PUT', '/entries/' . self::OTHER, self::USER, '{"secondaryPwd": 1}');

        $this->assertProblem(ProblemType::InvalidBody, $response);
    }

    public function testValidBodyOnAnotherPersonsEntryIs403(): void
    {
        $response = $this->request('PUT', '/entries/' . self::OTHER, self::USER, [AppConfig::REQUEST_SECONDARY_PWD_FIELD => 'Custom-pass12!']);

        $this->assertProblem(ProblemType::Forbidden, $response);
    }

    public function testNoExistenceOracle(): void
    {
        $this->seedEntry(self::OTHER);

        $existing = $this->request('GET', '/entries/' . self::OTHER, self::USER);
        $missing = $this->request('GET', '/entries/' . (self::OTHER + 1000), self::USER);

        $this->assertProblem(ProblemType::Forbidden, $existing);
        $this->assertProblem(ProblemType::Forbidden, $missing);
        $storeReads = array_filter(
            $this->churchTools->calls(),
            fn(array $call): bool => $call['method'] === 'getValues' && $call['args'][1] === $this->categoryIds[AppConfig::CT_PWD_CATEGORY_NAME],
        );
        self::assertSame([], $storeReads, 'The password store isn\'t read before authorization.');
    }

    public function testAuthorizationComesBeforeThePrimaryPassword(): void
    {
        $this->setSettings([AppConfig::CT_REQUIRE_PWD_FOR_PWD_CHANGE_FIELD_NAME => true]);

        $response = $this->request('PUT', '/entries/' . self::OTHER, self::USER, []);

        $this->assertProblem(ProblemType::Forbidden, $response);
        self::assertSame(0, $this->churchTools->countCalls(['verifyLogin']));
    }

    public function testPrimaryPasswordComesBeforeThePolicy(): void
    {
        $this->setSettings([AppConfig::CT_REQUIRE_PWD_FOR_PWD_CHANGE_FIELD_NAME => true]);

        $response = $this->request('PUT', '/entries/' . self::USER, self::USER, [AppConfig::REQUEST_SECONDARY_PWD_FIELD => 'short']);

        $this->assertProblem(ProblemType::PrimaryPasswordRequired, $response);
    }

    // ---------------------------------------------------------------- bodies (IN-03 to IN-06, TY, EC-01, HP-03)

    public function testEmptyBodyOrEmptyObjectGeneratesAPassword(): void
    {
        self::assertSame(200, $this->request('PUT', '/entries/' . self::USER, self::USER)->getStatusCode());
        self::assertSame(200, $this->request('PUT', '/entries/' . self::USER, self::USER, [])->getStatusCode());
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function invalidBodies(): iterable
    {
        yield 'array' => ['[]'];
        yield 'string' => ['"text"'];
        yield 'null' => ['null'];
        yield 'invalid JSON' => ['{oops'];
        yield 'invalid UTF-8' => ["{\"secondaryPwd\": \"\xC0\xAF\"}"];
        yield 'duplicate key' => ['{"secondaryPwd": "Custom-pass12!", "secondaryPwd": "x"}'];
        yield 'mass assignment' => ['{"secondaryPwd": "Custom-pass12!", "personId": 11}'];
        yield 'wrong type' => ['{"secondaryPwd": 123456789012}'];
    }

    #[DataProvider('invalidBodies')]
    public function testInvalidBodiesAre400AndWriteNothing(string $body): void
    {
        $response = $this->rawRequest('PUT', '/entries/' . self::USER, self::USER, $body);

        $this->assertProblem(ProblemType::InvalidBody, $response);
        self::assertSame(0, $this->churchTools->writeCount());
    }

    public function testUsernameInTheBodyIsRejected(): void
    {
        $this->setSettings([AppConfig::CT_REQUIRE_PWD_FOR_PWD_CHANGE_FIELD_NAME => true]);

        $response = $this->rawRequest('PUT', '/entries/' . self::USER, self::USER, json_encode([
            AppConfig::REQUEST_PRIMARY_PWD_FIELD => $this->primaryPasswordOf(self::OTHER),
            'username' => 'other',
        ], JSON_THROW_ON_ERROR));

        $this->assertProblem(ProblemType::InvalidBody, $response);
        self::assertSame(0, $this->churchTools->countCalls(['verifyLogin']));
    }

    public function testAnotherUsersCorrectPrimaryPasswordIsRejected(): void
    {
        $this->setSettings([AppConfig::CT_REQUIRE_PWD_FOR_PWD_CHANGE_FIELD_NAME => true]);

        $response = $this->request('PUT', '/entries/' . self::USER, self::USER, [AppConfig::REQUEST_PRIMARY_PWD_FIELD => $this->primaryPasswordOf(self::OTHER)]);

        $this->assertProblem(ProblemType::InvalidPrimaryPassword, $response);
    }

    public function testFormEncodedBodyIs415(): void
    {
        $response = $this->rawRequest('PUT', '/entries/' . self::USER, self::USER, 'secondaryPwd=Custom-pass12!', ['Content-Type' => 'application/x-www-form-urlencoded']);

        $this->assertProblem(ProblemType::UnsupportedMediaType, $response);
        self::assertSame(0, $this->churchTools->writeCount());
    }

    public function testBodyOver16KbIs413(): void
    {
        $response = $this->rawRequest('PUT', '/entries/' . self::USER, self::USER, '{"secondaryPwd": "' . str_repeat('a', 17_000) . '"}');

        $this->assertProblem(ProblemType::PayloadTooLarge, $response);
    }

    public function testDeleteAcceptsOnlyThePrimaryPassword(): void
    {
        $response = $this->rawRequest('DELETE', '/entries/' . self::USER, self::USER, '{"secondaryPwd": "x"}');

        $this->assertProblem(ProblemType::InvalidBody, $response);
    }

    // ---------------------------------------------------------------- policy through the API (EP-04, EP-05, EP-11)

    public function testEmptyCustomPasswordIsACustomPasswordNotAGeneratedOne(): void
    {
        $response = $this->request('PUT', '/entries/' . self::USER, self::USER, [AppConfig::REQUEST_SECONDARY_PWD_FIELD => '']);

        $body = $this->assertProblem(ProblemType::PasswordInvalid, $response);
        self::assertContains(PasswordValidator::TOO_SHORT, $body['violations']);
    }

    /**
     * @return iterable<string, array{string, list<string>}>
     */
    public static function policyViolations(): iterable
    {
        yield 'too short' => ['Aa1!bbbb', [PasswordValidator::TOO_SHORT]];
        yield 'too long' => ['Aa1!' . str_repeat('b', 125), [PasswordValidator::TOO_LONG]];
        yield 'only letters' => ['Abcdefghijkl', [PasswordValidator::MISSING_DIGIT, PasswordValidator::MISSING_SYMBOL]];
        yield 'invalid character' => ['Abcdefgh12!#', [PasswordValidator::INVALID_CHARACTER]];
        yield 'umlaut' => ['Abcdefgh12!ä', [PasswordValidator::INVALID_CHARACTER]];
    }

    /**
     * @param list<string> $expected
     */
    #[DataProvider('policyViolations')]
    public function testPolicyViolationsAreListedAndNothingIsStored(string $password, array $expected): void
    {
        $response = $this->request('PUT', '/entries/' . self::USER, self::USER, [AppConfig::REQUEST_SECONDARY_PWD_FIELD => $password]);

        $body = $this->assertProblem(ProblemType::PasswordInvalid, $response);
        self::assertSame($expected, $body['violations']);
        self::assertSame(0, $this->churchTools->writeCount());
    }

    public function testGeneratedPasswordFollowsTheConfiguredLength(): void
    {
        $this->setSettings(['passwordLength' => 20]);

        $response = $this->request('PUT', '/entries/' . self::USER, self::USER);

        self::assertSame(20, strlen((string) $this->json($response)[AppConfig::REQUEST_SECONDARY_PWD_FIELD]));
    }
}
