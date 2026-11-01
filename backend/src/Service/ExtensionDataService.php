<?php

declare(strict_types=1);

namespace CtPassStore\Service;

use CtPassStore\ChurchTools\ChurchToolsClient;
use CtPassStore\Exception\ConfigurationException;

/**
 * Access to the extension's categories and values in the ChurchTools KV store, as the service user.
 *
 * Module and category IDs are resolved once per instance.
 */
class ExtensionDataService
{
    private ?int $moduleId = null;

    /** @var list<array<string, mixed>>|null */
    private ?array $categories = null;

    public function __construct(
        private readonly ChurchToolsClient $client,
        private readonly string $extensionKey,
    ) {}

    private function resolveModuleId(): int
    {
        if ($this->moduleId !== null) {
            return $this->moduleId;
        }

        $id = $this->client->getModuleByKey($this->extensionKey)['id'] ?? null;
        if (!is_int($id)) {
            throw new ConfigurationException("ChurchTools returned no valid ID for the extension module '{$this->extensionKey}'.");
        }

        return $this->moduleId = $id;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function fetchCategories(): array
    {
        return $this->categories ??= $this->client->getCategories($this->resolveModuleId());
    }

    /**
     * @return array<string, mixed>
     */
    public function getCategoryByName(string $name): array
    {
        foreach ($this->fetchCategories() as $category) {
            if (($category['name'] ?? null) === $name) {
                return $category;
            }
        }
        throw new ConfigurationException("The extension's data category '$name' doesn't exist. Complete the extension's setup.");
    }

    /**
     * The raw values of a category (each with `id`, `dataCategoryId` and the JSON string `value`).
     *
     * @return array<mixed> all values, or with `$single` the first value (an empty array if there's none)
     */
    public function getCategoryData(string $name, bool $single = false): array
    {
        $values = $this->client->getValues($this->resolveModuleId(), $this->categoryId($name));

        if ($single) {
            return $values[0] ?? [];
        }

        return $values;
    }

    /**
     * @param array<string, mixed> $data
     */
    public function createCategoryEntry(string $name, array $data): int
    {
        return $this->client->createValue($this->resolveModuleId(), $this->categoryId($name), $this->encode($data));
    }

    /**
     * @param array<string, mixed> $data
     */
    public function updateCategoryEntry(string $name, int $valueId, array $data): int
    {
        $this->client->updateValue($this->resolveModuleId(), $this->categoryId($name), $valueId, $this->encode($data));

        return $valueId;
    }

    public function deleteCategoryEntry(string $name, int $valueId): void
    {
        $this->client->deleteValue($this->resolveModuleId(), $this->categoryId($name), $valueId);
    }

    private function categoryId(string $name): int
    {
        $id = $this->getCategoryByName($name)['id'] ?? null;
        if (!is_int($id)) {
            throw new ConfigurationException("The extension's data category '$name' has no valid ID.");
        }

        return $id;
    }

    /**
     * @param array<string, mixed> $data
     */
    private function encode(array $data): string
    {
        return json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
    }
}
