<?php

declare(strict_types=1);

namespace CtPassStore\Application\Port;

use CtPassStore\Application\Auth\AddressLimit;
use CtPassStore\Application\Exception\TooManyAttemptsException;

/**
 * Limits requests per remote address (spec 6.3, Q26). Only `REMOTE_ADDR` is passed in; forwarding headers are ignored.
 */
interface AddressLimiter
{
    /**
     * Counts a request from the address.
     *
     * @throws TooManyAttemptsException if the address is blocked; that request isn't counted
     */
    public function hit(AddressLimit $limit, string $remoteAddr): void;

    /**
     * Throws like hit() if the address is blocked, but never counts.
     *
     * @throws TooManyAttemptsException
     */
    public function assertOpen(AddressLimit $limit, string $remoteAddr): void;
}
