<?php

namespace CtPassStore\Tests\EndToEnd;

use CtPassStore\Config\AppConfig;
use CtPassStore\Tests\EndToEnd\Helpers\AccessTestPrototype;
use CtPassStore\Tests\EndToEnd\Helpers\ChurchToolsSandboxManager;
use CtPassStore\Tests\EndToEnd\Helpers\PersistenceChecker;


class EntriesGeneralAccessTest extends AccessTestPrototype {

    public function getEndpoint(): string {
        return '/entries/12';
    }

    public function getPublicKeyPath(): string {
        return __DIR__ . '/../keys/publicKey1.pem';
    }

    public function getMethods(): array {
        return ['get', 'put', 'delete'];
    }

    public function getSettingsPath(): string
    {
        return __DIR__ . '/../settings/false_false_12.json';
    }
    
}

    