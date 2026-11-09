<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\ChurchTools\Exception;

use CtPassStore\Application\Failure\Reason;

/**
 * ChurchTools answered 429. `retryAfterSeconds` is at least 60 (spec 5.6, 6.2).
 */
final class RateLimitedException extends ChurchToolsException
{
    protected const REASON = Reason::UpstreamRateLimited;

    public function __construct(string $message, public readonly int $retryAfterSeconds)
    {
        parent::__construct($message);
    }

    public function retryAfterSeconds(): int
    {
        return $this->retryAfterSeconds;
    }
}
