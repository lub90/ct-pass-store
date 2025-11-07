<?php

declare(strict_types=1);

namespace CtPassStore\Service;

use RuntimeException;

class ExtensionDataService
{
    private ?int $moduleId = null;
    private ?array $categories = null;
    private ChurchToolsBaseService $client;
    private string $extensionKey;

    public function __construct(ChurchToolsBaseService $client, string $extensionKey)
    {
        $this->client = $client;
        $this->extensionKey = $extensionKey;
    }

    private function resolveModuleId(): int
    {
        if ($this->moduleId !== null) {
            return $this->moduleId;
        }

        $response = $this->client->get("/custommodules/{$this->extensionKey}");

        $this->moduleId = $response['data']['id'] ?? throw new RuntimeException('Module ID not found');
        return $this->moduleId;
    }

    private function fetchCategories(): array
    {
        if ($this->categories !== null) {
            return $this->categories;
        }

        $moduleId = $this->resolveModuleId();
        $this->categories = $this->client->get("/custommodules/{$moduleId}/customdatacategories")['data'];

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

    public function getCategoryData(string $name, bool $single): array
    {
        $category = $this->getCategoryByName($name);
        $result = $this->client->get("/custommodules/{$category['customModuleId']}/customdatacategories/{$category['id']}/customdatavalues")['data'];

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
            'domainId' => '1',
            'domainType' => 'status',
            'value' => json_encode($data),
        ];

        $response = $this->client->post("/custommodules/{$moduleId}/customdatacategories/{$category['id']}/customdatavalues", $payload);
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

        $response = $this->client->put("/custommodules/{$moduleId}/customdatacategories/{$category['id']}/customdatavalues/{$valueId}", $payload);
        return $response['data']['id'] ?? throw new RuntimeException('Failed to update entry');
    }

    public function deleteCategoryEntry(string $name, int $valueId): void
    {
        $category = $this->getCategoryByName($name);
        $moduleId = $this->resolveModuleId();

        $this->client->delete("/custommodules/{$moduleId}/customdatacategories/{$category['id']}/customdatavalues/{$valueId}");
    }
}
