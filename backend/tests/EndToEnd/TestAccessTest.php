<?php

namespace CtPassStore\Tests\EndToEnd;

use CtPassStore\Tests\EndToEnd\Helpers\AccessTestPrototype;


class TestAccessTest extends AccessTestPrototype {

    public function getEndpoint(): string {
        return '/test';
    }

    public function getMethods(): array {
        return ['get'];
    }

}

    