<?php

declare(strict_types=1);

namespace CtPassStore\Service;

use Psr\Log\LoggerInterface;
use CtPassStore\Config\AppConfig;
use ChurchTools\Api\GeneralApi;
use ChurchTools\Configuration;
use CtPassStore\Service\BaseService;
use ChurchTools\Model\PostCheckinPersons201ResponseData;
use ChurchTools\SimpleClient;

/**
 * Handles ChurchTools token validation via Authorization header.
 */
class ChurchtoolsAuth extends BaseService
{

    protected string $apiUrl;

    public function __construct(string $apiUrl, LoggerInterface $logger) {
        parent::__construct($logger);

        $this->apiUrl = $apiUrl;
    }


    protected function getCtConfig(string $apiToken) : Configuration {
        return Configuration::getDefaultConfiguration()
            ->setHost($this->apiUrl)
            ->setApiKey('Authorization', $apiToken)
            ->setApiKeyPrefix('Authorization', 'Login');
    }

    /**
     * Validates a ChurchTools token and returns user info.
     *
     * @param string $token The ChurchTools API token.
     * @return PostCheckinPersons201ResponseData Returns user data if valid, or throws a Churchtools\ApiException
     */
    public function validateToken(string $apiToken) : PostCheckinPersons201ResponseData
    {
        $config = $this->getCtConfig($apiToken);
        $generalApi = new GeneralApi(config: $config);
        $whoAmI = $generalApi->getWhoami();
        
        return $whoAmI->getData();
    }

    public function hasAccessRights($apiToken) : bool {
        $config = $this->getCtConfig($apiToken);
        $simpleClient = new SimpleClient(config: $config);

        $response = $simpleClient->getJson(AppConfig::PERMISSIONS_ENDPOINT);

        // Check if 'ctpassstore' exists and has 'view' set to true
        if (
            isset($response['data']) &&
            isset($response['data'][AppConfig::CT_EXTENSION_ID]) &&
            isset($response['data'][AppConfig::CT_EXTENSION_ID]['view']) &&
            $response['data'][AppConfig::CT_EXTENSION_ID]['view'] === true
        ) {
            return true;
        }

        return false;
    }
}
