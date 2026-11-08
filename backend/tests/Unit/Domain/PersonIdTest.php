<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Domain;

use CtPassStore\Domain\PersonId;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class PersonIdTest extends TestCase
{
    public function testHoldsAPositiveId(): void
    {
        self::assertSame(7, (new PersonId(7))->value);
        self::assertSame('7', (string) new PersonId(7));
        self::assertSame(PHP_INT_MAX, (new PersonId(PHP_INT_MAX))->value);
    }

    /**
     * 0 is reserved for the self-test (spec 5.3.11); negative IDs don't exist.
     */
    #[DataProvider('invalidIds')]
    public function testRejectsZeroAndNegativeIds(int $value): void
    {
        $this->expectException(\InvalidArgumentException::class);
        new PersonId($value);
    }

    /**
     * @return iterable<string, array{int}>
     */
    public static function invalidIds(): iterable
    {
        yield 'self-test ID' => [0];
        yield 'negative' => [-1];
        yield 'PHP_INT_MIN' => [PHP_INT_MIN];
    }

    public function testEqualityComparesTheValue(): void
    {
        self::assertTrue((new PersonId(7))->equals(new PersonId(7)));
        self::assertFalse((new PersonId(7))->equals(new PersonId(8)));
    }

    /**
     * The one rule for decimal IDs from paths, tokens and stored values.
     */
    public function testDecimal(): void
    {
        self::assertSame(0, PersonId::decimal('0'));
        self::assertSame(7, PersonId::decimal('7'));
        self::assertSame(PHP_INT_MAX, PersonId::decimal((string) PHP_INT_MAX), 'All 19 digits.');
        foreach (['', '07', '+7', '-7', ' 7', '7 ', '7.0', '1e3', '0x1', 'abc', '9223372036854775808', '99999999999999999999', "7\n"] as $invalid) {
            self::assertNull(PersonId::decimal($invalid), var_export($invalid, true));
        }
    }
}
