<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Store;

/**
 * Signs and verifies record files: JSON `{format, keyId, data, mac}` (spec 6.1).
 *
 * The HMAC key is derived from `JWT_SECRET` and a purpose label; the `keyId` is a hash of that key, never the key. The
 * MAC covers the key ID, the record name and the data, so a record can't be copied to another name. Shared by the
 * security store and the cache, which differ in purpose and in what they do with a bad record.
 */
final class RecordSigner
{
    private const FORMAT = 1;

    private readonly string $key;
    private readonly string $keyId;

    public function __construct(
        #[\SensitiveParameter]
        string $jwtSecret,
        string $purpose,
    ) {
        $this->key = hash_hmac('sha256', $purpose, $jwtSecret, true);
        $this->keyId = substr(hash('sha256', $this->key), 0, 16);
    }

    /**
     * @param array<string, mixed> $data
     */
    public function seal(string $name, array $data): string
    {
        $encoded = json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);

        return json_encode([
            'format' => self::FORMAT,
            'keyId' => $this->keyId,
            'data' => $encoded,
            'mac' => $this->mac($name, $encoded),
        ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
    }

    public function open(string $name, string $raw): OpenedRecord
    {
        if ($raw === '') {
            return new OpenedRecord(OpenedStatus::Valid);
        }

        $file = json_decode($raw, true, 4);
        if (!is_array($file) || !is_string($file['keyId'] ?? null)) {
            return new OpenedRecord(OpenedStatus::Tampered);
        }
        if (!hash_equals($this->keyId, $file['keyId'])) {
            return new OpenedRecord(OpenedStatus::OldKey);
        }
        $encoded = $file['data'] ?? null;
        $mac = $file['mac'] ?? null;
        if (($file['format'] ?? null) !== self::FORMAT || !is_string($encoded) || !is_string($mac) || !hash_equals($this->mac($name, $encoded), $mac)) {
            return new OpenedRecord(OpenedStatus::Tampered);
        }
        $data = json_decode($encoded, true, 16);
        if (!is_array($data) || ($data !== [] && array_is_list($data))) {
            return new OpenedRecord(OpenedStatus::Tampered);
        }

        return new OpenedRecord(OpenedStatus::Valid, $data);
    }

    private function mac(string $name, string $encoded): string
    {
        return hash_hmac('sha256', $this->keyId . "\n" . $name . "\n" . $encoded, $this->key);
    }
}
