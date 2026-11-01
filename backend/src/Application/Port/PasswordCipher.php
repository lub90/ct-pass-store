<?php

declare(strict_types=1);

namespace CtPassStore\Application\Port;

/**
 * Encrypts secondary passwords for storage. The backend can't decrypt them (spec 5.2).
 */
interface PasswordCipher
{
    public function encrypt(#[\SensitiveParameter] string $password): string;
}
