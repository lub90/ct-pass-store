<?php

namespace CtPassStore\Tests\Helpers;

use ChurchTools\Configuration;
use CtPassStore\Config\AppConfig;
use CtPassStore\Service\ExtensionDataService;

class Helpers {

    private static ?ExtensionDataService $extensionDataService = null;

    public static function getConfiguration(): Configuration {
        // Setup the churchtools config
        return (new Configuration())
            ->setHost(getenv('CT_API_URL'))
            ->setApiKey('Authorization', getenv('CT_API_TOKEN'))
            ->setApiKeyPrefix('Authorization', 'Login');
    }

    public static function getExtensionDataService(): ExtensionDataService {
        if (self::$extensionDataService == null) {
            $ctConfig = Helpers::getConfiguration();
            self::$extensionDataService = new ExtensionDataService($ctConfig, AppConfig::CT_EXTENSION_ID);
        }
        return self::$extensionDataService;
    }

}

