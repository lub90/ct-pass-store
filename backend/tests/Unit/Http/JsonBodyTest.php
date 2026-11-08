<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Http;

use CtPassStore\Http\JsonBody;
use CtPassStore\Http\Problem\ProblemException;
use CtPassStore\Http\Problem\ProblemType;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Slim\Psr7\Factory\ServerRequestFactory;
use Slim\Psr7\Factory\StreamFactory;

/**
 * Request body rules (spec 4.1). Catalog IN-03 to IN-06, EC-01, EC-02, TY-01 to TY-03, HP-03, RX-01.
 */
final class JsonBodyTest extends TestCase
{
    private const FIELDS = ['primaryPwd' => 'string', 'secondaryPwd' => 'string'];

    /**
     * @return array<string, string>
     */
    private function parse(string $body, ?string $contentType = 'application/json'): array
    {
        $request = (new ServerRequestFactory())->createServerRequest('PUT', 'https://x/entries/1')
            ->withBody((new StreamFactory())->createStream($body));
        if ($contentType !== null) {
            $request = $request->withHeader('Content-Type', $contentType);
        }

        return JsonBody::parse($request, self::FIELDS);
    }

    private function assertProblem(ProblemType $type, string $body, ?string $contentType = 'application/json'): void
    {
        try {
            $this->parse($body, $contentType);
            self::fail("Expected {$type->value}.");
        } catch (ProblemException $e) {
            self::assertSame($type, $e->type, $e->detail);
        }
    }

    // ---------------------------------------------------------------- valid

    public function testEmptyBodyIsAnEmptyObjectWithoutContentType(): void
    {
        self::assertSame([], $this->parse('', null));
    }

    public function testEmptyObject(): void
    {
        self::assertSame([], $this->parse('{}'));
        self::assertSame([], $this->parse(" { } \n"));
    }

    public function testKnownFields(): void
    {
        self::assertSame(['primaryPwd' => 'a', 'secondaryPwd' => 'b'], $this->parse('{"primaryPwd": "a", "secondaryPwd": "b"}'));
    }

