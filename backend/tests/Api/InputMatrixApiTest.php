<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Api;

use CtPassStore\Domain\PasswordPolicy;
use CtPassStore\Http\JsonBody;
use CtPassStore\Http\Problem\ProblemType;
use CtPassStore\Infrastructure\Kv\KvSchema;
use PHPUnit\Framework\Attributes\DataProvider;

/**
 * Input handling through the whole app (spec 4.1, 4.6): the API-level half of cases whose details are also unit
 * tested. Catalog IN-01, IN-02, IN-04, IN-05, IN-06, EC-01, EC-02, HP-03, TY-02, TY-03, RX-01, EP-11, EP-12, IJ-08.
 */
final class InputMatrixApiTest extends ApiTestCase
{
    private const PASSWORD = 'Custom-pass12!';

    /**
     * @param array<string, string> $headers
     */
    private function put(string $body, array $headers = ['Content-Type' => 'application/json']): \Psr\Http\Message\ResponseInterface
    {
        return $this->rawRequest('PUT', '/v1/entries/' . self::USER, self::USER, $body, $headers);
    }

    // ---------------------------------------------------------------- IN-01, IN-02

    public function testTheSmallestAndALargeIdAreAccepted(): void
    {
        $this->assertProblem(ProblemType::EntryNotFound, $this->request('GET', '/v1/entries/1', 1));
        $this->assertProblem(ProblemType::EntryNotFound, $this->request('GET', '/v1/entries/' . PHP_INT_MAX, PHP_INT_MAX));
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function invalidIds(): iterable
    {
        foreach (['0', '-1', '+1', '01', '1.5', '1e3', 'abc', '%201', '0x1', '9223372036854775808', '1%20'] as $id) {
            yield $id => [$id];
        }
    }

    #[DataProvider('invalidIds')]
    public function testInvalidIdsAre400WithoutCallingChurchTools(string $id): void
    {
        foreach (['GET', 'PUT', 'DELETE'] as $method) {
            $this->assertProblem(ProblemType::InvalidId, $this->request($method, '/v1/entries/' . $id, self::ADMIN, $method === 'GET' ? null : []));
        }
        self::assertSame([], $this->churchTools->calls());
    }

    public function testAnEmptyIdIsAnUnknownRoute(): void
    {
        // "/v1/entries/" has no {id} at all: the route doesn't match, so it's 404, never another person.
        $this->assertProblem(ProblemType::NotFound, $this->request('GET', '/v1/entries/', self::USER));
    }

    // ---------------------------------------------------------------- IN-04, IN-05, TY-03, EC-01, EC-02

    /**
     * @return iterable<string, array{string}>
     */
    public static function invalidBodies(): iterable
    {
        yield 'list' => ['[]'];
        yield 'string' => ['"text"'];
        yield 'number' => ['42'];
        yield 'null' => ['null'];
        yield 'invalid JSON' => ['{"secondaryPwd": '];
        yield 'secondaryPwd a number' => ['{"secondaryPwd": 123}'];
        yield 'secondaryPwd true' => ['{"secondaryPwd": true}'];
        yield 'primaryPwd a list' => ['{"primaryPwd": []}'];
        yield 'primaryPwd a number' => ['{"primaryPwd": 123456}'];
        yield 'lone continuation byte' => ["{\"secondaryPwd\": \"\x80abc\"}"];
        yield 'overlong encoding' => ["{\"secondaryPwd\": \"\xC0\xAF\"}"];
        yield 'surrogate half' => ['{"secondaryPwd": "' . "\xED\xA0\x80" . '"}'];
        yield 'UTF-8 BOM' => ["\xEF\xBB\xBF{\"secondaryPwd\": \"" . self::PASSWORD . '"}'];
        yield 'UTF-16' => [mb_convert_encoding('{"secondaryPwd": "' . self::PASSWORD . '"}', 'UTF-16LE', 'UTF-8')];
    }

    #[DataProvider('invalidBodies')]
    public function testInvalidBodiesAre400AndWriteNothing(string $body): void
    {
        $this->assertProblem(ProblemType::InvalidBody, $this->put($body));
        self::assertSame(0, $this->churchTools->writeCount());
    }

    public function testLoginFieldsAreNeverCastFromOtherTypes(): void
    {
        $response = $this->rawRequest('POST', '/v1/auth/token', null, '{"code": ["x"], "codeVerifier": "v", "redirectUri": "https://example.church.tools/ccm/ctpassstore/"}');

        $this->assertProblem(ProblemType::InvalidBody, $response);
        self::assertSame([], $this->churchTools->calls());
    }

    // ---------------------------------------------------------------- EC-02, HP-03

    /**
     * @return iterable<string, array{array<string, string>}>
     */
    public static function unsupportedContentTypes(): iterable
    {
        yield 'missing' => [[]];
        yield 'text/plain' => [['Content-Type' => 'text/plain']];
        yield 'multipart' => [['Content-Type' => 'multipart/form-data; boundary=x']];
        yield 'form' => [['Content-Type' => 'application/x-www-form-urlencoded']];
        yield 'latin1' => [['Content-Type' => 'application/json; charset=latin1']];
    }

    /**
     * @param array<string, string> $headers
     */
    #[DataProvider('unsupportedContentTypes')]
    public function testNonEmptyBodiesNeedJsonAsContentType(array $headers): void
    {
        $this->assertProblem(ProblemType::UnsupportedMediaType, $this->put('{"secondaryPwd": "' . self::PASSWORD . '"}', $headers));
        $this->assertProblem(ProblemType::UnsupportedMediaType, $this->put('secondaryPwd=' . self::PASSWORD, $headers + ['Content-Type' => 'application/x-www-form-urlencoded']));
        self::assertSame(0, $this->churchTools->writeCount());
    }

    public function testCharsetUtf8IsAcceptedAndAnEmptyBodyNeedsNoContentType(): void
    {
        self::assertSame(204, $this->put('{"secondaryPwd": "' . self::PASSWORD . '"}', ['Content-Type' => 'application/json; charset=utf-8'])->getStatusCode());
        self::assertSame(200, $this->put('', [])->getStatusCode(), 'An empty body generates a password.');
    }

    // ---------------------------------------------------------------- IN-06, RX-01

    public function testTheSizeLimitIsExactly16Kb(): void
    {
        $json = '{"secondaryPwd": "' . self::PASSWORD . '"}';
        // Padded with whitespace, which JSON allows, to exactly the limit.
        $exactly = substr($json, 0, -1) . str_repeat(' ', JsonBody::MAX_BYTES - strlen($json)) . '}';
        self::assertSame(JsonBody::MAX_BYTES, strlen($exactly));

        self::assertSame(204, $this->put($exactly)->getStatusCode());
        $this->assertProblem(ProblemType::PayloadTooLarge, $this->put(' ' . $exactly));
    }

    public function testNestingDepth(): void
    {
        // 32 levels are parsed; the request then fails only because the field is unknown.
        $at32 = '{"x": ' . str_repeat('[', 31) . str_repeat(']', 31) . '}';
        $body = $this->assertProblem(ProblemType::InvalidBody, $this->put($at32));
        self::assertStringContainsString('x', (string) $body['detail']);

        $this->assertProblem(ProblemType::InvalidBody, $this->put('{"x": ' . str_repeat('[', 32) . str_repeat(']', 32) . '}'));
        // 8,000 levels are the most that fit into 16 KB; deeper bodies are 413 first.
        $this->assertProblem(ProblemType::InvalidBody, $this->put(str_repeat('[', 8000) . str_repeat(']', 8000)));
        self::assertSame(0, $this->churchTools->writeCount());
    }

    // ---------------------------------------------------------------- TY-02

    /**
     * @return iterable<string, array{string}>
     */
    public static function smuggledFields(): iterable
    {
        foreach (['personId' => 11, 'id' => 1, 'dataCategoryId' => 1, 'role' => 'admin', 'isAdmin' => true, 'username' => 'admin'] as $field => $value) {
            yield $field => [json_encode(['secondaryPwd' => self::PASSWORD, $field => $value], JSON_THROW_ON_ERROR)];
        }
    }

    #[DataProvider('smuggledFields')]
    public function testExtraFieldsAreRejected(string $body): void
    {
        $this->assertProblem(ProblemType::InvalidBody, $this->put($body));
        self::assertSame(0, $this->churchTools->writeCount());
    }

    public function testTheStoredValueHasExactlyPersonIdAndSecondaryPwd(): void
    {
        $this->put('{"secondaryPwd": "' . self::PASSWORD . '"}');

        $entries = $this->storedEntries();
        self::assertCount(1, $entries);
        self::assertSame([KvSchema::ENTRY_PERSON_ID, KvSchema::ENTRY_CIPHERTEXT], array_keys($entries[0]));
        self::assertSame(self::USER, $entries[0][KvSchema::ENTRY_PERSON_ID], 'The person ID comes from the path.');
    }

    // ---------------------------------------------------------------- EP-11

    /**
     * Each kind of policy violation (PV-03a, PV-05, PV-13 to PV-16) at the API, with length 12.
     *
     * @return iterable<string, array{string, list<string>}>
     */
    public static function policyViolations(): iterable
    {
        yield 'one too short' => ['Abcdefgh12!', [PasswordPolicy::TOO_SHORT]];
        yield 'half' => ['Abc1!a', [PasswordPolicy::TOO_SHORT]];
        yield 'one character' => ['A', [PasswordPolicy::TOO_SHORT, PasswordPolicy::MISSING_DIGIT, PasswordPolicy::MISSING_SYMBOL]];
        yield 'no letter' => ['1234567890!!', [PasswordPolicy::MISSING_LETTER]];
        yield 'no digit' => ['Abcdefghijk!', [PasswordPolicy::MISSING_DIGIT]];
        yield 'no symbol' => ['Abcdefghij12', [PasswordPolicy::MISSING_SYMBOL]];
        yield 'only letters' => ['Abcdefghijkl', [PasswordPolicy::MISSING_DIGIT, PasswordPolicy::MISSING_SYMBOL]];
        yield 'only symbols' => ['!!!!!!!!!!!!', [PasswordPolicy::MISSING_LETTER, PasswordPolicy::MISSING_DIGIT]];
        yield 'long without a symbol' => ['A1' . str_repeat('b', 62), [PasswordPolicy::MISSING_SYMBOL]];
        yield 'too long' => ['A1!' . str_repeat('b', 126), [PasswordPolicy::TOO_LONG]];
        yield 'space' => ['Abcdefgh 12!', [PasswordPolicy::INVALID_CHARACTER]];
        yield 'invalid character and too short' => ['Ab1!#', [PasswordPolicy::TOO_SHORT, PasswordPolicy::INVALID_CHARACTER]];
    }

    /**
     * @param list<string> $violations
     */
    #[DataProvider('policyViolations')]
    public function testEachViolationIsReportedAndNothingIsStored(string $password, array $violations): void
    {
        $body = $this->assertProblem(ProblemType::PasswordInvalid, $this->request('PUT', '/v1/entries/' . self::USER, self::USER, ['secondaryPwd' => $password]));

        self::assertSame($violations, $body['violations']);
        self::assertSame(0, $this->churchTools->writeCount());
    }

    // ---------------------------------------------------------------- EP-12

    public function testAFailingEncryptionKeepsTheOldEntryAndReturnsNoPlaintext(): void
    {
        $this->seedEntry(self::USER, 'b2xk');
        // A key that can't be used for encryption (RSA 2048, too short): encrypting fails.
        $this->churchTools->clearValues($this->categoryIds[KvSchema::ENCRYPTION_CATEGORY]);
        $this->churchTools->seedValue($this->categoryIds[KvSchema::ENCRYPTION_CATEGORY], json_encode([KvSchema::PUBLIC_KEY => file_get_contents(__DIR__ . '/../keys/invalid/rsa2048.pub.pem')], JSON_THROW_ON_ERROR));

        $generated = $this->request('PUT', '/v1/entries/' . self::USER, self::USER);
        $custom = $this->request('PUT', '/v1/entries/' . self::USER, self::USER, ['secondaryPwd' => self::PASSWORD]);

        foreach ([$generated, $custom] as $response) {
            self::assertGreaterThanOrEqual(500, $response->getStatusCode());
            self::assertStringNotContainsString('secondaryPwd', (string) $response->getBody());
            self::assertStringNotContainsString(self::PASSWORD, (string) $response->getBody());
        }
        self::assertSame([['personId' => self::USER, 'secondaryPwd' => 'b2xk']], $this->storedEntries());
    }

    // ---------------------------------------------------------------- IJ-08

    public function testMethodOverridesAreIgnored(): void
    {
        $this->seedEntry(self::USER);

        $overridden = $this->request('GET', '/v1/entries/' . self::USER, self::USER, headers: ['X-HTTP-Method-Override' => 'DELETE']);
        self::assertSame(200, $overridden->getStatusCode());

        $this->assertProblem(ProblemType::MethodNotAllowed, $this->request('POST', '/v1/entries/' . self::USER . '?_method=DELETE', self::USER, []));
        $this->assertProblem(ProblemType::MethodNotAllowed, $this->rawRequest('POST', '/v1/entries/' . self::USER, self::USER, '{"_method": "PUT", "secondaryPwd": "' . self::PASSWORD . '"}'));
        $this->assertProblem(ProblemType::MethodNotAllowed, $this->rawRequest('POST', '/v1/entries/' . self::USER, self::USER, '_method=DELETE', ['Content-Type' => 'application/x-www-form-urlencoded']));

        self::assertCount(1, $this->storedEntries(), 'Nothing was deleted or changed.');
        self::assertSame(0, $this->churchTools->writeCount());
    }
}
