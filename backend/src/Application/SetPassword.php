<?php

declare(strict_types=1);

namespace CtPassStore\Application;

use CtPassStore\Application\Exception\CustomPasswordNotAllowedException;
use CtPassStore\Application\Exception\PasswordRejectedException;
use CtPassStore\Application\Port\PasswordCipher;
use CtPassStore\Application\Port\PasswordRepository;
use CtPassStore\Application\Port\SettingsRepository;
use CtPassStore\Domain\PasswordPolicy;
use CtPassStore\Domain\PersonId;
use CtPassStore\Domain\Principal;
use Psr\Log\LoggerInterface;

/**
 * Sets a person's secondary password to a custom or a generated one (spec 4.6).
 */
final class SetPassword
{
    public function __construct(
        private readonly EntryGuard $guard,
        private readonly SettingsRepository $settings,
        private readonly PasswordPolicy $policy,
        private readonly PasswordCipher $cipher,
        private readonly PasswordRepository $passwords,
        private readonly LoggerInterface $logger,
    ) {}

    /**
     * @param string|null $custom the password to set, or null to generate one
     * @return string|null the generated password, or null if the custom one was stored
     */
    public function execute(
        Principal $principal,
        PersonId $target,
        #[\SensitiveParameter]
        ?string $custom,
        #[\SensitiveParameter]
        ?string $primaryPassword,
    ): ?string {
        $this->guard->authorizeChange($principal, $target, $primaryPassword);
        $settings = $this->settings->settings();

        if ($custom !== null) {
            if (!$settings->allowCustomPasswords) {
                $this->logger->warning(ucfirst($principal->describe()) . ' tried to set a custom password, but custom passwords are disabled.');
                throw new CustomPasswordNotAllowedException('Custom passwords are disabled; omit secondaryPwd to get a generated password.');
            }
            $violations = $this->policy->violations($custom, $settings->passwordLength);
            if ($violations !== []) {
                $this->logger->info(ucfirst($principal->describe()) . " tried to set a password that doesn't meet the policy.");
                throw new PasswordRejectedException(sprintf(
                    'The password must have %d to %d characters, contain a letter, a digit and one of ! @ $ %% & * - _ + = ? . and no other characters.',
                    $settings->passwordLength,
                    PasswordPolicy::MAX_LENGTH,
                ), $violations);
            }
            $password = $custom;
        } else {
            $password = $this->policy->generateRandom($settings->passwordLength);
        }

        // Stored first; a generated password is only returned once it's saved (spec 4.6).
        $this->passwords->save($target, $this->cipher->encrypt($password));

        return $custom === null ? $password : null;
    }
}
