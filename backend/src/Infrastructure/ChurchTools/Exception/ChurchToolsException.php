<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\ChurchTools\Exception;

use CtPassStore\Application\Failure\Failure;
use CtPassStore\Application\Failure\Reason;

/**
 * Base class for everything that can go wrong when talking to ChurchTools.
 *
 * Messages name the method, the API path and the status, but never tokens, passwords or response bodies. They're for
 * the log; the client gets a fixed text per reason.
 *
 * Where a call is rejected unexpectedly (a user call that answers 401/403 although the code doesn't expect it),
 * ChurchTools behaves differently than assumed: that's upstream-invalid.
 */
abstract class ChurchToolsException extends \RuntimeException implements Failure
{
    protected const REASON = Reason::UpstreamInvalid;

    public function reason(): Reason
    {
        return static::REASON;
    }

    public function retryAfterSeconds(): ?int
    {
        return null;
    }

    /**
     * Messages name API paths and statuses: for the log, not the client.
     */
    public function publicDetail(): ?string
    {
        return null;
    }

    public function extensions(): array
    {
        return [];
    }
}
