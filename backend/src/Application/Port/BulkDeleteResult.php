<?php

declare(strict_types=1);

namespace CtPassStore\Application\Port;

use CtPassStore\Domain\PersonId;

/**
 * The outcome of {@see PasswordRepository::deleteEntriesOf()}.
 */
final class BulkDeleteResult
{
    /**
     * @param list<PersonId> $deleted persons whose entries are all gone now
     * @param array<int, string> $failed person ID => message, for persons whose delete failed
     * @param list<PersonId> $notStarted persons left untouched because `mayStart` said no
     */
    public function __construct(
        public readonly array $deleted,
        public readonly array $failed,
        public readonly array $notStarted,
    ) {}
}
