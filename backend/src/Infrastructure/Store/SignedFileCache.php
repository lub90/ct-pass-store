<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Store;

use CtPassStore\Application\Port\Clock;
use Psr\Log\LoggerInterface;

/**
 * File cache with a TTL for non-secret data: settings, the public key, module and category IDs (spec 6.1).
 *
 * - Same signed file format as the security store (see RecordSigner), but another purpose, so a record of one is never
 *   accepted by the other. File name `cache-<sha256(name)>.json` (security records are `sec-...`). Files are `600`, the
 *   folder `700`; writes go to a temporary file that `rename` moves into place.
 * - Fail open: nothing here throws. A missing, expired, unreadable, old-key or tampered entry is a miss and the caller
 *   loads the data from its source; a write that fails is logged as `warning` and the next request tries again.
 * - "Invalid entries" (spec 6.1): an entry signed with an older key (`JWT_SECRET` rotated) is silently a miss; an entry
 *   with the current key ID but a wrong or missing MAC (or broken JSON) is a miss and logs `error`.
 */
final class SignedFileCache
{
    public const PURPOSE = 'ctpassstore cache v1';

    public function __construct(
        private readonly string $directory,
        private readonly RecordSigner $signer,
        private readonly Clock $clock,
        private readonly LoggerInterface $logger,
    ) {}

    /**
     * @return array<string, mixed>|null null if missing, expired, unreadable, signed with an old key or tampered with
     */
    public function get(string $name): ?array
    {
        try {
            $path = $this->path($name);
            if (!is_file($path)) {
                return null;
            }
            $raw = @file_get_contents($path);
            if ($raw === false) {
                $this->logger->warning("Cache entry $name can't be read; it is loaded again.");

                return null;
            }

            $opened = $this->signer->open($name, $raw);
            if ($opened->status === OpenedStatus::OldKey) {
                return null;
            }
            if ($opened->status === OpenedStatus::Tampered) {
                $this->logger->error("Cache entry $name failed its integrity check and is ignored; it is loaded again.");

                return null;
            }

            $expires = $opened->data['expires'] ?? null;
            $data = $opened->data['data'] ?? null;
            if (!is_int($expires) || !is_array($data) || $expires <= $this->clock->now()->getTimestamp()) {
                return null;
            }

            return $data;
        } catch (\Throwable) {
            $this->logger->warning("Cache entry $name could not be used; it is loaded again.");

            return null;
        }
    }

    /**
     * @param array<string, mixed> $data
     */
    public function put(string $name, array $data, int $ttlSeconds): void
    {
        try {
            if (!is_dir($this->directory) && !@mkdir($this->directory, 0o700, true) && !is_dir($this->directory)) {
                throw new \RuntimeException('the folder can\'t be created');
            }
            AtomicFile::write(
                $this->path($name),
                $this->signer->seal($name, ['expires' => $this->clock->now()->getTimestamp() + $ttlSeconds, 'data' => $data]),
            );
        } catch (\Throwable $e) {
            $this->logger->warning("Cache entry $name could not be written ({$e->getMessage()}); it is loaded again next time.");
        }
    }

    public function forget(string $name): void
    {
        @unlink($this->path($name));
    }

    private function path(string $name): string
    {
        return $this->directory . '/cache-' . hash('sha256', $name) . '.json';
    }
}
