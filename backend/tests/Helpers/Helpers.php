<?php

namespace CtPassStore\Tests\Helpers;

use CtPassStore\ChurchTools\Credential;
use CtPassStore\ChurchTools\GuzzleChurchToolsClient;
use CtPassStore\Config\AppConfig;
use CtPassStore\Service\ExtensionDataService;

class Helpers
{
    private static ?ExtensionDataService $extensionDataService = null;

    public static function getExtensionDataService(): ExtensionDataService
    {
        if (self::$extensionDataService == null) {
            $client = new GuzzleChurchToolsClient((string) getenv('CT_API_URL'), Credential::loginToken((string) getenv('CT_API_TOKEN')));
            self::$extensionDataService = new ExtensionDataService($client, AppConfig::CT_EXTENSION_ID);
        }
        return self::$extensionDataService;
    }

}
