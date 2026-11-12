<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\ChurchTools;

use CtPassStore\Application\Port\Clock;
use CtPassStore\Application\Port\PersonDirectory;
use CtPassStore\Domain\PersonId;
use CtPassStore\Infrastructure\Store\SignedFileCache;

/**
 * Positive-only cache in front of {@see PersonDirectory::exists()} (cleanup design 3.2, C8).
 *
 * "Exists" is remembered for {@see self::TTL_SECONDS}; "gone" is never cached, so a deleted person is locked out within
 * that time. One record `persons-active` maps person ID to its expiry time; expired IDs are dropped on every write.
 * A broken record is a miss. Concurrent writers may lose an update, which only costs one more lookup.
 */
final class CachedPersonDirectory implements PersonDirectory
{
    public const TTL_SECONDS = 600;

    private const RECORD = 'persons-active';

    public function __construct(
        private readonly PersonDirectory $inner,
        private readonly SignedFileCache $cache,
        private readonly Clock $clock,
    ) {}

    public function exists(PersonId $person): bool
    {
        $now = $this->clock->now()->getTimestamp();
        $known = $this->liveEntries($now);
        if (isset($known[$person->value])) {
            return true;
        }

        if (!$this->inner->exists($person)) {
            return false;
        }

        $known[$person->value] = $now + self::TTL_SECONDS;
        // JSON object keys: PHP turns the numeric ones into ints, SignedFileCache only cares that it is an array.
        /** @var array<string, mixed> $record */
        $record = $known;
        $this->cache->put(self::RECORD, $record, self::TTL_SECONDS);

        return true;
    }

    public function confirmedActive(array $persons): array
    {
        return $this->inner->confirmedActive($persons);
    }

    public function assertReadable(): void
    {
        $this->inner->assertReadable();
    }

    /**
     * @return array<int, int> person ID => expiry time, only entries still valid at $now
     */
    private function liveEntries(int $now): array
    {
        $live = [];
        foreach ($this->cache->get(self::RECORD) ?? [] as $id => $expires) {
            if (is_int($expires) && $expires > $now) {
                $live[(int) $id] = $expires;
            }
        }

        return $live;
    }
}
