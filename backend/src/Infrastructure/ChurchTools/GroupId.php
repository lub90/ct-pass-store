<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\ChurchTools;

use CtPassStore\Domain\PersonId;

/**
 * The ID of a ChurchTools group as the extension reads it: ChurchTools sends it as a string
 * (`group.domainIdentifier`), the settings store it as an integer. Both must mean the same group, and nothing else
 * may match by accident (`"012"`, `"1e1"`, `12.0`).
 */
final class GroupId
{
    /**
     * @return int|null the ID if `$value` is a positive decimal without sign, leading zeros or whitespace, as string
     *                  or int; otherwise null
     */
    public static function parse(mixed $value): ?int
    {
        if (is_int($value)) {
            $value = (string) $value;
        }
        if (!is_string($value)) {
            return null;
        }
        $id = PersonId::decimal($value);

        return $id !== null && $id > 0 ? $id : null;
    }
}
