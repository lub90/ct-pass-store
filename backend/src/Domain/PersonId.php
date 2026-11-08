<?php

declare(strict_types=1);

namespace CtPassStore\Domain;

/**
 * The ID of a ChurchTools person whose entry can be read or changed: always positive. `0` is reserved for the
 * self-test (spec 5.3.11) and can't be a PersonId.
 */
final class PersonId
{
    public function __construct(public readonly int $value)
    {
        if ($value < 1) {
            throw new \InvalidArgumentException('Person IDs are positive; 0 is reserved for the self-test.');
        }
    }

    /**
     * The integer of a decimal string without sign, leading zeros or whitespace that fits into an int (up to
     * PHP_INT_MAX), or null. `0` is returned as 0, so callers that allow the self-test ID can use it too. The one rule
     * for IDs from paths, tokens and stored values, so they always agree (spec 4.1, 5.3.1).
     */
    public static function decimal(string $digits): ?int
    {
        if (preg_match('/^(0|[1-9][0-9]*)\z/', $digits) !== 1) {
            return null;
        }
        // (int) saturates at PHP_INT_MAX, so a larger number doesn't survive the round trip.
        $int = (int) $digits;

        return (string) $int === $digits ? $int : null;
    }

    public function equals(self $other): bool
    {
        return $this->value === $other->value;
    }

    public function __toString(): string
    {
        return (string) $this->value;
    }
}
