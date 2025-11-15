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

    protected Client $http;

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
        $this->churchtoolsConfig = Configuration::getDefaultConfiguration()
            ->setHost($apiUrl)
            ->setApiKey('Authorization', $apiToken)
            ->setApiKeyPrefix('Authorization', 'Login');

        // TODO: If we do not use the client, remove it later on...
        $this->http = new Client([
            'base_uri' => $this->apiUrl . '/',
            'headers' => $this->defaultHeaders(),
            'http_errors' => true,
        ]);
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
        return ltrim($path, '/');
    }

    protected function handleResponse(\Psr\Http\Message\ResponseInterface $response): array
    {
        $body = (string) $response->getBody();
        $data = json_decode($body, true);

        if (json_last_error() !== JSON_ERROR_NONE) {
            throw new RuntimeException('Invalid JSON response: ' . json_last_error_msg());
        }

        return $data;
    }

    public function get(string $path, array $query = []): array
    {
        try {
            $response = $this->http->get($this->endpoint($path), [
                'query' => $query,
            ]);
            return $this->handleResponse($response);
        } catch (RequestException $e) {
            throw new RuntimeException('GET request failed: ' . $e->getMessage());
        }
    }

    public function post(string $path, array $data): array
    {
        try {
            $response = $this->http->post($this->endpoint($path), [
                'json' => $data,
            ]);
            return $this->handleResponse($response);
        } catch (RequestException $e) {
            throw new RuntimeException('POST request failed: ' . $e->getMessage());
        }
    }

    public function put(string $path, array $data): array
    {
        try {
            $response = $this->http->put($this->endpoint($path), [
                'json' => $data,
            ]);
            return $this->handleResponse($response);
        } catch (RequestException $e) {
            throw new RuntimeException('PUT request failed: ' . $e->getMessage());
        }
    }

    public function delete(string $path): array
    {
        try {
            $response = $this->http->delete($this->endpoint($path));
            return $this->handleResponse($response);
        } catch (RequestException $e) {
            throw new RuntimeException('DELETE request failed: ' . $e->getMessage());
        }
    }
}
