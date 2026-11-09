<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\ChurchTools\Exception;

use CtPassStore\Application\Failure\Reason;

/**
 * ChurchTools rejected the backend's OAuth client ID or secret. This is a configuration problem.
 */
final class OAuthClientRejectedException extends ChurchToolsException
{
    protected const REASON = Reason::OAuthClientRejected;
}
