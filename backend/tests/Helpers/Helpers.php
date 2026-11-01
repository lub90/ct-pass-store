<?php

namespace CtPassStore\Tests\Helpers;

use CtPassStore\Infrastructure\ChurchTools\Credential;
use CtPassStore\Infrastructure\ChurchTools\GuzzleChurchToolsClient;
use CtPassStore\Infrastructure\Kv\ExtensionData;

class Helpers
{
    private static ?ExtensionData $extensionData = null;

    public static function getExtensionData(): ExtensionData
    {
        if (self::$extensionData == null) {
            $client = new GuzzleChurchToolsClient((string) getenv('CT_API_URL'), Credential::loginToken((string) getenv('CT_API_TOKEN')));
            self::$extensionData = new ExtensionData($client);
        }
        return self::$extensionData;
    }

    /**
     * @param array<string, mixed> $data
     */
    public static function createEntry(string $category, array $data): int
    {
        return self::getExtensionData()->create($category, json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES));
    }
}
