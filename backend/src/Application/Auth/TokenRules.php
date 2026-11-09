<?php

declare(strict_types=1);

namespace CtPassStore\Application\Auth;

use CtPassStore\Application\Exception\InvalidTokenException;

/**
 * What user and machine tokens share (spec 4.3.3, 4.4).
 */
final class TokenRules
{
    /** Clock skew allowed for `nbf`, `iat` and `exp`. */
    public const LEEWAY_SECONDS = 30;

    /** The same answer for every kind of invalid token, so it reveals nothing. */
    public static function invalid(): InvalidTokenException
    {
        return new InvalidTokenException('The access token is invalid.');
    }
}
