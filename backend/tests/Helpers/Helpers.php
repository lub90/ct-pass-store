<?php

namespace CtPassStore\Tests\Helpers;

use ChurchTools\Configuration;

class Helpers {

    public static function getConfiguration(): Configuration {
        // Setup the churchtools config
        return Configuration::getDefaultConfiguration()
            ->setHost(getenv('CT_API_URL'))
            ->setApiKey('Authorization', getenv('CT_API_TOKEN'))
            ->setApiKeyPrefix('Authorization', 'Login');
    }

}

