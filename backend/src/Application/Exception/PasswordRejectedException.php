<?php

declare(strict_types=1);

namespace CtPassStore\Application\Exception;

/**
 * A custom password that doesn't meet the policy.
 */
final class PasswordRejectedException extends ApplicationException
{
    /**
     * @param list<string> $violations codes from PasswordPolicy
     */
    public function __construct(string $message, public readonly array $violations)
    {
        parent::__construct($message);
    }
}
