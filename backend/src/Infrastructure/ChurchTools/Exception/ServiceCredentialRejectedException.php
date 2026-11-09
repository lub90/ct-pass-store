<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\ChurchTools\Exception;

use CtPassStore\Application\Failure\Reason;

/**
 * ChurchTools rejected the service user's credential (401) or its permissions (403). This is a configuration problem.
 */
final class ServiceCredentialRejectedException extends ChurchToolsException
{
    protected const REASON = Reason::ServiceUserRejected;
}
