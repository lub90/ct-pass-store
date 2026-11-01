<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Service;

use CtPassStore\Service\PasswordValidator;
use phpseclib3\Crypt\PublicKeyLoader;
use phpseclib3\Crypt\RSA;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;
use Random\Engine\Mt19937;
use Random\Engine\Secure;
use Random\Randomizer;

/**
 * The password policy (spec 5.1). Catalog section 1: PV-01 to PV-17, PG-01 to PG-06.
 */
final class PasswordValidatorTest extends TestCase
{
    private const ALLOWED = '/^[A-Za-z0-9!@$%&*\-_+=?.]+$/';
    private const ALLOWED_SET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@$%&*-_+=?.';

    private PasswordValidator $validator;

    protected function setUp(): void
    {
        $this->validator = new PasswordValidator(new NullLogger());
    }

    // ---------------------------------------------------------------- valid (PV-01, PV-02, PV-06, PV-06a)

    /**
     * @return iterable<string, array{string}>
     */
    public static function validPasswords(): iterable
    {
        yield 'exactly the minimum length' => ['Abcdefgh12!?'];
        yield 'longer than the minimum' => ['longPASSword77-?'];
        yield 'every allowed symbol' => ['Aa1!@$%&*-_+=?.'];
        yield 'one of each class, rest letters' => ['abcdefghij1.'];
        yield 'maximum length' => ['Aa1!' . str_repeat('x', 124)];
    }

    #[DataProvider('validPasswords')]
    public function testAcceptsValidPasswords(string $password): void
    {
        self::assertTrue($this->validator->isValid($password, 12));
        self::assertSame([], $this->validator->violations($password, 12));
    }

    public function testEveryAllowedCharacterIsAccepted(): void
    {
        foreach (str_split(self::ALLOWED_SET) as $char) {
            self::assertTrue($this->validator->isValid('Aa1!bbbbbbbb' . $char, 12), "Character '$char' must be allowed.");
        }
    }

    // ---------------------------------------------------------------- length (PV-03, PV-03a, PV-04, PV-09, PV-17)

    /**
     * @return iterable<string, array{int}>
     */
    public static function tooShortLengths(): iterable
    {
        yield 'one too short' => [11];
        yield 'two too short' => [10];
        yield 'half' => [6];
        yield 'one of each class' => [3];
    }

    #[DataProvider('tooShortLengths')]
    public function testTooShortWithAllClassesIsOnlyTooShort(int $length): void
    {
        $password = substr('Aa1!' . str_repeat('b', 20), 0, $length);
        if ($length === 3) {
            $password = 'a1!';
        }

        self::assertSame([PasswordValidator::TOO_SHORT], $this->validator->violations($password, 12));
    }

    public function testEmptyPasswordBreaksEveryCharacterRule(): void
    {
        self::assertSame([PasswordValidator::TOO_SHORT, PasswordValidator::MISSING_LETTER, PasswordValidator::MISSING_DIGIT, PasswordValidator::MISSING_SYMBOL], $this->validator->violations('', 12));
    }

    public function testMaximumLengthBoundary(): void
    {
        $base = 'Aa1!';
        self::assertSame([], $this->validator->violations($base . str_repeat('x', 124), 12), '128 characters are allowed.');
        self::assertSame([PasswordValidator::TOO_LONG], $this->validator->violations($base . str_repeat('x', 125), 12), '129 characters are too long.');
    }

    public function testTooLongIsReportedAloneEvenForHugeInput(): void
    {
        // Only too-long, although the input also breaks every other rule: the length is checked first and alone.
        self::assertSame([PasswordValidator::TOO_LONG], $this->validator->violations(str_repeat('#', 5_000_000), 12));
    }

    /**
     * @return iterable<string, array{int}>
     */
    public static function settingLengths(): iterable
    {
        yield '12' => [12];
        yield '20' => [20];
        yield '64' => [64];
    }

