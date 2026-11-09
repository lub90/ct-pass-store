<?php

declare(strict_types=1);

namespace CtPassStore\Application\Port;

use CtPassStore\Application\Exception\ConfigurationException;

/**
 * Remembers which (client, `jti`) pairs have been used (spec 4.4a.5).
 */
interface ReplayCache
{
    /**
     * Records the pair until `$keepUntil` and returns true, or returns false if it was recorded before.
     *
     * @throws ConfigurationException if the cache can't be used (machine requests are then refused)
     */
    public function recordOnce(string $clientId, string $jti, int $keepUntil, int $now): bool;
}
