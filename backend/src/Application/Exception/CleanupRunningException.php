<?php

declare(strict_types=1);

namespace CtPassStore\Application\Exception;

use CtPassStore\Application\Failure\Reason;

/**
 * The web cron was called while another cleanup holds the lock (cleanup design 5.3, 6.3).
 */
final class CleanupRunningException extends ApplicationException
{
    protected const REASON = Reason::CleanupRunning;
}
