<?php

declare(strict_types=1);

namespace CtPassStore\Application\SelfCheck;

/**
 * One check of the admin self-check (spec 4.8). Its message never contains a secret or an absolute path.
 */
interface Check
{
    public function name(): string;

    public function run(): CheckOutcome;
}
