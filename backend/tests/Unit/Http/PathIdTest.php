<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Http;

use CtPassStore\Http\PathId;
use CtPassStore\Http\Problem\ProblemException;
use CtPassStore\Http\Problem\ProblemType;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Catalog IN-01, IN-02, RX-04 (path IDs).
 */
final class PathIdTest extends TestCase
{
    /**
     * @return iterable<string, array{string, int}>
     */
    public static function valid(): iterable
    {
        yield 'one' => ['1', 1];
        yield 'regular' => ['947', 947];
        yield 'PHP_INT_MAX' => [(string) PHP_INT_MAX, PHP_INT_MAX];
    }

    #[DataProvider('valid')]
    public function testValidIds(string $raw, int $expected): void
    {
        self::assertSame($expected, PathId::parse($raw));
    }

    /**
     * @return iterable<string, array{mixed}>
     */
    public static function invalid(): iterable
    {
        yield 'zero' => ['0'];
        yield 'negative' => ['-1'];
        yield 'plus sign' => ['+1'];
        yield 'leading zero' => ['01'];
        yield 'float' => ['1.5'];
        yield 'float with zero fraction' => ['7.0'];
        yield 'exponent' => ['1e3'];
        yield 'letters' => ['abc'];
        yield 'leading space' => [' 1'];
        yield 'trailing space' => ['1 '];
        yield 'hex' => ['0x1'];
        yield 'one above PHP_INT_MAX' => ['9223372036854775808'];
        yield 'far above PHP_INT_MAX' => ['99999999999999999999999'];
        yield 'empty' => [''];
        yield 'null byte' => ["7\0"];
        yield 'newline' => ["7\n"];
        yield 'fullwidth digit' => ["\u{FF17}"];
        yield 'not a string' => [7];
        yield 'missing' => [null];
    }

    #[DataProvider('invalid')]
    public function testInvalidIdsAre400(mixed $raw): void
    {
        try {
            PathId::parse($raw);
            self::fail('Expected invalid-id.');
        } catch (ProblemException $e) {
            self::assertSame(ProblemType::InvalidId, $e->type);
        }
    }
}
