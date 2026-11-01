<?php

declare(strict_types=1);

namespace CtPassStore\Service;

use CtPassStore\Config\AppConfig;
use CtPassStore\Infrastructure\ChurchTools\Exception\ChurchToolsException;

/**
 * The encrypted passwords in the KV category `passwordStore`, one value per person (spec 5.3).
 *
 * The KV store has no keys, no transactions and no conflict detection, so this class:
 * - matches entries by a normalized person ID,
 * - tolerates duplicates (the newest wins and the others are removed on the next write),
 * - skips broken values without failing for other people,
 * - ignores values with the reserved person ID 0 (they belong to the self-test).
 */
class ChurchToolsStore extends ChurchToolsBaseService
{
    /** Values must stay under the KV store's limit (spec 5.3.8). */
    public const MAX_VALUE_LENGTH = 10_000;

    /** Reserved for the self-test (spec 5.3.11). */
    public const SELF_TEST_PERSON_ID = 0;

    /**
     * The newest ciphertext stored for the person, or null if there's none.
     */
    public function getPwd(int $personId): ?string
    {
        $this->assertPerson($personId);

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
    public function putPwd(int $personId, string $ciphertext): void
    {
        $this->assertPerson($personId);

        $value = json_encode([
            AppConfig::CT_PERSON_ID_PWD_FIELD => $personId,
            AppConfig::CT_ENCRYPTED_PWD_FIELD => $ciphertext,
        ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
        if (strlen($value) > self::MAX_VALUE_LENGTH) {
            throw new \LogicException(sprintf('A password entry would have %d characters; the KV store allows %d.', strlen($value), self::MAX_VALUE_LENGTH));
        }

        $entries = $this->entriesOf($personId);
        if ($entries === []) {
            $id = $this->extension->createCategoryEntryRaw(AppConfig::CT_PWD_CATEGORY_NAME, $value);
            $this->logger->info("Created password entry $id for person $personId.");

            return;
        }

        // Update the newest entry first: if that fails, nothing has changed. Only then remove the others.
        $newest = array_pop($entries);
        $this->extension->updateCategoryEntryRaw(AppConfig::CT_PWD_CATEGORY_NAME, $newest['id'], $value);
        $this->logger->info("Updated password entry {$newest['id']} for person $personId.");

        foreach ($entries as $duplicate) {
            try {
                $this->extension->deleteCategoryEntry(AppConfig::CT_PWD_CATEGORY_NAME, $duplicate['id']);
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
    public function deletePwd(int $personId): void
    {
        $this->assertPerson($personId);

        foreach ($this->entriesOf($personId) as $entry) {
            $this->extension->deleteCategoryEntry(AppConfig::CT_PWD_CATEGORY_NAME, $entry['id']);
            $this->logger->info("Deleted password entry {$entry['id']} of person $personId.");
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
        foreach ($this->extension->getCategoryData(AppConfig::CT_PWD_CATEGORY_NAME) as $raw) {
            $id = is_array($raw) ? ($raw['id'] ?? null) : null;
            $json = is_array($raw) ? ($raw['value'] ?? null) : null;
            $decoded = is_string($json) ? json_decode($json, true) : null;
            $owner = is_array($decoded) ? self::normalizePersonId($decoded[AppConfig::CT_PERSON_ID_PWD_FIELD] ?? null) : null;

            if (!is_int($id) || $owner === null) {
                $this->logger->warning('Skipped a password entry without a valid person ID' . (is_int($id) ? " (value $id)." : '.'));

                continue;
            }
            if ($owner !== $personId) {
                continue;
            }

            $ciphertext = $decoded[AppConfig::CT_ENCRYPTED_PWD_FIELD] ?? null;
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
        if (is_string($value) && preg_match('/^(0|[1-9][0-9]{0,17})\z/', $value) === 1) {
            return (int) $value;
        }

        return null;
    }

    private function assertPerson(int $personId): void
    {
        if ($personId < 1) {
            throw new \InvalidArgumentException('Person IDs are positive; 0 is reserved for the self-test.');
        }
    }
}
