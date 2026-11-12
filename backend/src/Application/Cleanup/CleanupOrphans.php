<?php

declare(strict_types=1);

namespace CtPassStore\Application\Cleanup;

use CtPassStore\Application\Failure\Failure;
use CtPassStore\Application\GoneAdmins;
use CtPassStore\Application\GonePersons;
use CtPassStore\Application\Port\PasswordRepository;
use CtPassStore\Application\Port\PersonDirectory;
use CtPassStore\Application\Port\SettingsRepository;
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
        private readonly LoggerInterface $logger,
    ) {}

    public function run(bool $apply, ?\DateTimeImmutable $deadline = null): CleanupReport
    {
        $this->persons->assertReadable();

        $personIds = $this->passwords->personIds();
        $settings = $this->settings->settings();

        $result = $this->gonePersons->find($personIds, $deadline);
        $goneAdmins = $this->goneAdmins->find($settings);

        $failed = [];
        if ($apply) {
            foreach ($result->gone as $person) {
                try {
                    $this->passwords->delete($person);
                    $this->logger->info("Deleted the password entries of person {$person->value}; the person is deleted or archived.");
                } catch (Failure $e) {
                    $failed[$person->value] = $e->getMessage();
                    $this->logger->warning("Couldn't delete the password entries of person {$person->value}: {$e->getMessage()}");
                }
            }
        }

        $report = new CleanupReport($apply, count($personIds), $result->gone, $result->unchecked, $failed, $goneAdmins);
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
}
