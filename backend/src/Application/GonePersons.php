<?php

declare(strict_types=1);

namespace CtPassStore\Application;

use CtPassStore\Application\Port\Clock;
use CtPassStore\Application\Port\PersonDirectory;
use CtPassStore\Domain\PersonId;

/**
 * The only code that decides who is gone (cleanup design 3.4): a batch pre-filter, then single lookups for the rest.
 * Only the single lookup can make a person gone.
 */
final class GonePersons
{
    public function __construct(
        private readonly PersonDirectory $persons,
        private readonly Clock $clock,
    ) {}

    /**
     * Any failure of the directory propagates.
     *
     * @param list<PersonId> $persons
     * @param \DateTimeImmutable|null $deadline once passed, no further lookup starts and the rest is unchecked
     */
    public function find(array $persons, ?\DateTimeImmutable $deadline = null): GoneResult
    {
        $confirmed = [];
        foreach ($this->persons->confirmedActive($persons) as $person) {
            $confirmed[$person->value] = true;
        }

        $gone = [];
        $unchecked = [];
        foreach ($persons as $person) {
            if (isset($confirmed[$person->value])) {
                continue;
            }
            if ($deadline !== null && $this->clock->now() > $deadline) {
                $unchecked[] = $person;

                continue;
            }
            // One after another, never in parallel: parallel calls ran into connection timeouts at ChurchTools.
            if (!$this->persons->exists($person)) {
                $gone[] = $person;
            }
        }

        return new GoneResult($gone, $unchecked);
    }
}
