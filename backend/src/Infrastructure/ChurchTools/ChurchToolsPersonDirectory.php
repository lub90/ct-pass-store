<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\ChurchTools;

use CtPassStore\Application\Exception\PersonsNotReadableException;
use CtPassStore\Application\Port\PersonDirectory;
use CtPassStore\Domain\PersonId;

/**
 * {@see PersonDirectory} on the ChurchTools client.
 */
final class ChurchToolsPersonDirectory implements PersonDirectory
{
    public function __construct(private readonly ChurchToolsClient $client) {}

    public function exists(PersonId $person): bool
    {
        return $this->client->personStatus($person->value) === PersonStatus::Active;
    }

    public function confirmedActive(array $persons): array
    {
        $confirmed = [];
        foreach (array_chunk($persons, ChurchToolsClient::MAX_BATCH) as $chunk) {
            $active = $this->client->activePersonIds(array_map(static fn(PersonId $p): int => $p->value, $chunk));
            foreach ($chunk as $person) {
                if (in_array($person->value, $active, true)) {
                    $confirmed[] = $person;
                }
            }
        }

        return $confirmed;
    }

    public function assertReadable(): void
    {
        $missing = ServiceUserPersonsRight::missingIn(
            $this->client->serviceUserGlobalPermissions(),
            $this->client->personDepartmentIds(),
        );
        if ($missing !== []) {
            throw new PersonsNotReadableException(sprintf(
                "The service user can't read persons (missing: %s); see docs/setup.md.",
                implode(', ', $missing),
            ));
        }
    }
}
