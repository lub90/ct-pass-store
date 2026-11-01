<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Service;

use CtPassStore\Service\PasswordValidator;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;

/**
 * Covers the current behavior of the password policy (spec 5.1, rules 1–3 and generation rules 1–3).
 * The planned changes (maximum length, violations, secure shuffle) get their tests together with the change.
 */
final class PasswordValidatorTest extends TestCase
{
    private const ALLOWED = '/^[A-Za-z0-9!@$%&*\-_+=?.]+$/';

    private PasswordValidator $validator;

    protected function setUp(): void
    {
        $this->validator = new PasswordValidator(new NullLogger());
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function validPasswords(): iterable
    {
        yield 'exactly the minimum length' => ['Abcdefgh12!?'];
        yield 'longer than the minimum' => ['longPASSword77-?'];
        yield 'every allowed symbol' => ['Aa1!@$%&*-_+=?.'];
        yield 'one of each class, rest letters' => ['abcdefghij1.'];
    }

    #[DataProvider('validPasswords')]
    public function testAcceptsValidPasswords(string $password): void
    {
        self::assertTrue($this->validator->isValid($password, 12));
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function invalidPasswords(): iterable
    {
        yield 'one character too short' => ['Abcdefg12!?'];
        yield 'empty' => [''];
        yield 'no letter' => ['1234567890!?'];
        yield 'no digit' => ['Abcdefghij!?'];
        yield 'no symbol' => ['Abcdefghij12'];
        yield 'space' => ['Abcdefgh12! '];
        yield 'hash sign' => ['Abcdefgh12!#'];
        yield 'umlaut' => ['Abcdefgh12!ä'];
        yield 'emoji' => ['Abcdefgh12!🙂'];
        yield 'null byte' => ["Abcdefgh12!\0"];
        yield 'newline' => ["Abcdefgh12!\n"];
    }

    #[DataProvider('invalidPasswords')]
    public function testRejectsInvalidPasswords(string $password): void
    {
        self::assertFalse($this->validator->isValid($password, 12));
    }

    /**
     * @return iterable<string, array{int}>
     */
    public static function generatedLengths(): iterable
    {
        yield 'smallest possible' => [3];
        yield 'default' => [12];
        yield 'long' => [64];
    }

    #[DataProvider('generatedLengths')]
    public function testGeneratedPasswordsHaveTheRequestedLengthAndPassValidation(int $length): void
    {
        for ($i = 0; $i < 200; $i++) {
            $password = $this->validator->generateRandom($length);

            self::assertSame($length, strlen($password));
            self::assertMatchesRegularExpression(self::ALLOWED, $password);
            self::assertTrue($this->validator->isValid($password, $length), "Generated password failed validation: $password");
        }
    }

    public function testGeneratedPasswordsDiffer(): void
    {
        $passwords = [];
        for ($i = 0; $i < 100; $i++) {
            $passwords[] = $this->validator->generateRandom(12);
        }

        self::assertCount(100, array_unique($passwords));
    }

    public function testGenerationRejectsLengthsThatCantSatisfyTheRules(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        $this->validator->generateRandom(2);
    }
}
