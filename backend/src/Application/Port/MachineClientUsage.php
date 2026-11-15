<?php

declare(strict_types=1);

namespace CtPassStore\Application\Port;

/**
 * Counts the authenticated requests of machine clients for a rate-limited usage summary in the log (spec 6.4).
 */
interface MachineClientUsage
{
    /**
     * Records one authenticated request of the client from this address. A store that can't be used or was tampered
     * with is a warning in the log, never an exception: the summary is for the log only and never decides about a
     * request. (Only values that always encode as JSON are stored: client IDs, REMOTE_ADDR, counts and times.)
     */
    public function record(string $clientId, string $address): void;
}
