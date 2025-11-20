<?php

declare(strict_types=1);

namespace CtPassStore\Service;

use CtPassStore\Config\AppConfig;
use CtPassStore\Service\ExtensionDataService;

class ChurchToolsStore extends ChurchToolsBaseService
{
    public function getPwd(int $personId): ?string
    {
        $extension = new ExtensionDataService($this->churchtoolsConfig, AppConfig::CT_EXTENSION_ID);

        $responseBody = $extension->getCategoryData(AppConfig::CT_PWD_CATEGORY_NAME);

        $existingValues = [];
        foreach ($responseBody as $entry) {
            $existingValues[] = json_decode($entry['value'], true);
        }

        $matching = array_filter($existingValues, fn($v) => $v[AppConfig::CT_PERSON_ID_PWD_FIELD] == $personId);

        if (count($matching) !== 1) {
            return null;
        }

        return array_values($matching)[0][AppConfig::CT_ENCRYPTED_PWD_FIELD];
    }


    public function putPwd(int $personId, string $encryptedPassword): void
    {
        $extension = new ExtensionDataService($this->churchtoolsConfig, AppConfig::CT_EXTENSION_ID);

        $existingValueEntries = $extension->getCategoryData(AppConfig::CT_PWD_CATEGORY_NAME);
        $existing = [];
        foreach($existingValueEntries as $existingEntry) {
            $encodedValues = json_decode($existingEntry['value'], true);
            if (($encodedValues[AppConfig::CT_PERSON_ID_PWD_FIELD] ?? null) === $personId) {
                $existing[] = [
                    "id" => $existingEntry["id"],
                    "value" => $encodedValues,
                ];
            }
        }

        $data = [
            AppConfig::CT_PERSON_ID_PWD_FIELD => $personId,
            AppConfig::CT_ENCRYPTED_PWD_FIELD => $encryptedPassword,
        ];
        
        if (count($existing) === 1) {
            $valueId = $existing[array_key_first($existing)]['id'];
            $extension->updateCategoryEntry(AppConfig::CT_PWD_CATEGORY_NAME, $valueId, $data);
            $this->logger->info("Updated password entry $valueId for person $personId");
        } elseif (count($existing) === 0) {
            $newId = $extension->createCategoryEntry(AppConfig::CT_PWD_CATEGORY_NAME, $data + [AppConfig::CT_PERSON_ID_PWD_FIELD => (string)$personId]);
            $this->logger->info("Created new password entry $newId for person $personId");
        } else {
            throw new \RuntimeException("Multiple password entries found for person $personId");
        }

    }

    public function deletePwd(int $personId): void
    {
        $extension = new ExtensionDataService($this->churchtoolsConfig, AppConfig::CT_EXTENSION_ID);

        $existingValueEntries = $extension->getCategoryData(AppConfig::CT_PWD_CATEGORY_NAME);
        $existing = [];
        foreach($existingValueEntries as $existingEntry) {
            $encodedValues = json_decode($existingEntry['value'], true);
            if (($encodedValues[AppConfig::CT_PERSON_ID_PWD_FIELD] ?? null) === $personId) {
                $existing[] = [
                    "id" => $existingEntry["id"],
                    "value" => $encodedValues,
                ];
            }
        }

        if (count($existing) === 0) {
            $this->logger->info("No password entry found for person $personId — nothing to delete.");
            return;
        }

        foreach ($existing as $entry) {
            $valueId = $entry['id'];
            $extension->deleteCategoryEntry(AppConfig::CT_PWD_CATEGORY_NAME, $valueId);
            $this->logger->info("Deleted password entry $valueId for person $personId");
        }
    }
}
