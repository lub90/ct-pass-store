<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\ChurchTools;

/**
 * Result of `POST /api/login` when ChurchTools accepted the username and password.
 *
 * `status` tells whether the login is complete (`success`) or still needs a second factor (`totp`,
 * `twoFactorSetup`). Deciding what that means is up to the caller.
 */
final class LoginResult
{
    public const STATUS_SUCCESS = 'success';
    public const STATUS_TOTP = 'totp';
    public const STATUS_TWO_FACTOR_SETUP = 'twoFactorSetup';

    /** The statuses that mean "username and password are correct" (spec 5.5.3, Q13). */
    public const PASSWORD_ACCEPTED = [self::STATUS_SUCCESS, self::STATUS_TOTP, self::STATUS_TWO_FACTOR_SETUP];

    public function __construct(
        public readonly int $personId,
        public readonly string $status,
    ) {}

    public function isComplete(): bool
    {
        return $this->status === self::STATUS_SUCCESS;
    }
}
