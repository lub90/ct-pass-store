<?php

declare(strict_types=1);

namespace CtPassStore\Application\Failure;

/**
 * The common parts of Failure: no retry hint, no extra members. The reason comes from the class constant `REASON`;
 * classes with a per-instance reason, a retry hint or extensions override the method.
 */
trait FailureDefaults
{
    public function reason(): Reason
    {
        return static::REASON;
    }

    public function retryAfterSeconds(): ?int
    {
        return null;
    }

    /**
     * @return array<string, mixed>
     */
    public function extensions(): array
    {
        return [];
    }
}
