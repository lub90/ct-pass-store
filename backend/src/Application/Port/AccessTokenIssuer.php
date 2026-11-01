<?php

declare(strict_types=1);

namespace CtPassStore\Application\Port;

use CtPassStore\Application\IssuedToken;
use CtPassStore\Domain\PersonPrincipal;

interface AccessTokenIssuer
{
    public function issue(PersonPrincipal $person): IssuedToken;
}
