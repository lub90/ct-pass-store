<?php

declare(strict_types=1);

namespace CtPassStore\Service;

use GuzzleHttp\Client;
use GuzzleHttp\Exception\RequestException;
use Psr\Log\LoggerInterface;

class ChurchToolsAuthVerifier
{
    private string $apiUrl;
    private Client $http;
    private LoggerInterface $logger;

    public function __construct(string $apiUrl, LoggerInterface $logger)
    {
        $this->apiUrl = rtrim($apiUrl, '/');
        $this->http = new Client([
            'base_uri' => $this->apiUrl,
            'timeout' => 5.0,
            'http_errors' => false,
        ]);
        $this->logger = $logger;
    }

    public function verifyUserPassword(string $username, string $password): bool
    {
        try {
            $response = $this->http->post('/login', [
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

            $this->logger->info("ChurchTools password check failed for user '$username' with status $status");
            return false;

        } catch (RequestException $e) {
            $this->logger->error("ChurchTools password check error for user '$username': " . $e->getMessage());
            return false;
        }
    }
}
