<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Store;

use CtPassStore\Application\Exception\ConfigurationException;
use CtPassStore\Application\Failure\Reason;
use Psr\Log\LoggerInterface;

/**
 * Small security records (the `jti` replay cache, rate-limit counters) as signed JSON files (spec 6.1).
 *
 * - One data file per record name; the name is hashed for the file name. Files are `600`, the folder `700`.
 * - JSON only, never `unserialize`. Each file carries an HMAC over its record name and data, with a key derived from
 *   `JWT_SECRET`, plus an identifier of that key (a hash, not the key).
 * - Every update holds an exclusive lock on the record's **lock file** from reading to writing, so concurrent requests
 *   don't lose updates. The lock file is never replaced or deleted: locking the data file itself would break, because
 *   the data file is replaced on every write and a waiting worker would then hold the lock of a file that is gone.
 * - Writes are atomic: the new content goes to a temporary file in the same folder, which then replaces the data file
 *   with `rename`. A request killed mid-write leaves the old content intact, never an empty file.
 * - Fail closed: if the folder can't be used, or a file signed with the current key is broken or tampered with, the
 *   update throws a ConfigurationException (`500 misconfigured`). A file signed with an older key (`JWT_SECRET` was
 *   rotated) is cleared and started over.
 *
 * What the HMAC can't do: someone who can write the folder can always **reset** a record, by deleting the file or by
 * writing one with another key identifier (indistinguishable from a rotation). The HMAC only stops them from
 * planting chosen content, such as a fake `jti` list or counters. Against resets only the file permissions help.
 */
final class SignedFileStore
{
    public const PURPOSE = 'ctpassstore security store v1';

    private readonly RecordSigner $signer;

    public function __construct(
        private readonly string $directory,
        #[\SensitiveParameter]
        string $jwtSecret,
        private readonly LoggerInterface $logger,
    ) {
        $this->signer = new RecordSigner($jwtSecret, self::PURPOSE);
    }

    /**
     * Reads the record, lets `$change` compute its new content and writes that, all under one exclusive lock.
     *
     * @param \Closure(array<string, mixed>): array<string, mixed> $change gets the current data ([] for a new record)
     * @return array<string, mixed> the new data
     *
     * @throws ConfigurationException if the store can't be used or the record was tampered with
     */
    public function update(string $name, \Closure $change): array
    {
        $base = $this->directory . '/sec-' . hash('sha256', $name);
        $lock = $this->openLock($base . '.lock');
        try {
            if (!flock($lock, LOCK_EX)) {
                throw self::unusable();
            }
            // Leftovers of writes that were killed before their rename; nobody else writes this record now.
            foreach (glob($base . '.*.tmp') ?: [] as $stale) {
                @unlink($stale);
            }

            $path = $base . '.json';
            $raw = is_file($path) ? @file_get_contents($path) : '';
            if ($raw === false) {
                throw self::unusable();
            }

            $data = $change($this->verified($name, $raw));

            $this->replace($path, $base . '.' . bin2hex(random_bytes(8)) . '.tmp', $this->signer->seal($name, $data));

            return $data;
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }

    /**
     * @return resource
     */
    private function openLock(string $path)
    {
        if (!is_dir($this->directory) && !@mkdir($this->directory, 0o700, true) && !is_dir($this->directory)) {
            throw self::unusable();
        }
        $isNew = !file_exists($path);
        $handle = @fopen($path, 'c');
        if ($handle === false) {
            throw self::unusable();
        }
        if ($isNew) {
            @chmod($path, 0o600);
        }

        return $handle;
    }

    /**
     * Writes the content to a new temporary file (`600` before any content is in it), flushes it to disk and moves it
     * over the data file in one step.
     */
    private function replace(string $path, string $temporary, string $content): void
    {
        $handle = @fopen($temporary, 'x');
        if ($handle === false) {
            throw self::unusable();
        }
        $written = @chmod($temporary, 0o600)
            && fwrite($handle, $content) === strlen($content)
            && fflush($handle)
            && fsync($handle);
        fclose($handle);
        if (!$written || !@rename($temporary, $path)) {
            @unlink($temporary);
            throw self::unusable();
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function verified(string $name, string $raw): array
    {
        $opened = $this->signer->open($name, $raw);
        if ($opened->status === OpenedStatus::Tampered) {
            throw $this->tampered($name);
        }
        if ($opened->status === OpenedStatus::OldKey) {
            $this->logger->notice("Security store record $name was signed with an earlier JWT_SECRET; it starts over.");
        }

        return $opened->data;
    }

    private function tampered(string $name): ConfigurationException
    {
        $this->logger->error("Security store record $name failed its integrity check; requests that need it are refused.");

        return new ConfigurationException('A security record in the backend\'s cache folder failed its integrity check. Check the server for unauthorized access, then empty the folder cache/.', Reason::StoreTampered);
    }

    private static function unusable(): ConfigurationException
    {
        return new ConfigurationException('The backend\'s cache folder can\'t be used. PHP must be able to create and write the folder cache/ next to config/.', Reason::StoreUnusable);
    }
}
