<?php

declare(strict_types=1);

namespace CtPassStore\Application;

use CtPassStore\Application\Exception\AccessDeniedException;
use CtPassStore\Application\Exception\InvalidPrimaryPasswordException;
use CtPassStore\Application\Exception\PrimaryPasswordRequiredException;
use CtPassStore\Application\Exception\TooManyAttemptsException;
use CtPassStore\Application\Port\AttemptLimiter;
use CtPassStore\Application\Port\PrimaryPasswordVerifier;
use CtPassStore\Application\Port\SettingsRepository;
use CtPassStore\Domain\AccessPolicy;
use CtPassStore\Domain\PersonId;
use CtPassStore\Domain\PersonPrincipal;
use CtPassStore\Domain\Principal;
use Psr\Log\LoggerInterface;

/**
 * The checks before an entry is touched (spec 4.1): authorization first, so the answer never reveals whether the
 * entry exists, then the primary password for changes.
 */
final class EntryGuard
{
    public function __construct(
        private readonly SettingsRepository $settings,
        private readonly PrimaryPasswordVerifier $verifier,
        private readonly AttemptLimiter $attempts,
        private readonly LoggerInterface $logger,
    ) {}

    /**
     * @throws AccessDeniedException
     */
    public function authorizeRead(Principal $principal, PersonId $target): void
    {
        // Reading one's own entry doesn't depend on the settings, so they aren't loaded for it.
        if (!AccessPolicy::isOwner($principal, $target) && !AccessPolicy::mayRead($principal, $target, $this->settings->settings())) {
            $this->deny($principal, $target);
        }
    }

    /**
     * @throws AccessDeniedException
     * @throws PrimaryPasswordRequiredException
     * @throws InvalidPrimaryPasswordException
     * @throws TooManyAttemptsException
     */
    public function authorizeChange(Principal $principal, PersonId $target, #[\SensitiveParameter] ?string $primaryPassword): void
    {
        $settings = $this->settings->settings();
        if (!AccessPolicy::mayChange($principal, $target, $settings)) {
            $this->deny($principal, $target);
        }
        if (!$settings->requirePrimaryPassword) {
            return;
        }
        if (!$principal instanceof PersonPrincipal) {
            throw new \LogicException('Only persons have a primary password.');
        }

        if ($primaryPassword === null || $primaryPassword === '') {
            $this->logger->info(ucfirst($principal->describe()) . ' tried to change an entry without the required primary password.');
            throw new PrimaryPasswordRequiredException('This change needs your ChurchTools password in primaryPwd.');
        }

        // The attempt is counted before ChurchTools is asked, so parallel requests can't run more checks than
        // allowed (spec 6.3, catalog TR-05). Blocked callers aren't checked at all, and that attempt doesn't count.
        try {
            $attempt = $this->attempts->begin($principal->id);
        } catch (TooManyAttemptsException $e) {
            $this->logger->warning(ucfirst($principal->describe()) . " tried the primary password while blocked for {$e->retryAfterSeconds} s.");
            throw $e;
        }

        // The username comes from the authenticated person, never from the request (spec 4.6).
        try {
            $correct = $this->verifier->verify($principal->username, $primaryPassword, $principal->id);
        } catch (\Throwable $e) {
            // Not a wrong password: an attempt that couldn't be checked doesn't count (spec 5.5.3).
            $this->attempts->withdraw($principal->id, $attempt);
            throw $e;
        }
        if (!$correct) {
            // Stays counted, against the caller, not the target entry (spec 6.3).
            $this->logger->warning(ucfirst($principal->describe()) . ' entered a wrong primary password.');
            throw new InvalidPrimaryPasswordException('The ChurchTools password is wrong.');
        }
        $this->attempts->succeed($principal->id);
    }

    private function deny(Principal $principal, PersonId $target): never
    {
        $this->logger->warning(ucfirst($principal->describe()) . " tried to access the entry of person {$target} without permission.");
        throw new AccessDeniedException("You aren't allowed to access the entry of person {$target}.");
    }
}
