<?php

declare(strict_types=1);

namespace CtPassStore\Application\Cleanup;

use CtPassStore\Application\GoneAdmins;
use CtPassStore\Application\GonePersons;
use CtPassStore\Application\Port\Clock;
use CtPassStore\Application\Port\PasswordRepository;
use CtPassStore\Application\Port\PersonDirectory;
use CtPassStore\Application\Port\SettingsRepository;
use CtPassStore\Domain\PersonId;
use Psr\Log\LoggerInterface;

/**
 * Deletes the password entries of persons who are deleted or archived in ChurchTools (cleanup design 3.5).
 *
 * Nothing is deleted unless every lookup of the run succeeded: a failure before the first delete propagates.
 */
final class CleanupOrphans
{
    public function __construct(
        private readonly PasswordRepository $passwords,
        private readonly SettingsRepository $settings,
        private readonly PersonDirectory $persons,
        private readonly GonePersons $gonePersons,
        private readonly GoneAdmins $goneAdmins,
        private readonly Clock $clock,
        private readonly LoggerInterface $logger,
    ) {}

    /**
     * @param \DateTimeImmutable|null $deadline the web run's budget: single lookups only start in its first half, so
     *     the gone persons they find can still be deleted; no delete starts after it. Persons left over go to
     *     `unchecked` and the next run continues with them.
     */
    public function run(bool $apply, ?\DateTimeImmutable $deadline = null): CleanupReport
    {
        $lookupDeadline = $deadline === null ? null : $this->halfwayTo($deadline);

        $this->persons->assertReadable();

        $personIds = $this->passwords->personIds();
        $settings = $this->settings->settings();

        $result = $this->gonePersons->find($personIds, $lookupDeadline);
        $goneAdmins = $this->goneAdmins->find($settings);

        $gone = $result->gone;
        $unchecked = $result->unchecked;
        $failed = [];
        if ($apply && $gone !== []) {
            $deletes = $this->passwords->deleteEntriesOf(
                $gone,
                fn(): bool => $deadline === null || $this->clock->now() <= $deadline,
            );
            foreach ($deletes->deleted as $person) {
                $this->logger->info("Deleted the password entries of person {$person->value}; the person is deleted or archived.");
            }
            foreach ($deletes->failed as $personId => $message) {
                $this->logger->warning("Couldn't delete the password entries of person {$personId}: {$message}");
            }
            $failed = $deletes->failed;
            if ($deletes->notStarted !== []) {
                // Not deleted and not to be reported as gone: they're checked again by the next run.
                $gone = array_values(array_udiff($gone, $deletes->notStarted, static fn(PersonId $a, PersonId $b): int => $a->value <=> $b->value));
                $unchecked = array_merge($unchecked, $deletes->notStarted);
                usort($unchecked, static fn(PersonId $a, PersonId $b): int => $a->value <=> $b->value);
            }
        }

        $report = new CleanupReport($apply, count($personIds), $gone, $unchecked, $failed, $goneAdmins);
        $this->logger->info(sprintf(
            'Cleanup %s: %d persons checked, %d gone, %d deleted, %d failed, %d unchecked, %d gone admins.',
            $apply ? 'applied' : 'dry run',
            $report->checked,
            count($report->gone),
            $report->deletedCount(),
            count($failed),
            count($report->unchecked),
            count($goneAdmins),
        ));

        return $report;
    }

    private function halfwayTo(\DateTimeImmutable $deadline): \DateTimeImmutable
    {
        $now = $this->clock->now();
        $seconds = intdiv(max(0, $deadline->getTimestamp() - $now->getTimestamp()), 2);

        return $now->modify("+$seconds seconds");
    }
}