    #[DataProvider('settingLengths')]
    public function testMinimumComesFromTheSetting(int $setting): void
    {
        $password = 'Aa1!' . str_repeat('b', $setting - 4);

        self::assertTrue($this->validator->isValid($password, $setting));
        self::assertSame([PasswordValidator::TOO_SHORT], $this->validator->violations($password, $setting + 1));
    }

    // ---------------------------------------------------------------- classes (PV-05, PV-13, PV-14, PV-16)

    /**
     * @return iterable<string, array{string, list<string>}>
     */
    public static function missingClasses(): iterable
    {
        yield 'no letter' => ['1234567890!?', [PasswordValidator::MISSING_LETTER]];
        yield 'no digit' => ['Abcdefghij!?', [PasswordValidator::MISSING_DIGIT]];
        yield 'no symbol' => ['Abcdefghij12', [PasswordValidator::MISSING_SYMBOL]];
        yield 'only letters' => ['Abcdefghijkl', [PasswordValidator::MISSING_DIGIT, PasswordValidator::MISSING_SYMBOL]];
        yield 'only digits' => ['123456789012', [PasswordValidator::MISSING_LETTER, PasswordValidator::MISSING_SYMBOL]];
        yield 'only symbols' => ['!@$%&*-_+=?.', [PasswordValidator::MISSING_LETTER, PasswordValidator::MISSING_DIGIT]];
        yield 'too short and no digit' => ['Abc!', [PasswordValidator::TOO_SHORT, PasswordValidator::MISSING_DIGIT]];
        yield 'too short and only letters' => ['Abcd', [PasswordValidator::TOO_SHORT, PasswordValidator::MISSING_DIGIT, PasswordValidator::MISSING_SYMBOL]];
        yield 'invalid character and no symbol' => ['Abcdefghij1#', [PasswordValidator::MISSING_SYMBOL, PasswordValidator::INVALID_CHARACTER]];
        yield 'long, but no digit' => [str_repeat('Ab!', 30), [PasswordValidator::MISSING_DIGIT]];
        yield 'long, invalid at the start' => ['#' . str_repeat('Ab1!', 20), [PasswordValidator::INVALID_CHARACTER]];
        yield 'long, invalid in the middle' => [str_repeat('Ab1!', 10) . ' ' . str_repeat('Ab1!', 10), [PasswordValidator::INVALID_CHARACTER]];
        yield 'long, invalid at the end' => [str_repeat('Ab1!', 20) . "\n", [PasswordValidator::INVALID_CHARACTER]];
    }

    /**
     * @param list<string> $expected
     */
    #[DataProvider('missingClasses')]
    public function testEveryViolationIsReported(string $password, array $expected): void
    {
        self::assertSame($expected, $this->validator->violations($password, 12));
        self::assertFalse($this->validator->isValid($password, 12));
    }

    // ---------------------------------------------------------------- characters (PV-07, PV-08, PV-12, PV-15, EC-03)

