<?php

declare(strict_types=1);

namespace CtPassStore\Application\Exception;

use CtPassStore\Application\Failure\Reason;

/**
 * The web cron was called again before the cooldown of the last run ended (cleanup design 5.2).
 */
final class CleanupTooSoonException extends ApplicationException
{
    protected const REASON = Reason::CleanupTooSoon;

    public function __construct(string $message, public readonly int $retryAfterSeconds)
    {
        parent::__construct($message);
    }

    public function retryAfterSeconds(): int
    {
        return $this->retryAfterSeconds;
    }
}
