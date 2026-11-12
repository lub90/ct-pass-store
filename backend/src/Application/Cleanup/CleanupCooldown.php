<?php

declare(strict_types=1);

namespace CtPassStore\Application\Cleanup;

use CtPassStore\Application\Exception\CleanupTooSoonException;
use CtPassStore\Application\Port\CooldownStore;

/**
 * The web cron starts a cleanup at most once per SECONDS (cleanup design 5.2), so a stolen `CLEANUP_TOKEN` can't hammer
 * ChurchTools or the backend. The period counts from the start of a run, also one that later fails or finds the lock
 * held. The CLI ignores it (design 6.3).
 */
final class CleanupCooldown
{
    public const SECONDS = 600;

    private const NAME = 'cleanup:web-cron';

    public function __construct(private readonly CooldownStore $store) {}

    /**
     * @throws CleanupTooSoonException if the last start is less than SECONDS ago
     */
    public function start(): void
    {
        $left = $this->store->startIfDue(self::NAME, self::SECONDS);
        if ($left !== null) {
            throw new CleanupTooSoonException('A cleanup started less than ' . self::SECONDS . " seconds ago. Try again in {$left} seconds.", $left);
        }
    }
}
