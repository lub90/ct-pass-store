<?php

declare(strict_types=1);

namespace CtPassStore\Service;

use GuzzleHttp\Client;
use GuzzleHttp\Exception\RequestException;
use Psr\Log\LoggerInterface;
use CtPassStore\Config\AppConfig;

class ChurchToolsAuthVerifier extends BaseService
{
    private string $apiUrl;
    private Client $http;

    public function __construct(string $apiUrl, LoggerInterface $logger)
    {
        parent::__construct($logger);

        $this->apiUrl = rtrim($apiUrl, '/');
        $this->http = new Client([
            'base_uri' => $this->apiUrl,
            'timeout' => AppConfig::EXTERNAL_REQUEST_TIMEOUT,
            'http_errors' => false,
        ]);
    }

    public function verifyUserPassword(string $username, string $password): bool
    {
        try {
            $response = $this->http->post('/api/login', [
                'json' => [
                    'username' => $username,
                    'password' => $password,
                ],
                'headers' => [
                    'Content-Type' => 'application/json',
                    'Accept' => 'application/json',
                ],
            ]);

            $status = $response->getStatusCode();

            if ($status === 200) {
                return true;
            }

            $this->logger->info("ChurchTools password check failed for user {$username} with status {$status}");
            return false;

        } catch (RequestException $e) {
            $this->logger->error("ChurchTools password check error for user {$username}: " . $e->getMessage());
            return false;
        }
    }
}