    public function testUnicodeEscapesAreDecoded(): void
    {
        self::assertSame(['secondaryPwd' => 'ä'], $this->parse('{"secondaryPwd": "ä"}'));
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function acceptedContentTypes(): iterable
    {
        yield 'plain' => ['application/json'];
        yield 'with charset' => ['application/json; charset=utf-8'];
        yield 'uppercase' => ['Application/JSON; Charset=UTF-8'];
        yield 'no space' => ['application/json;charset=utf-8'];
    }

    #[DataProvider('acceptedContentTypes')]
    public function testAcceptedContentTypes(string $contentType): void
    {
        self::assertSame(['primaryPwd' => 'x'], $this->parse('{"primaryPwd": "x"}', $contentType));
    }

    // ---------------------------------------------------------------- 415

    /**
     * @return iterable<string, array{string|null}>
     */
    public static function rejectedContentTypes(): iterable
    {
        yield 'missing' => [null];
        yield 'text/plain' => ['text/plain'];
        yield 'form' => ['application/x-www-form-urlencoded'];
        yield 'multipart' => ['multipart/form-data; boundary=x'];
        yield 'latin1' => ['application/json; charset=latin1'];
        yield 'json suffix' => ['application/vnd.evil+json'];
    }

    #[DataProvider('rejectedContentTypes')]
    public function testOtherContentTypesAre415(?string $contentType): void
    {
        $this->assertProblem(ProblemType::UnsupportedMediaType, '{"primaryPwd": "x"}', $contentType);
    }

    // ---------------------------------------------------------------- 413

    public function testSizeBoundary(): void
    {
        $exactly = '{"secondaryPwd": "' . str_repeat('a', JsonBody::MAX_BYTES - 20) . '"}';
        self::assertSame(JsonBody::MAX_BYTES, strlen($exactly));
        self::assertArrayHasKey('secondaryPwd', $this->parse($exactly));

        $this->assertProblem(ProblemType::PayloadTooLarge, $exactly . ' ');
    }

    /**
     * Streams may return fewer bytes than asked for and may not know their size (e.g. a chunked request).
     */
    public function testBodiesAreReadCompletelyFromChunkedStreams(): void
    {
        $chunked = static function (string $body): \Psr\Http\Message\StreamInterface {
            $inner = (new StreamFactory())->createStream($body);

            return \GuzzleHttp\Psr7\FnStream::decorate($inner, [
                'read' => static fn(int $length): string => $inner->read(min($length, 3)),
                'getSize' => static fn(): ?int => null,
                'isSeekable' => static fn(): bool => false,
            ]);
        };
        $request = static fn(string $body) => (new ServerRequestFactory())->createServerRequest('PUT', 'https://x/entries/1')
            ->withHeader('Content-Type', 'application/json')
            ->withBody($chunked($body));

        self::assertSame(['primaryPwd' => 'abc', 'secondaryPwd' => 'def'], JsonBody::parse($request('{"primaryPwd": "abc", "secondaryPwd": "def"}'), self::FIELDS));

        try {
            JsonBody::parse($request('{"primaryPwd": "' . str_repeat('a', 20_000) . '"}'), self::FIELDS);
            self::fail('Expected 413.');
        } catch (\CtPassStore\Http\Problem\ProblemException $e) {
            self::assertSame(ProblemType::PayloadTooLarge, $e->type);
        }
    }

    public function testTooLargeIsCheckedBeforeTheContentType(): void
    {
        $this->assertProblem(ProblemType::PayloadTooLarge, str_repeat('x', JsonBody::MAX_BYTES + 1), 'text/plain');
    }

    // ---------------------------------------------------------------- 400 invalid-body

    /**
     * @return iterable<string, array{string}>
     */
    public static function invalidBodies(): iterable
    {
        yield 'array' => ['[]'];
        yield 'list' => ['["a"]'];
        yield 'string' => ['"text"'];
        yield 'number' => ['42'];
        yield 'null' => ['null'];
        yield 'true' => ['true'];
        yield 'invalid JSON' => ['{"primaryPwd": }'];
        yield 'trailing comma' => ['{"primaryPwd": "a",}'];
        yield 'two objects' => ['{}{}'];
        yield 'invalid UTF-8 continuation byte' => ["{\"primaryPwd\": \"\x80\"}"];
        yield 'overlong UTF-8' => ["{\"primaryPwd\": \"\xC0\xAF\"}"];
        yield 'surrogate half' => ['{"primaryPwd": "' . "\xED\xA0\x80" . '"}'];
        yield 'UTF-8 BOM' => ["\xEF\xBB\xBF{\"primaryPwd\": \"a\"}"];
        yield 'UTF-16' => [mb_convert_encoding('{"primaryPwd": "a"}', 'UTF-16LE', 'UTF-8')];
        yield 'duplicate key' => ['{"secondaryPwd": "a", "secondaryPwd": "b"}'];
        yield 'duplicate key, escaped' => ['{"secondaryPwd": "a", "secondary\u0050wd": "b"}'];
        yield 'duplicate key, escaped first' => ['{"secondary\u0050wd": "a", "secondaryPwd": "b"}'];
        yield 'unknown field, escaped' => ['{"user\u006eame": "admin"}'];
        yield 'unknown field' => ['{"personId": 5}'];
        yield 'mass assignment' => ['{"secondaryPwd": "a", "isAdmin": true}'];
        yield 'username smuggling' => ['{"primaryPwd": "a", "username": "admin"}'];
        yield 'number instead of string' => ['{"primaryPwd": 123456}'];
        yield 'boolean instead of string' => ['{"secondaryPwd": true}'];
        yield 'array instead of string' => ['{"primaryPwd": ["x"]}'];
        yield 'null value' => ['{"primaryPwd": null}'];
        yield 'object value' => ['{"primaryPwd": {"a": 1}}'];
    }

    #[DataProvider('invalidBodies')]
    public function testInvalidBodiesAre400(string $body): void
    {
        $this->assertProblem(ProblemType::InvalidBody, $body);
    }

    public function testNestingDepthBoundary(): void
    {
        $nested = static fn(int $levels): string => '{"primaryPwd": ' . str_repeat('[', $levels - 1) . str_repeat(']', $levels - 1) . '}';

        // 32 levels can be parsed (then the field type is wrong); 33 can't be parsed at all.
        try {
            $this->parse($nested(32));
            self::fail('Expected invalid-body.');
        } catch (ProblemException $e) {
            self::assertStringContainsString('string', $e->detail);
        }
        try {
            $this->parse($nested(33));
            self::fail('Expected invalid-body.');
        } catch (ProblemException $e) {
            self::assertSame(ProblemType::InvalidBody, $e->type);
            self::assertStringContainsString('nested', $e->detail);
        }
        // 5,000 levels stay under the 16 KB limit, so this really hits the depth check.
        $this->assertProblem(ProblemType::InvalidBody, str_repeat('[', 5_000) . str_repeat(']', 5_000));
    }

    public function testDuplicateKeysInNestedValuesDontCountAsTopLevelDuplicates(): void
    {
        // Only top-level keys are fields; this is rejected for its type, not as a duplicate.
        try {
            $this->parse('{"primaryPwd": {"a": 1, "a": 2}}');
            self::fail('Expected invalid-body.');
        } catch (ProblemException $e) {
            self::assertStringContainsString('string', $e->detail);
        }
    }

    public function testStringsWithBracesAndQuotesDontConfuseTheKeyScanner(): void
    {
        self::assertSame(['primaryPwd' => '{"secondaryPwd": "x"}, \\"', 'secondaryPwd' => 'y'], $this->parse('{"primaryPwd": "{\"secondaryPwd\": \"x\"}, \\\\\"", "secondaryPwd": "y"}'));
    }

    public function testFieldNamesInMessagesAreSanitized(): void
    {
        try {
            $this->parse('{"evil\\nname\\u0000<script>": "x"}');
            self::fail('Expected invalid-body.');
        } catch (ProblemException $e) {
            self::assertStringNotContainsString("\n", $e->detail);
            self::assertStringNotContainsString("\0", $e->detail);
        }
    }
}
