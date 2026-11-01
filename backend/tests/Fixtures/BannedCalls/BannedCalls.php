<?php

declare(strict_types=1);

// Deliberately contains banned calls. Never executed; only analysed by tests/Unit/Security/BannedCallsTest.php
// to prove that the PHPStan rule set in phpstan-security.neon is active. Excluded from the regular analysis.

namespace CtPassStore\Tests\Fixtures\BannedCalls;

final class BannedCalls
{
    public function all(string $input): void
    {
        eval($input);
        exec($input);
        shell_exec($input);
        unserialize($input);
        str_shuffle($input);
        mt_rand();
        md5($input);
        strcmp($input, 'secret');
        var_dump($input);
        in_array($input, ['a']);
    }
}
