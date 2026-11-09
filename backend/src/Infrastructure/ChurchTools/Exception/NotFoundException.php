<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\ChurchTools\Exception;

use CtPassStore\Application\Failure\Reason;

/**
 * ChurchTools answered 404.
 */
final class NotFoundException extends ChurchToolsException
{
    protected const REASON = Reason::ExtensionNotInstalled;
}
