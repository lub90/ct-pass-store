<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\ChurchTools;

/**
 * What ChurchTools says about a person (cleanup design 3.1). `Gone` means ChurchTools answered `404`: the person is
 * deleted or never existed. A person the service user may not see is not `Gone`; that is an error.
 */
enum PersonStatus: string
{
    case Active = 'active';
    case Archived = 'archived';
    case Gone = 'gone';
}
