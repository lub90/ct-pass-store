<?php

declare(strict_types=1);

namespace CtPassStore\Application\Exception;

use CtPassStore\Application\Failure\Reason;

final class EntryNotFoundException extends ApplicationException
{
    protected const REASON = Reason::EntryNotFound;
}
