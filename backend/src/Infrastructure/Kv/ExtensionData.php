<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Kv;

use CtPassStore\Application\Exception\ConfigurationException;
use CtPassStore\Application\Failure\Reason;
use CtPassStore\Infrastructure\ChurchTools\ChurchToolsClient;
use CtPassStore\Infrastructure\ChurchTools\Exception\NotFoundException;
use CtPassStore\Infrastructure\Store\SignedFileCache;

/**
 * The values of the extension's KV categories, as the service user. Categories are addressed by name.
 *
 * Module and category IDs are resolved once per instance, and cached across requests for IDS_TTL seconds (spec 6.1).
 * Cached IDs can be stale after a reinstall (spec 5.3.10): if ChurchTools answers 404 for them in values() or
 * create(), or a category is missing from them, they're discarded and resolved once more, and the call is retried
 * once. IDs resolved in this request are never resolved again, so a lasting 404 propagates (500 misconfigured) without
 * a loop. update() and delete() don't retry: there a 404 means the value is gone (spec 5.3.6).
 */
final class ExtensionData
{
    /** IDs only change on reinstall (spec 6.1). */
    public const IDS_TTL = 3600;

    private const CACHE_IDS = 'ids';

    private ?int $moduleId = null;

    /** @var list<array<string, mixed>>|null the categories as ChurchTools (or the cache) lists them */
    private ?array $categories = null;

    /** Whether the IDs in use came from the cache, so they may be stale. */
    private bool $idsFromCache = false;

    public function __construct(
        private readonly ChurchToolsClient $client,
        private readonly string $extensionKey = KvSchema::EXTENSION_KEY,
        private readonly ?SignedFileCache $cache = null,
    ) {}

    /**
     * The raw values of a category, each with `id`, `dataCategoryId` and the JSON string `value`.
     *
     * @return list<array<string, mixed>>
     */
    public function values(string $category): array
    {
        return $this->retryingStaleIds($category, fn(int $moduleId, int $categoryId): array => $this->client->getValues($moduleId, $categoryId));
    }

    /**
     * Creates a value from an encoded JSON string and returns its ID.
     */
    public function create(string $category, string $json): int
    {
        return $this->retryingStaleIds($category, fn(int $moduleId, int $categoryId): int => $this->client->createValue($moduleId, $categoryId, $json));
    }

    /**
     * Replaces a value with an encoded JSON string.
     */
    public function update(string $category, int $valueId, string $json): void
    {
        [$moduleId, $categoryId] = $this->ids($category);
        $this->client->updateValue($moduleId, $categoryId, $valueId, $json);
    }

    public function delete(string $category, int $valueId): void
    {
        [$moduleId, $categoryId] = $this->ids($category);
        $this->client->deleteValue($moduleId, $categoryId, $valueId);
    }

    /**
     * Calls ChurchTools with the category's IDs; if that's a 404 with cached IDs, resolves them from ChurchTools and
     * calls once more (spec 5.3.10).
     *
     * @template T
     * @param \Closure(int $moduleId, int $categoryId): T $call
     * @return T
     */
    private function retryingStaleIds(string $category, \Closure $call): mixed
    {
        try {
            return $call(...$this->ids($category));
        } catch (NotFoundException $e) {
            if (!$this->idsFromCache) {
                throw $e;
            }
            $this->resolveFromChurchTools();

            return $call(...$this->ids($category));
        }
    }

    /**
     * Module and category ID, in this order. The category is looked up first: that may resolve the IDs once more, and
     * the module ID must come from the same resolution.
     *
     * @return array{int, int}
     */
    private function ids(string $category): array
    {
        $categoryId = $this->categoryId($category);

        return [$this->moduleId ?? throw new \LogicException('Looking up a category sets the module ID.'), $categoryId];
    }

    private function categoryId(string $name): int
    {
        $category = $this->findCategory($name);
        if ($category === null && $this->idsFromCache) {
            // Created after the IDs were cached (e.g. the setup was completed later), or stale: resolve once more.
            $this->resolveFromChurchTools();
            $category = $this->findCategory($name);
        }
        if ($category === null) {
            throw new ConfigurationException("The extension's data category '$name' doesn't exist. Complete the extension's setup.", Reason::ExtensionNotInstalled);
        }

        $id = $category['id'] ?? null;
        if (!is_int($id)) {
            throw new ConfigurationException("The extension's data category '$name' has no valid ID.", Reason::ExtensionNotInstalled);
        }

        return $id;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function findCategory(string $name): ?array
    {
        if ($this->categories === null) {
            $this->load();
        }
        foreach ($this->categories ?? [] as $category) {
            if (($category['name'] ?? null) === $name) {
                return $category;
            }
        }

        return null;
    }

    /**
     * Takes the IDs from the cache, or else from ChurchTools.
     */
    private function load(): void
    {
        $cached = $this->cache?->get(self::CACHE_IDS);
        $moduleId = $cached['moduleId'] ?? null;
        $categories = $cached['categories'] ?? null;
        if (is_int($moduleId) && is_array($categories) && array_is_list($categories) && self::areCategories($categories)) {
            /** @var list<array{id: int, name: string}> $categories */
            $this->moduleId = $moduleId;
            $this->categories = $categories;
            $this->idsFromCache = true;

            return;
        }

        $this->resolveFromChurchTools();
    }

    /**
     * Resolves module and category IDs from ChurchTools and caches them. Forgets cached IDs first, so a failure here
     * doesn't leave stale ones behind.
     */
    private function resolveFromChurchTools(): void
    {
        $this->cache?->forget(self::CACHE_IDS);
        $this->moduleId = null;
        $this->categories = null;
        $this->idsFromCache = false;

        $id = $this->client->getModuleByKey($this->extensionKey)['id'] ?? null;
        if (!is_int($id)) {
            throw new ConfigurationException("ChurchTools returned no valid ID for the extension module '{$this->extensionKey}'.", Reason::ExtensionNotInstalled);
        }
        $categories = $this->client->getCategories($id);
        $this->moduleId = $id;
        $this->categories = $categories;

        // Only well-formed entries are cached; a category with an invalid ID is looked up again and reported then.
        $valid = array_values(array_filter($categories, static fn(array $c): bool => is_int($c['id'] ?? null) && is_string($c['name'] ?? null)));
        $this->cache?->put(self::CACHE_IDS, [
            'moduleId' => $id,
            'categories' => array_map(static fn(array $c): array => ['id' => $c['id'], 'name' => $c['name']], $valid),
        ], self::IDS_TTL);
    }

    /**
     * @param list<mixed> $categories
     */
    private static function areCategories(array $categories): bool
    {
        foreach ($categories as $category) {
            if (!is_array($category) || !is_int($category['id'] ?? null) || !is_string($category['name'] ?? null)) {
                return false;
            }
        }

        return true;
    }
}
