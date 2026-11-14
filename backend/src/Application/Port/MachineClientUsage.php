<?php

declare(strict_types=1);

namespace CtPassStore\Application\Port;

/**
 * Counts the authenticated requests of machine clients for a rate-limited usage summary in the log (spec 6.4).
 */
interface MachineClientUsage
{
    /**
     * Records one authenticated request of the client from this address. Never throws: the summary is for the log
     * only and never decides about a request.
     */
    public function record(string $clientId, string $address): void;
}
