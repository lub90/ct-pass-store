<?php

declare(strict_types=1);

namespace CtPassStore\Service;

use CtPassStore\Config\AppConfig;
use RuntimeException;

class ServiceSettings extends ChurchToolsBaseService
{
    private ?array $settings = null;
    private ?array $encryptionSettings = null;

    // TODO: Move all field names to the app config
    private function loadSettings(): array
    {
        if ($this->settings !== null) {
            return $this->settings;
        }

        $extension = new ExtensionDataService($this->churchtoolsConfig, AppConfig::CT_EXTENSION_ID);
        $entries = $extension->getCategoryData(AppConfig::CT_SETTINGS_CATEGORY_NAME, true);

        if (!is_array($entries) || !isset($entries['value'])) {
            throw new RuntimeException('Settings entry is missing or malformed.');
        }

        $decoded = json_decode($entries['value'], true);
        if (!is_array($decoded)) {
            throw new RuntimeException('Failed to decode settings JSON.');
        }

        $this->settings = $decoded;
        return $this->settings;
    }

    private function loadEncryptionSettings(): array
    {
        if ($this->encryptionSettings !== null) {
            return $this->encryptionSettings;
        }

        $extension = new ExtensionDataService($this->churchtoolsConfig, AppConfig::CT_EXTENSION_ID);
        $entries = $extension->getCategoryData(AppConfig::CT_ENCRYPTION_SETTINGS_CATEGORY_NAME, true);

        if (!is_array($entries) || !isset($entries['value'])) {
            throw new RuntimeException('Settings entry is missing or malformed.');
        }

        $decoded = json_decode($entries['value'], true);
        if (!is_array($decoded)) {
            throw new RuntimeException('Failed to decode encryption settings JSON.');
        }

        $this->encryptionSettings = $decoded;
        return $this->encryptionSettings;
    }

    public function requirePasswordForPasswordChange(): bool
    {
        return (bool) ($this->loadSettings()['requirePasswordForPasswordChange']);
    }

    public function allowCustomPasswords(): bool
    {
        return (bool) ($this->loadSettings()[AppConfig::CT_ALLOW_CUSTOM_PASSWORD_FIELD_NAME]);
    }

    /**
     * @return int[]
     */
    public function adminUsers(): array
    {
        $value = $this->loadSettings()['adminUsers'] ?? [];
        return is_array($value) ? array_map('intval', $value) : [];
    }

    /**
     * @return int[]
     */
    public function readAccessUsers(): array
    {
        $value = $this->loadSettings()['readAccessUsers'] ?? [];
        return is_array($value) ? array_map('intval', $value) : [];
    }

    public function pwdLength(): int
    {
        return (int) ($this->loadSettings()['passwordLength']);
    }

    public function publicKey(): string
    {
        return $this->loadEncryptionSettings()[AppConfig::CT_PUBLIC_KEY_FIELD_NAME];
    }
}
