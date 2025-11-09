<?php

declare(strict_types=1);

namespace CtPassStore\Service;

use RuntimeException;
use Psr\Log\LoggerInterface;
use CtPassStore\Config\AppConfig;
use ChurchTools\Api\GeneralApi;
use ChurchTools\Api\PersonApi;
use ChurchTools\Configuration;
use CtPassStore\Service\BaseService;

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

    /**
     * Validates a ChurchTools token and returns user info.
     *
     * @param string $token The ChurchTools API token.
     * @return array|null Returns user data if valid, null otherwise.
     */
    public function validateToken(string $apiToken)
    {
        $config = Configuration::getDefaultConfiguration()
            ->setHost($this->apiUrl)
            ->setApiKey('Authorization', $apiToken)
            ->setApiKeyPrefix('Authorization', 'Login');

        $generalApi = new GeneralApi(config: $config);
        $whoAmI = $generalApi->getWhoami();
        
        return $whoAmI->getData();
    }
}
