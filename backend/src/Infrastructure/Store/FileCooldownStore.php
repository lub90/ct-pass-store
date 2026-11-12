<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Store;

use CtPassStore\Application\Port\Clock;
use CtPassStore\Application\Port\CooldownStore;

/**
 * Cooldowns in the signed security store (fail closed): one record per name holding the last start as a timestamp.
 */
final class FileCooldownStore implements CooldownStore
{
    public function __construct(
        private readonly SignedFileStore $store,
        private readonly Clock $clock,
    ) {}

    public function startIfDue(string $name, int $seconds): ?int
    {
        $now = $this->clock->now()->getTimestamp();
        $left = null;
        $this->store->update('cooldown:' . $name, static function (array $state) use ($now, $seconds, &$left): array {
            $startedAt = $state['startedAt'] ?? null;
            // A start "in the future" means the clock went back; it would block for longer than one period, so it
            // counts as none.
            if (is_int($startedAt) && $startedAt <= $now && $now - $startedAt < $seconds) {
                $left = $seconds - ($now - $startedAt);

                return $state;
            }

            return ['startedAt' => $now];
        });

        return $left;
    }
}
