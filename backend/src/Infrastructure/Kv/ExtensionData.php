<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Kv;

use CtPassStore\Config\ConfigurationException;
use CtPassStore\Infrastructure\ChurchTools\ChurchToolsClient;

/**
 * The values of the extension's KV categories, as the service user. Categories are addressed by name.
 *
 * Module and category IDs are resolved once per instance.
 */
final class ExtensionData
{
    private ?int $moduleId = null;

    /** @var list<array<string, mixed>>|null */
    private ?array $categories = null;

    public function __construct(
        private readonly ChurchToolsClient $client,
        private readonly string $extensionKey = KvSchema::EXTENSION_KEY,
    ) {}

    /**
     * The raw values of a category, each with `id`, `dataCategoryId` and the JSON string `value`.
     *
     * @return list<array<string, mixed>>
     */
    public function values(string $category): array
    {
        return $this->client->getValues($this->moduleId(), $this->categoryId($category));
    }

    /**
     * Creates a value from an encoded JSON string and returns its ID.
     */
    public function create(string $category, string $json): int
    {
        return $this->client->createValue($this->moduleId(), $this->categoryId($category), $json);
    }

    /**
     * Replaces a value with an encoded JSON string.
     */
    public function update(string $category, int $valueId, string $json): void
    {
        $this->client->updateValue($this->moduleId(), $this->categoryId($category), $valueId, $json);
    }

    public function delete(string $category, int $valueId): void
    {
        $this->client->deleteValue($this->moduleId(), $this->categoryId($category), $valueId);
    }

    private function moduleId(): int
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

    private function categoryId(string $name): int
    {
        $this->categories ??= $this->client->getCategories($this->moduleId());
        foreach ($this->categories as $category) {
            if (($category['name'] ?? null) === $name) {
                $id = $category['id'] ?? null;
                if (!is_int($id)) {
                    throw new ConfigurationException("The extension's data category '$name' has no valid ID.");
                }

                return $id;
            }
        }
        throw new ConfigurationException("The extension's data category '$name' doesn't exist. Complete the extension's setup.");
    }
}
