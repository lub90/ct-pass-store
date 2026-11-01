<?php

namespace CtPassStore\Tests\EndToEnd;

use CtPassStore\Tests\EndToEnd\Helpers\AccessTestPrototype;

class EntriesGeneralAccessTest extends AccessTestPrototype
{
    public function getEndpoint(): string
    {
        return '/entries/12';
    }

    public function getPublicKeyPath(): string
    {
        return __DIR__ . '/../keys/publicKey1.pem';
    }

    public function getPrivateKeyPath(): string
    {
        return __DIR__ . '/../keys/privateKey1.pem';
    }

    public function getMethods(): array
    {
        return ['get', 'put', 'delete'];
    }

    public function getSettingsPath(): string
    {
        return __DIR__ . '/../settings/false_false_12.json';
    }

}
