<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Kv;

use CtPassStore\Domain\MachineClient;

/**
 * The parsed `access` value and what was ignored or disabled on the way (for the log and `/test`).
 */
final class ParsedAccess
{
    /**
     * @param array<string, MachineClient> $machineClients the enabled clients by ID
     * @param list<string> $findings
     */
    public function __construct(
        public readonly ?int $adminGroupId,
        public readonly array $machineClients,
        public readonly array $findings,
    ) {}
}
