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

    public function __construct(
        public readonly int $personId,
        public readonly string $status,
    ) {}

    public function isComplete(): bool
    {
        return $this->status === self::STATUS_SUCCESS;
    }
}
