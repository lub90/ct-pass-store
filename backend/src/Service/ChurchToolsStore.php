<?php

declare(strict_types=1);

namespace CtPassStore\Service;

use CtPassStore\Config\AppConfig;

class ChurchToolsStore extends ChurchToolsBaseService
{
    public function put(int $personId, string $encryptedPassword): void
    {
        $extension = new ExtensionDataService($this, AppConfig::CT_EXTENSION_ID);

        $data = [
            AppConfig::CT_PERSON_ID_FIELD => $personId,
            AppConfig::CT_ENCRYPTED_PWD_FIELD => $encryptedPassword,
        ];

        $existingValues = $extension->getCategoryData(AppConfig::CT_PWD_CATEGORY_NAME);
        $existing = array_filter($existingValues, fn($v) => ($v['personId'] ?? null) === (string)$personId);

        if (count($existing) === 1) {
            $valueId = $existing[array_key_first($existing)]['id'];
            $extension->updateCategoryEntry(AppConfig::CT_PWD_CATEGORY_NAME, $valueId, $data);
            $this->logger->info("Updated password entry $valueId for person $personId");
        } elseif (count($existing) === 0) {
            $newId = $extension->createCategoryEntry(AppConfig::CT_PWD_CATEGORY_NAME, $data + ['personId' => (string)$personId]);
            $this->logger->info("Created new password entry $newId for person $personId");
        } else {
            throw new RuntimeException("Multiple password entries found for person $personId");
        }

    }

    public function delete(int $personId): void
    {
        $extension = new DataExtensionService($this, AppConfig::CT_EXTENSION_ID);

        $existingValues = $extension->getCategoryData(AppConfig::CT_PWD_CATEGORY_NAME);
        $matching = array_filter($existingValues, fn($v) => ($v['personId'] ?? null) === (string)$personId);

        if (count($matching) === 0) {
            $this->logger->info("No password entry found for person $personId — nothing to delete.");
            return;
        }

        foreach ($matching as $entry) {
            $valueId = $entry['id'];
            $extension->deleteCategoryEntry(AppConfig::CT_PWD_CATEGORY_NAME, $valueId);
            $this->logger->info("Deleted password entry $valueId for person $personId");
        }
    }
}
