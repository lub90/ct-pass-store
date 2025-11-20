<?php

declare(strict_types=1);

namespace CtPassStore\Service;

use ChurchTools\SimpleClient;
use RuntimeException;
use ChurchTools\Configuration;

class ExtensionDataService
{
    private ?int $moduleId = null;
    private ?array $categories = null;
    private SimpleClient $client;
    private readonly string $extensionKey;

    public function __construct(Configuration $ctConfig, string $extensionKey)
    {
        $this->client = new SimpleClient($ctConfig);
        $this->extensionKey = $extensionKey;
    }

    private function resolveModuleId(): int
    {
        if ($this->moduleId !== null) {
            return $this->moduleId;
        }

        $response = $this->client->getJson("custommodules/{$this->extensionKey}");

        $this->moduleId = $response['data']['id'] ?? throw new RuntimeException('Module ID not found');
        return $this->moduleId;
    }

    private function fetchCategories(): array
    {
        if ($this->categories !== null) {
            return $this->categories;
        }

        $moduleId = $this->resolveModuleId();

        $this->categories = $this->client->getJson("custommodules/{$moduleId}/customdatacategories")['data'];

        return $this->categories;
    }

    public function getCategoryByName(string $name): array
    {
        $categories = $this->fetchCategories();
        foreach ($categories as $category) {
            if ($category['name'] === $name) {
                return $category;
            }
        }
        throw new RuntimeException("Category \"$name\" not found.");
    }

    public function getCategoryData(string $name, bool $single = false): array
    {
        $category = $this->getCategoryByName($name);
        $result = $this->client->getJson("custommodules/{$category['customModuleId']}/customdatacategories/{$category['id']}/customdatavalues")['data'];

        if ($single) {
           $result = $result[0];
        }

        return $result;
    }

    public function createCategoryEntry(string $name, array $data): int
    {
        $moduleId = $this->resolveModuleId();
        $category = $this->getCategoryByName($name);

        $payload = [
            'dataCategoryId' => $category['id'],
            'value' => json_encode($data),
        ];

        $response = $this->client->postJson(
            "custommodules/{$moduleId}/customdatacategories/{$category['id']}/customdatavalues",
            [
                'json' => $payload
            ]);
        
        return $response['data']['id'] ?? throw new RuntimeException('Failed to create entry');
    }

    public function updateCategoryEntry(string $name, int $valueId, array $data): int
    {
        $moduleId = $this->resolveModuleId();
        $category = $this->getCategoryByName($name);

        $payload = [
            'dataCategoryId' => $category['id'],
            'id' => $valueId,
            'value' => json_encode($data),
        ];

        $response = $this->client->put("custommodules/{$moduleId}/customdatacategories/{$category['id']}/customdatavalues/{$valueId}", [
            'json' => $payload,
        ]);
        $body = json_decode((string)$response->getBody(), true);

        return $body['data']['id'] ?? throw new RuntimeException('Failed to update entry');
    }

    public function deleteCategoryEntry(string $name, int $valueId): void
    {
        $category = $this->getCategoryByName($name);
        $moduleId = $this->resolveModuleId();

        $this->client->delete("custommodules/{$moduleId}/customdatacategories/{$category['id']}/customdatavalues/{$valueId}");
    }
}
