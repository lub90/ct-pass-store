<?php

use CtPassStore\Tests\EndToEnd\EntriesPutTestPrototype;


class EntriesPutTrueTrue12Test extends EntriesPutTestPrototype {


    public function getSettingsPath(): string
    {
        return __DIR__ . '/../settings/true_true_12.json';
    }

    public function getPublicKeyPath(): string {
        return __DIR__ . '/../keys/publicKey1.pem';
    }

    public function getPrivateKeyPath(): string {
        return __DIR__ . '/../keys/privateKey1.pem';
    }

    public static function getValidPwdPath(): string {
        return __DIR__ . '/../passwords/validPwds_12.json';
    }

}