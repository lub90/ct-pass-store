<?php

declare(strict_types=1);

namespace CtPassStore\Application;

use CtPassStore\Domain\PersonId;
use CtPassStore\Domain\Settings;

/**
 * The configured admins who are deleted or archived in ChurchTools.
 */
final class GoneAdmins
{
    public function __construct(private readonly GonePersons $gonePersons) {}

    /**
     * @return list<PersonId> in the order of `adminUsers`
     */
    public function find(Settings $settings): array
    {
        $admins = array_map(static fn(int $id): PersonId => new PersonId($id), $settings->adminUsers);

        return $this->gonePersons->find($admins)->gone;
    }
}
