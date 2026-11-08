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
        $id = is_string($raw) ? PersonId::decimal($raw) : null;
        if ($id === null || $id < 1) {
            throw new ProblemException(ProblemType::InvalidId, 'The person ID must be a positive whole number in decimal notation.');
        }

        return new PersonId($id);
    }
}
