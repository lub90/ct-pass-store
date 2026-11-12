<?php

declare(strict_types=1);

namespace CtPassStore\Application;

use CtPassStore\Domain\PersonId;

/**
 * The outcome of {@see GonePersons::find()}.
 */
final class GoneResult
{
    /**
     * @param list<PersonId> $gone deleted or archived persons
     * @param list<PersonId> $unchecked persons left unchecked because the deadline passed
     */
    public function __construct(public readonly array $gone, public readonly array $unchecked) {}
}
