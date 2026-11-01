<?php

declare(strict_types=1);

namespace CtPassStore\ChurchTools\Exception;

/**
 * ChurchTools answered 429. `retryAfterSeconds` is at least 60 (spec 5.6, 6.2).
 */
final class RateLimitedException extends ChurchToolsException
{
    public function __construct(string $message, public readonly int $retryAfterSeconds)
    {
        parent::__construct($message);
    }
}
