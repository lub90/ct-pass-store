<?php

declare(strict_types=1);

namespace CtPassStore\Application\Cleanup;

use CtPassStore\Domain\PersonId;

/**
 * The outcome of {@see CleanupOrphans::run()}.
 */
final class CleanupReport
{
    /**
     * @param bool $applied false for a dry run
     * @param int $checked number of persons with entries that were looked at
     * @param list<PersonId> $gone deleted (or, in a dry run, to be deleted)
     * @param list<PersonId> $unchecked left for the next run because the deadline passed
     * @param array<int, string> $failedDeletes person ID => message
     * @param list<PersonId> $goneAdmins configured admins who are deleted or archived
     */
    public function __construct(
        public readonly bool $applied,
        public readonly int $checked,
        public readonly array $gone,
        public readonly array $unchecked,
        public readonly array $failedDeletes,
        public readonly array $goneAdmins,
    ) {}

    public function exitCode(): int
    {
        return $this->failedDeletes !== [] || $this->goneAdmins !== [] ? 1 : 0;
    }

    public function deletedCount(): int
    {
        return $this->applied ? count($this->gone) - count($this->failedDeletes) : 0;
    }

    public function isComplete(): bool
    {
        return $this->unchecked === [];
    }
}
