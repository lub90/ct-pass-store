<?php

declare(strict_types=1);

namespace CtPassStore\Application\Port;

use CtPassStore\Domain\PersonId;

/**
 * The encrypted secondary passwords, one per person.
 */
interface PasswordRepository
{
    /**
     * The person's ciphertext, or null if there's none.
     */
    public function find(PersonId $person): ?string;

    /**
     * Stores the ciphertext as the person's only entry. If this throws, the previous entry stays as it was.
     */
    public function save(PersonId $person, string $ciphertext): void;

    /**
     * Removes the person's entry; does nothing if there's none.
     */
    public function delete(PersonId $person): void;

    /**
     * Removes every entry of each person, working from **one** listing of the store (cleanup design 3.5). The persons
     * are handled one after another; `$mayStart` is asked before each, and once it answers false, no further person is
     * started (a started one is finished). A person whose delete fails is reported and the others continue. If the
     * listing fails, the exception propagates and nothing is deleted.
     *
     * @param list<PersonId> $persons
     * @param \Closure(): bool $mayStart
     */
    public function deleteEntriesOf(array $persons, \Closure $mayStart): BulkDeleteResult;

    /**
     * Every person who has at least one entry, each once, ascending.
     *
     * @return list<PersonId>
     */
    public function personIds(): array;
}
