<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Kv;

use CtPassStore\Application\Port\PasswordRepository;
use CtPassStore\Domain\PersonId;
use CtPassStore\Infrastructure\ChurchTools\Exception\ChurchToolsException;
use CtPassStore\Infrastructure\ChurchTools\Exception\NotFoundException;
use Psr\Log\LoggerInterface;

/**
 * The encrypted passwords in the KV category `passwordStore`, one value per person (spec 5.3).
 *
 * The KV store has no keys, no transactions and no conflict detection, so this class:
 * - matches entries by a normalized person ID,
 * - tolerates duplicates (the newest wins and the others are removed on the next write),
 * - skips broken values without failing for other people,
 * - ignores values with the reserved person ID 0 (they belong to the self-test).
 */
final class KvPasswordRepository implements PasswordRepository
{
    /** Values must stay under the KV store's limit (spec 5.3.8). */
    public const MAX_VALUE_LENGTH = 10_000;

    /** Reserved for the self-test (spec 5.3.11). */
    public const SELF_TEST_PERSON_ID = 0;

    public function __construct(
        private readonly ExtensionData $extension,
        private readonly LoggerInterface $logger,
    ) {}

    /**
     * The newest ciphertext stored for the person, or null if there's none.
     */
    public function find(PersonId $person): ?string
    {
        $personId = $person->value;

        $valid = array_filter($this->entriesOf($personId), static fn(array $entry): bool => $entry['ciphertext'] !== null);
        if ($valid === []) {
            return null;
        }
        if (count($valid) > 1) {
            $this->logger->warning(sprintf('Person %d has %d password entries; using the newest.', $personId, count($valid)));
        }

        return $valid[array_key_last($valid)]['ciphertext'];
    }

