<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\ChurchTools\Exception;

use CtPassStore\Application\Failure\Reason;

/**
 * ChurchTools answered 403 to a call made with a user's credential.
 */
final class NotPermittedException extends ChurchToolsException
{
    protected const REASON = Reason::UpstreamInvalid;
}
