<?php

declare(strict_types=1);

namespace CtPassStore\Application\Exception;

final class TooManyAttemptsException extends ApplicationException
{
    public function __construct(string $message, public readonly int $retryAfterSeconds)
    {
        parent::__construct($message);
    }
}
