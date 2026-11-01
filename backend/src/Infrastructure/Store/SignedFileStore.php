<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Store;

use CtPassStore\Config\ConfigurationException;
use Psr\Log\LoggerInterface;

/**
 * Small security records (the `jti` replay cache, rate-limit counters) as signed JSON files (spec 6.1).
 *
 * - One file per record name; the name is hashed for the file name. Files are `600`, the folder `700`.
 * - JSON only, never `unserialize`. Each file carries an HMAC over its record name and data, with a key derived from
 *   `JWT_SECRET`, plus an identifier of that key (a hash, not the key).
 * - Every update holds an exclusive lock from reading to writing, so concurrent requests don't lose updates.
 * - Fail closed: if the folder can't be used, or a file signed with the current key is broken or tampered with, the
 *   update throws a ConfigurationException (`500 misconfigured`). A file signed with an older key (`JWT_SECRET` was
 *   rotated) is cleared and started over.
 */
final class SignedFileStore
{
    private const FORMAT = 1;

    private readonly string $key;
    private readonly string $keyId;

    public function __construct(
        private readonly string $directory,
        #[\SensitiveParameter]
        string $jwtSecret,
        private readonly LoggerInterface $logger,
    ) {
        $this->key = hash_hmac('sha256', 'ctpassstore security store v1', $jwtSecret, true);
        $this->keyId = substr(hash('sha256', $this->key), 0, 16);
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
        $handle = $this->open($name);
        try {
            if (!flock($handle, LOCK_EX)) {
                throw self::unusable();
            }
            $raw = stream_get_contents($handle);
            if ($raw === false) {
                throw self::unusable();
            }

            $data = $change($this->verified($name, $raw));

            $encoded = json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
            $file = json_encode([
                'format' => self::FORMAT,
                'keyId' => $this->keyId,
                'data' => $encoded,
                'mac' => $this->mac($name, $encoded),
            ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
            if (!ftruncate($handle, 0) || !rewind($handle) || fwrite($handle, $file) !== strlen($file) || !fflush($handle)) {
                throw self::unusable();
            }

            return $data;
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }

    /**
     * @return resource
     */
    private function open(string $name)
    {
        if (!is_dir($this->directory) && !@mkdir($this->directory, 0o700, true) && !is_dir($this->directory)) {
            throw self::unusable();
        }
        $path = $this->directory . '/sec-' . hash('sha256', $name) . '.json';
        $isNew = !file_exists($path);
        $handle = @fopen($path, 'c+');
        if ($handle === false) {
            throw self::unusable();
        }
        if ($isNew) {
            @chmod($path, 0o600);
        }

        return $handle;
    }

    /**
     * @return array<string, mixed>
     */
    private function verified(string $name, string $raw): array
    {
        if ($raw === '') {
            return [];
        }

        $file = json_decode($raw, true, 4);
        if (!is_array($file) || !is_string($file['keyId'] ?? null)) {
            throw $this->tampered($name);
        }
        if (!hash_equals($this->keyId, $file['keyId'])) {
            $this->logger->notice("Security store record $name was signed with an earlier JWT_SECRET; it starts over.");

            return [];
        }
        $encoded = $file['data'] ?? null;
        $mac = $file['mac'] ?? null;
        if (($file['format'] ?? null) !== self::FORMAT || !is_string($encoded) || !is_string($mac) || !hash_equals($this->mac($name, $encoded), $mac)) {
            throw $this->tampered($name);
        }
        $data = json_decode($encoded, true, 16);
        if (!is_array($data) || ($data !== [] && array_is_list($data))) {
            throw $this->tampered($name);
        }

        return $data;
    }

    private function mac(string $name, string $encoded): string
    {
        return hash_hmac('sha256', $this->keyId . "\n" . $name . "\n" . $encoded, $this->key);
    }

    private function tampered(string $name): ConfigurationException
    {
        $this->logger->error("Security store record $name failed its integrity check; requests that need it are refused.");

        return new ConfigurationException('A security record in the backend\'s cache folder failed its integrity check. Check the server for unauthorized access, then empty the folder cache/.');
    }

    private static function unusable(): ConfigurationException
    {
        return new ConfigurationException('The backend\'s cache folder can\'t be used. PHP must be able to create and write the folder cache/ next to config/.');
    }
}