    /**
     * Stores the ciphertext as the person's only entry: updates the newest existing entry and removes all others,
     * or creates one.
     *
     * @throws ChurchToolsException if the entry can't be written; the previous entry then stays as it was
     */
    public function save(PersonId $person, string $ciphertext): void
    {
        $personId = $person->value;

        $value = json_encode([
            KvSchema::ENTRY_PERSON_ID => $personId,
            KvSchema::ENTRY_CIPHERTEXT => $ciphertext,
        ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
        if (strlen($value) > self::MAX_VALUE_LENGTH) {
            throw new \LogicException(sprintf('A password entry would have %d characters; the KV store allows %d.', strlen($value), self::MAX_VALUE_LENGTH));
        }

        $entries = $this->entriesOf($personId);
        if ($entries === []) {
            $id = $this->extension->create(KvSchema::PASSWORD_CATEGORY, $value);
            $this->logger->info("Created password entry $id for person $personId.");

            return;
        }

        // Update the newest entry first: if that fails, nothing has changed. Only then remove the others.
        $newest = array_pop($entries);
        try {
            $this->extension->update(KvSchema::PASSWORD_CATEGORY, $newest['id'], $value);
            $this->logger->info("Updated password entry {$newest['id']} for person $personId.");
        } catch (NotFoundException) {
            // A concurrent delete removed the entry after it was read (spec 5.3.6). The write still has to land.
            // If the category itself is gone, creating fails too and that error propagates.
            $id = $this->extension->create(KvSchema::PASSWORD_CATEGORY, $value);
            $this->logger->info("Password entry {$newest['id']} of person $personId disappeared while writing; created entry $id.");
        }

        foreach ($entries as $duplicate) {
            try {
                $this->extension->delete(KvSchema::PASSWORD_CATEGORY, $duplicate['id']);
                $this->logger->warning("Removed duplicate password entry {$duplicate['id']} of person $personId.");
            } catch (ChurchToolsException $e) {
                // The new password is stored and read as the newest entry; the next write retries the cleanup.
                $this->logger->warning("Couldn't remove duplicate password entry {$duplicate['id']} of person $personId: " . $e->getMessage());
            }
        }
    }

    /**
     * Removes every entry of the person, including duplicates and broken ones.
     */
    public function delete(PersonId $person): void
    {
        $personId = $person->value;

        foreach ($this->entriesOf($personId) as $entry) {
            try {
                $this->extension->delete(KvSchema::PASSWORD_CATEGORY, $entry['id']);
                $this->logger->info("Deleted password entry {$entry['id']} of person $personId.");
            } catch (NotFoundException) {
                // Already removed by a concurrent request (spec 5.3.6): that's what a delete wants.
                $this->logger->info("Password entry {$entry['id']} of person $personId was already deleted.");
            }
        }
    }

    /**
     * The values with the reserved person ID 0, oldest first: leftovers of the self-test (spec 5.3.11). This and the
     * three methods below are the only code that touches person ID 0.
     *
     * @return list<int>
     */
    public function selfTestValueIds(): array
    {
        return array_map(static fn(array $entry): int => $entry['id'], $this->entriesOf(self::SELF_TEST_PERSON_ID));
    }

    /**
     * Creates a self-test value that looks like a normal entry and returns its ID.
     */
    public function createSelfTestValue(#[\SensitiveParameter] string $ciphertext): int
    {
        $value = json_encode([
            KvSchema::ENTRY_PERSON_ID => self::SELF_TEST_PERSON_ID,
            KvSchema::ENTRY_CIPHERTEXT => $ciphertext,
        ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
        if (strlen($value) > self::MAX_VALUE_LENGTH) {
            throw new \LogicException(sprintf('A self-test value would have %d characters; the KV store allows %d.', strlen($value), self::MAX_VALUE_LENGTH));
        }

        return $this->extension->create(KvSchema::PASSWORD_CATEGORY, $value);
    }

    /**
     * The ciphertext of a self-test value, or null if it isn't there (or has none).
     */
    public function selfTestCiphertext(int $valueId): ?string
    {
        foreach ($this->entriesOf(self::SELF_TEST_PERSON_ID) as $entry) {
            if ($entry['id'] === $valueId) {
                return $entry['ciphertext'];
            }
        }

        return null;
    }

    /**
     * Deletes a self-test value; one that is already gone counts as deleted.
     */
    public function deleteSelfTestValue(int $valueId): void
    {
        try {
            $this->extension->delete(KvSchema::PASSWORD_CATEGORY, $valueId);
        } catch (NotFoundException) {
        }
    }

    /**
     * All entries of the person, sorted by value ID (oldest first). `ciphertext` is null for a corrupt entry
     * (valid person ID, but no usable password).
     *
     * @return list<array{id: int, ciphertext: string|null}>
     */
    private function entriesOf(int $personId): array
    {
        $entries = [];
        foreach ($this->extension->values(KvSchema::PASSWORD_CATEGORY) as $raw) {
            // Value IDs are compared as integers, also if they ever arrive as strings ("10" > "9", spec 5.3.3).
            $id = self::normalizePersonId($raw['id'] ?? null);
            $id = $id === 0 ? null : $id;
            $json = $raw['value'] ?? null;
            $decoded = is_string($json) ? json_decode($json, true) : null;
            $owner = is_array($decoded) ? self::normalizePersonId($decoded[KvSchema::ENTRY_PERSON_ID] ?? null) : null;

            if (!is_int($id) || $owner === null) {
                $this->logger->warning('Skipped a password entry without a valid person ID' . (is_int($id) ? " (value $id)." : '.'));

                continue;
            }
            if ($owner !== $personId) {
                continue;
            }

            $ciphertext = $decoded[KvSchema::ENTRY_CIPHERTEXT] ?? null;
            if (!is_string($ciphertext) || $ciphertext === '') {
                $this->logger->warning("Password entry $id of person $personId has no usable password.");
                $ciphertext = null;
            }
            $entries[] = ['id' => $id, 'ciphertext' => $ciphertext];
        }

        usort($entries, static fn(array $a, array $b): int => $a['id'] <=> $b['id']);

        return $entries;
    }

    /**
     * A person ID as stored: an integer, or a string of decimal digits without sign or leading zeros (spec 5.3.1).
     * Returns null for everything else (`"05"`, `"5a"`, `5.5`, `true`, …).
     */
    public static function normalizePersonId(mixed $value): ?int
    {
        if (is_int($value)) {
            return $value >= 0 ? $value : null;
        }
        return is_string($value) ? PersonId::decimal($value) : null;
    }
}
