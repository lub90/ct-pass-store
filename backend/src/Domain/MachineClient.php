<?php

declare(strict_types=1);

namespace CtPassStore\Domain;

/**
 * A registered machine client such as ct-radius (spec 3.2, 4.4a, D5). Only valid entries become MachineClients;
 * invalid ones are disabled when the settings are loaded.
 */
final class MachineClient
{
    public const ID_PATTERN = '/^[a-z0-9-]{3,40}\z/';

    /** The only permission known today. Others grant nothing. */
    public const PERMISSION_READ_ENTRIES = 'entries:read';

    /**
     * @param non-empty-list<string> $publicKeys raw Ed25519 public keys (32 bytes each)
     * @param list<string> $permissions only known permissions
     */
    public function __construct(
        public readonly string $id,
        public readonly string $name,
        public readonly array $publicKeys,
        public readonly array $permissions,
    ) {
        if (preg_match(self::ID_PATTERN, $id) !== 1) {
            throw new \InvalidArgumentException('Invalid machine client ID.');
        }
        foreach ($publicKeys as $key) {
            if (strlen($key) !== SODIUM_CRYPTO_SIGN_PUBLICKEYBYTES) {
                throw new \InvalidArgumentException('Machine client keys are raw Ed25519 public keys.');
            }
        }
    }
}
