<?php

declare(strict_types=1);

namespace CtPassStore\Application\Exception;

use CtPassStore\Application\Failure\Reason;

/**
 * The service user lacks the persons right, so deleted persons can't be told from persons it can't see.
 */
final class PersonsNotReadableException extends ApplicationException
{
    protected const REASON = Reason::ServiceUserRejected;
}