    public function testEveryOtherByteIsRejected(): void
    {
        for ($byte = 0; $byte < 256; $byte++) {
            $char = chr($byte);
            if (str_contains(self::ALLOWED_SET, $char)) {
                continue;
            }
            self::assertContains(
                PasswordValidator::INVALID_CHARACTER,
                $this->validator->violations('Aa1!bbbbbbbb' . $char, 12),
                sprintf('Byte 0x%02X must be rejected.', $byte),
            );
        }
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function unicodeInput(): iterable
    {
        yield 'umlaut' => ['Abcdefgh12!ä'];
        yield 'emoji' => ['Abcdefgh12!🙂'];
        yield 'Cyrillic a (lookalike)' => ["Abcdefgh12!\u{0430}"];
        yield 'decomposed e with accent' => ["Abcdefgh12!e\u{0301}"];
        yield 'zero-width space' => ["Abcdefgh12!\u{200B}"];
        yield 'soft hyphen' => ["Abcdefgh12!\u{00AD}"];
        yield 'BOM' => ["\u{FEFF}Abcdefgh12!"];
        yield 'right-to-left mark' => ["Abcdefgh12!\u{200F}"];
        yield 'non-breaking space' => ["Abcdefgh12!\u{00A0}"];
        yield 'fullwidth A' => ["\u{FF21}bcdefgh12!x"];
    }

    #[DataProvider('unicodeInput')]
    public function testNonAsciiInputIsRejected(string $password): void
    {
        self::assertContains(PasswordValidator::INVALID_CHARACTER, $this->validator->violations($password, 12));
    }

    public function testLengthCountsBytes(): void
    {
        // 11 ASCII characters + "ä" (2 bytes) = 13 bytes: long enough, but invalid, never a valid short password.
        self::assertSame([PasswordValidator::INVALID_CHARACTER], $this->validator->violations('Abcdefgh12!ä', 12));
    }

    // ---------------------------------------------------------------- encryption fits (PV-10)

    public function testMaximumLengthStillFitsRsaOaep(): void
    {
        $key = PublicKeyLoader::loadPublicKey((string) file_get_contents(__DIR__ . '/../../keys/publicKey1.pem'));
        self::assertInstanceOf(RSA\PublicKey::class, $key);
        $oaep = $key->withPadding(RSA::ENCRYPTION_OAEP)->withHash('sha256')->withMGFHash('sha256');

        self::assertIsString($oaep->encrypt(str_repeat('x', PasswordValidator::MAX_LENGTH)));
    }

    // ---------------------------------------------------------------- generation (PG-01 to PG-06)

    /**
     * @return iterable<string, array{int}>
     */
    public static function generatedLengths(): iterable
    {
        yield 'smallest possible' => [3];
        yield 'minimum setting' => [12];
        yield 'maximum setting' => [64];
        yield 'maximum length' => [128];
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

    /**
     * @return iterable<string, array{int}>
     */
    public static function impossibleLengths(): iterable
    {
        yield 'below 3' => [2];
        yield 'zero' => [0];
        yield 'above the maximum' => [129];
    }

    #[DataProvider('impossibleLengths')]
    public function testGenerationRejectsImpossibleLengths(int $length): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->validator->generateRandom($length);
    }

    public function testDefaultRandomnessIsCryptographicallySecure(): void
    {
        $randomizer = (new \ReflectionProperty(PasswordValidator::class, 'randomizer'))->getValue($this->validator);

        self::assertInstanceOf(Randomizer::class, $randomizer);
        self::assertInstanceOf(Secure::class, $randomizer->engine);
    }

    public function testAllRandomnessComesFromTheRandomizer(): void
    {
        $a = new PasswordValidator(new NullLogger(), new Randomizer(new Mt19937(42)));
        $b = new PasswordValidator(new NullLogger(), new Randomizer(new Mt19937(42)));

        self::assertSame($a->generateRandom(32), $b->generateRandom(32), 'Same seed, same password: no other random source is used.');
    }

    public function testMandatoryCharactersAreNotAtFixedPositions(): void
    {
        $validator = new PasswordValidator(new NullLogger(), new Randomizer(new Mt19937(7)));
        $firstCharClasses = [];
        for ($i = 0; $i < 200; $i++) {
            $first = $validator->generateRandom(12)[0];
            $firstCharClasses[ctype_alpha($first) ? 'letter' : (ctype_digit($first) ? 'digit' : 'symbol')] = true;
        }

        self::assertCount(3, $firstCharClasses, 'With a fixed seed, every class appears at the first position.');
    }

    public function testEveryAllowedCharacterIsGenerated(): void
    {
        $validator = new PasswordValidator(new NullLogger(), new Randomizer(new Mt19937(1)));
        $seen = '';
        for ($i = 0; $i < 200; $i++) {
            $seen .= $validator->generateRandom(64);
        }

        self::assertSame([], array_values(array_diff(str_split(self::ALLOWED_SET), str_split($seen))));
    }
}
