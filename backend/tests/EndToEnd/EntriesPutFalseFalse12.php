<?php

use CtPassStore\Tests\EndToEnd\EntriesPutTestPrototype;


class EntriesPutFalseFalse12 extends EntriesPutTestPrototype {


    public function getSettingsPath(): string
    {
        return __DIR__ . '/../settings/false_false_12.json';
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