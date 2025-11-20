<?php

declare(strict_types=1);

namespace CtPassStore\Service;

use Psr\Log\LoggerInterface;
use RuntimeException;
use GuzzleHttp\Client;
use GuzzleHttp\Exception\RequestException;
use ChurchTools\Configuration;
use ChurchTools\Api\PersonApi;

abstract class ChurchToolsBaseService extends BaseService
{
    protected string $apiUrl;
    protected string $apiToken;
    protected Configuration $churchtoolsConfig;


    public function __construct(string $apiUrl, string $apiToken, LoggerInterface $logger)
    {
        parent::__construct($logger);
        
        if (empty($apiUrl)) {
            throw new RuntimeException('Churchtools API URL must be set.');
        }
        if (empty($apiToken)) {
            throw new RuntimeException('Churchtools API token must be set.');
        }
        $this->apiUrl = rtrim($apiUrl, '/');
        $this->apiToken = $apiToken;

        // Setup the churchtools config
        $this->churchtoolsConfig = (new Configuration())
            ->setHost($apiUrl)
            ->setApiKey('Authorization', $apiToken)
            ->setApiKeyPrefix('Authorization', 'Login');
    }

}
