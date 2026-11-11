<?php

declare(strict_types=1);

namespace CtPassStore\Application\SelfCheck;

final readonly class CheckOutcome
{
    private function __construct(public bool $ok, public string $message) {}

    public static function ok(string $message): self
    {
        return new self(true, $message);
    }

    public static function fail(string $message): self
    {
        return new self(false, $message);
    }
}
