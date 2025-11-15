<?php

namespace CtPassStore\Tests\EndToEnd;

class TestAccessTest extends AccessTestPrototype {

    public function getEndpoint(): string {
        return '/test';
    }

    public function getMethods(): array {
        return ['get'];
    }

}

    