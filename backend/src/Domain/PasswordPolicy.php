<?php

declare(strict_types=1);

namespace CtPassStore\Domain;

use Random\Engine\Secure;
use Random\Randomizer;

/**
 * The password policy (spec 5.1).
 *
 * The character set is a contract with ct-radius, which rejects any other character.
 */
final class PasswordPolicy
{
    /** The longest password accepted (Q8). */
    public const MAX_LENGTH = 128;

    /** The range of the `passwordLength` setting (Q7). */
    public const MIN_CONFIGURABLE_LENGTH = 12;
    public const MAX_CONFIGURABLE_LENGTH = 64;

    public const TOO_SHORT = 'too-short';
    public const TOO_LONG = 'too-long';
    public const MISSING_LETTER = 'missing-letter';
    public const MISSING_DIGIT = 'missing-digit';
    public const MISSING_SYMBOL = 'missing-symbol';
    public const INVALID_CHARACTER = 'invalid-character';

    private const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    private const DIGITS = '0123456789';
    private const SYMBOLS = '!@$%&*-_+=?.';
    private const ALLOWED_CHARS = self::LETTERS . self::DIGITS . self::SYMBOLS;

    private readonly Randomizer $randomizer;

    /**
     * @param Randomizer|null $randomizer only for tests (a seeded engine); by default a cryptographically secure one
     */
    public function __construct(?Randomizer $randomizer = null)
    {
        $this->randomizer = $randomizer ?? new Randomizer(new Secure());
    }

    /**
     * The rules the password breaks, as codes; empty if it's valid.
     *
     * The maximum length is checked first and alone, so huge inputs cost nothing.
     *
     * @return list<string>
     */
    public function violations(#[\SensitiveParameter] string $pwd, int $minLength): array
    {
        if (strlen($pwd) > self::MAX_LENGTH) {
            return [self::TOO_LONG];
        }

        $violations = [];
        if (strlen($pwd) < $minLength) {
            $violations[] = self::TOO_SHORT;
        }
        if (strpbrk($pwd, self::LETTERS) === false) {
            $violations[] = self::MISSING_LETTER;
        }
        if (strpbrk($pwd, self::DIGITS) === false) {
            $violations[] = self::MISSING_DIGIT;
        }
        if (strpbrk($pwd, self::SYMBOLS) === false) {
            $violations[] = self::MISSING_SYMBOL;
        }
        if (strspn($pwd, self::ALLOWED_CHARS) !== strlen($pwd)) {
            $violations[] = self::INVALID_CHARACTER;
        }

        return $violations;
    }

    public function isValid(#[\SensitiveParameter] string $pwd, int $minLength): bool
    {
        return $this->violations($pwd, $minLength) === [];
    }

    /**
     * A random password of exactly `$length` characters that passes the policy: one letter, one digit and one
     * symbol, the rest from the whole set, shuffled. All randomness comes from the randomizer.
     */
    public function generateRandom(int $length): string
    {
        if ($length < 3 || $length > self::MAX_LENGTH) {
            throw new \InvalidArgumentException('Password length must be between 3 and ' . self::MAX_LENGTH . '.');
        }

        $pwd = $this->pick(self::LETTERS) . $this->pick(self::DIGITS) . $this->pick(self::SYMBOLS);
        for ($i = 3; $i < $length; $i++) {
            $pwd .= $this->pick(self::ALLOWED_CHARS);
        }

        return $this->randomizer->shuffleBytes($pwd);
    }

    private function pick(string $chars): string
    {
        return $chars[$this->randomizer->getInt(0, strlen($chars) - 1)];
    }
}
