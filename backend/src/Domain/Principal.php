<?php

declare(strict_types=1);

namespace CtPassStore\Domain;

/**
 * Who a request was authenticated as. Machine clients join with plan item 3.3.
 */
interface Principal
{
    /**
     * A short description for log messages, without secrets, e.g. `user 5`.
     */
    public function describe(): string;
}
