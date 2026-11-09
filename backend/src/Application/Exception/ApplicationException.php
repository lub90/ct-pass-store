<?php

declare(strict_types=1);

namespace CtPassStore\Application\Exception;

use CtPassStore\Application\Failure\Failure;
use CtPassStore\Application\Failure\Reason;

/**
 * A request the use cases refuse. The message is safe to show to the client.
 */
abstract class ApplicationException extends \RuntimeException implements Failure
{
    protected const REASON = Reason::InvalidRequest;

    public function reason(): Reason
    {
        return static::REASON;
    }

    public function retryAfterSeconds(): ?int
    {
        return null;
    }

    public function publicDetail(): ?string
    {
        return $this->getMessage();
    }

    public function extensions(): array
    {
        return [];
    }
}
