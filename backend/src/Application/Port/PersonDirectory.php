<?php

declare(strict_types=1);

namespace CtPassStore\Application\Port;

use CtPassStore\Application\Exception\PersonsNotReadableException;
use CtPassStore\Application\Failure\Failure;
use CtPassStore\Domain\PersonId;

/**
 * Which ChurchTools persons exist. The application knows only "exists or not"; whether a person is deleted or
 * archived stays behind this port.
 */
interface PersonDirectory
{
    /**
     * True only for an active person; the authoritative single lookup.
     *
     * @throws Failure if ChurchTools can't answer clearly
     */
    public function exists(PersonId $person): bool;

    /**
     * The persons among $persons that are confirmed active. May leave out active ones, never includes others.
     *
     * @param list<PersonId> $persons
     * @return list<PersonId>
     * @throws Failure if ChurchTools can't answer clearly
     */
    public function confirmedActive(array $persons): array;

    /**
     * @throws PersonsNotReadableException if the service user lacks the persons right
     * @throws Failure if ChurchTools can't answer clearly
     */
    public function assertReadable(): void;
}
