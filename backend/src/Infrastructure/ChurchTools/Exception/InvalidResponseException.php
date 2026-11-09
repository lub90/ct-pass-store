<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\ChurchTools\Exception;

use CtPassStore\Application\Failure\Reason;

/**
 * ChurchTools answered something the backend can't use: an unexpected status, a redirect, or a body that isn't the expected JSON.
 */
final class InvalidResponseException extends ChurchToolsException
{
    protected const REASON = Reason::UpstreamInvalid;
}
