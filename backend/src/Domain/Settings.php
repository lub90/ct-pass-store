<?php

declare(strict_types=1);

namespace CtPassStore\Domain;

/**
 * The extension's settings as the backend uses them (spec 5.4). Built only from validated values.
 */
final class Settings
{
    /**
     * @param string|null $backendUrl without a trailing slash; null if the setting is missing
     * @param array<string, MachineClient> $machineClients the enabled clients by ID (from the access category)
     * @param int|null $adminGroupId the ChurchTools group whose active members are admins; null means no admins
     */
    public function __construct(
        public readonly bool $requirePrimaryPassword,
        public readonly bool $allowCustomPasswords,
        public readonly int $passwordLength,
        public readonly ?string $backendUrl,
        public readonly array $machineClients = [],
        public readonly ?int $adminGroupId = null,
    ) {
        if ($passwordLength < PasswordPolicy::MIN_CONFIGURABLE_LENGTH || $passwordLength > PasswordPolicy::MAX_CONFIGURABLE_LENGTH) {
            throw new \InvalidArgumentException("A password length of $passwordLength is outside the configurable range.");
        }
    }

    /**
     * The same settings with the admin group and machine clients of the access category.
     *
     * @param array<string, MachineClient> $machineClients
     */
    public function withAccess(?int $adminGroupId, array $machineClients): self
    {
        return new self(
            $this->requirePrimaryPassword,
            $this->allowCustomPasswords,
            $this->passwordLength,
            $this->backendUrl,
            $machineClients,
            $adminGroupId,
        );
    }
}
