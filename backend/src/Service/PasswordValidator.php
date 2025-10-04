<?php

declare(strict_types=1);

namespace CtPassStore\Service;

class PasswordValidator extends BaseService
{
    private const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    private const DIGITS = '0123456789';
    private const SYMBOLS = '!@$%&*-_+=?.';
    private const ALLOWED_CHARS = self::LETTERS . self::DIGITS . self::SYMBOLS;

    public function isValid(string $pwd, int $length): bool
    {
        if (strlen($pwd) < $length) {
            return false;
        }

        // Enforce at least one letter, one digit, and one symbol
        if (!preg_match('/[' . preg_quote(self::LETTERS, '/') . ']/', $pwd)) return false;
        if (!preg_match('/[' . preg_quote(self::DIGITS, '/') . ']/', $pwd)) return false;
        if (!preg_match('/[' . preg_quote(self::SYMBOLS, '/') . ']/', $pwd)) return false;

        // Check that the string only contains valid chars
        return strspn($pwd, self::ALLOWED_CHARS) === strlen($pwd);
    }

    public function generateRandom(int $length): string
    {
        if ($length < 3) {
            throw new \InvalidArgumentException('Password length must be at least 3 to satisfy complexity rules.');
        }

        $pwd = '';
        $pwd .= self::LETTERS[random_int(0, strlen(self::LETTERS) - 1)];
        $pwd .= self::DIGITS[random_int(0, strlen(self::DIGITS) - 1)];
        $pwd .= self::SYMBOLS[random_int(0, strlen(self::SYMBOLS) - 1)];

        $remainingLength = $length - 3;
        for ($i = 0; $i < $remainingLength; $i++) {
            $pwd .= self::ALLOWED_CHARS[random_int(0, strlen(self::ALLOWED_CHARS) - 1)];
        }

        return str_shuffle($pwd);
    }
}
