<?php

declare(strict_types=1);

namespace CtPassStore\Service;

use Psr\Log\LoggerInterface;
use RuntimeException;

abstract class ChurchToolsBaseService extends BaseService
{
    protected string $apiUrl;
    protected string $apiToken;
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
