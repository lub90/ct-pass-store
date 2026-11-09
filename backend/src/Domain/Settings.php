<?php

declare(strict_types=1);

namespace CtPassStore\Domain;

/**
 * The extension's settings as the backend uses them (spec 5.4). Built only from validated values.
 */
final class Settings
{
    /**
     * @param list<int> $adminUsers person IDs that may read and change every entry
     * @param string|null $backendUrl without a trailing slash; null if the setting is missing
     * @param array<string, MachineClient> $machineClients the enabled clients by ID
     */
    public function __construct(
        public readonly bool $requirePrimaryPassword,
        public readonly bool $allowCustomPasswords,
        public readonly int $passwordLength,
        public readonly array $adminUsers,
        public readonly ?string $backendUrl,
        public readonly array $machineClients = [],
    ) {
        if ($passwordLength < PasswordPolicy::MIN_CONFIGURABLE_LENGTH || $passwordLength > PasswordPolicy::MAX_CONFIGURABLE_LENGTH) {
            throw new \InvalidArgumentException("A password length of $passwordLength is outside the configurable range.");
        }
    }

    public function isAdmin(PersonId $person): bool
    {
        return in_array($person->value, $this->adminUsers, true);
    }
}
