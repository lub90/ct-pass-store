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
}
