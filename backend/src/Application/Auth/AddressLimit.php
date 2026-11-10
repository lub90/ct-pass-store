<?php

declare(strict_types=1);

namespace CtPassStore\Application\Auth;

/**
 * The per-address limits of spec 6.3 (Q26): requests per remote address within a 60-second window.
 */
enum AddressLimit: string
{
    case Login = 'login';
    case RejectedToken = 'rejected-token';

    public const WINDOW_SECONDS = 60;

    public function max(): int
    {
        return match ($this) {
            self::Login => 30,
            self::RejectedToken => 60,
        };
    }
}
