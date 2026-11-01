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

    public function equals(self $other): bool
    {
        return $this->value === $other->value;
    }

    public function __toString(): string
    {
        return (string) $this->value;
    }
}
