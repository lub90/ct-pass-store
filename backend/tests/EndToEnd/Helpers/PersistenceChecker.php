<?php

declare(strict_types=1);

namespace CtPassStore\Tests\EndToEnd\Helpers;

use CtPassStore\Config\AppConfig;
use CtPassStore\Service\ExtensionDataService;
use CtPassStore\Tests\Helpers\Helpers;
use PHPUnit\Framework\Assert;

class PersistenceChecker
{
    private ExtensionDataService $extensionDataService;
    private string $category;
    private array $status = [];

    public function __construct(string $category)
    {
        $ctConfig = Helpers::getConfiguration();

        $this->category = $category;

        // Extension name comes from AppConfig
        $this->extensionDataService = new ExtensionDataService($ctConfig, AppConfig::CT_EXTENSION_ID);
    }

    /**
     * Save the current state of the category.
     */
    public function saveStatus(): void
    {
        $this->status = $this->extensionDataService->getCategoryData($this->category, false);
    }

    /**
     * Assert that the category data has not changed since saveStatus().
     */
    public function assertUnchanged(): void
    {
        $current = $this->extensionDataService->getCategoryData($this->category, false);
        Assert::assertSame(
            $this->status,
            $current,
            "Expected category '{$this->category}' to remain unchanged, but it has changed."
        );
    }

    /**
     * Assert that the category data has changed since saveStatus().
     */
    public function assertChanged(): void
    {
        $current = $this->extensionDataService->getCategoryData($this->category, false);
        Assert::assertNotSame(
            $this->status,
            $current,
            "Expected category '{$this->category}' to change, but it remained unchanged."
        );
    }
}
