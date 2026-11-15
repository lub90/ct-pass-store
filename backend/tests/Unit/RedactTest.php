<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit;

use CtPassStore\Tests\Contract\Helpers\Redact;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class RedactTest extends TestCase
{
    /** @return iterable<string, array{string}> */
    public static function secrets(): iterable
    {
        yield 'flat' => ['{"clientSecret":"SECRETVALUE","id":1}'];
        yield 'nested' => ['{"data":{"a":{"access_token":"SECRETVALUE"}}}'];
        yield 'escaped quotes' => ['{"clientSecret":"SE\\"CRETVALUE\\" more","id":1}'];
        yield 'hyphenated key' => ['{"access-token":"SECRETVALUE"}'];
        yield 'digit key' => ['{"token2":"SECRETVALUE"}'];
        yield 'upper case key' => ['{"REFRESH_TOKEN":"SECRETVALUE"}'];
        yield 'in a list' => ['[{"password":"SECRETVALUE"},{"x":[{"code":"SECRETVALUE"}]}]'];
        yield 'entry field' => ['{"secondaryPwd":"SECRETVALUE"}'];
        yield 'non-scalar secret' => ['{"token":{"inner":"SECRETVALUE"}}'];
        yield 'non-JSON form' => ['client_secret=SECRETVALUE&grant_type=x'];
        yield 'html' => ['<html>SECRETVALUE</html>'];
        yield 'truncated JSON' => ['{"clientSecret":"SECRETVALUE'];
    }

    #[DataProvider('secrets')]
    public function testNoSecretSurvives(string $body): void
    {
        self::assertStringNotContainsString('SECRETVALUE', Redact::body($body));
        self::assertStringNotContainsString('CRETVALUE', Redact::body($body));
    }

    public function testOtherValuesStay(): void
    {
        $out = Redact::body('{"data":{"id":7,"name":"x","clientSecret":"s"}}');

        self::assertStringContainsString('"id":7', $out);
        self::assertStringContainsString('"name":"x"', $out);
    }

    public function testNonJsonShowsOnlyTheSize(): void
    {
        self::assertSame('<non-JSON body, 5 bytes>', Redact::body('a=b&c'));
    }

    public function testEmptyBody(): void
    {
        self::assertSame('<non-JSON body, 0 bytes>', Redact::body(''));
    }

    public function testLongOutputIsCut(): void
    {
        self::assertLessThanOrEqual(300, strlen(Redact::body(json_encode(['a' => str_repeat('x', 1000)]))));
    }
}
