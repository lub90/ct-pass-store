<?php

declare(strict_types=1);

namespace CtPassStore\Http;

use CtPassStore\Domain\PersonId;
use CtPassStore\Http\Problem\ProblemException;
use CtPassStore\Http\Problem\ProblemType;

/**
 * Parses the person ID from a path (spec 4.1): a positive integer in decimal notation without sign, leading zeros
 * or whitespace, at most PHP_INT_MAX. Variants such as `07`, `+7`, `7.0` or `1e3` are rejected rather than
 * interpreted, so they can never address another person.
 */
final class PathId
{
    /**
     * @throws ProblemException `400 invalid-id`
     */
    public static function parse(mixed $raw): PersonId
    {
        if (!is_string($raw) || preg_match('/^[1-9][0-9]*\z/', $raw) !== 1 || !self::fitsInt($raw)) {
            throw new ProblemException(ProblemType::InvalidId, 'The person ID must be a positive whole number in decimal notation.');
        }

        return new PersonId((int) $raw);
    }

    private static function fitsInt(string $digits): bool
    {
        $max = (string) PHP_INT_MAX;

        return strlen($digits) < strlen($max) || (strlen($digits) === strlen($max) && strcmp($digits, $max) <= 0);
    }
}
