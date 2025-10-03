<?php

declare(strict_types=1);

namespace CtPassStore\Service;

use Psr\Log\LoggerInterface;
use RuntimeException;

abstract class ChurchToolsBaseService
{
    protected string $apiUrl;
    protected string $apiToken;
    protected LoggerInterface $logger;

    public function __construct(string $apiUrl, string $apiToken, LoggerInterface $logger)
    {
        if (empty($apiUrl)) {
            throw new RuntimeException('Churchtools API URL must be set.');
        }
        if (empty($apiToken)) {
            throw new RuntimeException('Churchtools API token must be set.');
        }
        $this->apiUrl = rtrim($apiUrl, '/');
        $this->apiToken = $apiToken;
        $this->logger = $logger;
    }

    protected function defaultHeaders(): array
    {
        return [
            'Authorization' => 'Login ' . $this->apiToken,
            'Content-Type' => 'application/json',
            'Accept' => 'application/json',
        ];
    }

    protected function endpoint(string $path): string
    {
        return $this->apiUrl . '/' . ltrim($path, '/');
    }
}
