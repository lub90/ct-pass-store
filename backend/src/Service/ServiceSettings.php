<?php

declare(strict_types=1);

namespace CtPassStore\Service;

use CtPassStore\Config\AppConfig;
use CtPassStore\Exception\ConfigurationException;

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

        $extension = $this->extension;
        $entries = $extension->getCategoryData(AppConfig::CT_SETTINGS_CATEGORY_NAME, true);

        if (!is_array($entries) || !isset($entries['value'])) {
            throw new ConfigurationException('The extension settings are missing or malformed. Save the settings in the extension.');
        }

        $decoded = json_decode($entries['value'], true);
        if (!is_array($decoded)) {
            throw new ConfigurationException('The extension settings aren\'t valid JSON. Save the settings in the extension.');
        }

        $this->settings = $decoded;
        return $this->settings;
    }

    private function loadEncryptionSettings(): array
    {
        if ($this->encryptionSettings !== null) {
            return $this->encryptionSettings;
        }

        $extension = $this->extension;
        $entries = $extension->getCategoryData(AppConfig::CT_ENCRYPTION_SETTINGS_CATEGORY_NAME, true);

        if (!is_array($entries) || !isset($entries['value'])) {
            throw new ConfigurationException('The encryption settings are missing or malformed. Run the encryption step of the extension setup.');
        }

        $decoded = json_decode($entries['value'], true);
        if (!is_array($decoded)) {
            throw new ConfigurationException('The encryption settings aren\'t valid JSON. Run the encryption step of the extension setup.');
        }

        $this->encryptionSettings = $decoded;
        return $this->encryptionSettings;
    }

    public function requirePasswordForPasswordChange(): bool
    {
        return (bool) ($this->loadSettings()[AppConfig::CT_REQUIRE_PWD_FOR_PWD_CHANGE_FIELD_NAME]);
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
