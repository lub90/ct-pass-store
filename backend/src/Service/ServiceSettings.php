<?php

declare(strict_types=1);

namespace CtPassStore\Service;

use CtPassStore\Config\AppConfig;
use RuntimeException;

class ServiceSettings extends ChurchToolsBaseService
{
    private ?array $settings = null;

    private function loadSettings(): array
    {
        if ($this->settings !== null) {
            return $this->settings;
        }

        $extension = new ExtensionDataService($this, AppConfig::CT_EXTENSION_ID);
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

    public function requirePasswordForPasswordChange(): bool
    {
        return (bool) ($this->loadSettings()['requirePasswordForPasswordChange'] ?? false);
    }

    public function allowCustomPasswords(): bool
    {
        return (bool) ($this->loadSettings()['allowCustomPassword'] ?? false);
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
        return (int) ($this->loadSettings()['passwordLength'] ?? 16);
    }

    // TODO: Implement correctly...
    public function publicKey(): string
    {
        // unchanged
        return "-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzqOI1fvf3TIIxd1MJboo
nwUcGzcN8BDEkYu+Bd1DlchiAi0d0is7bDjTEgBxEgSayj7Oja5gbpuExNmlQHV2
Kf8o9RwPxzmPU85LDNhKySODsmANuVxXPwUEPBQW3QPlVmIcffli15sJ9GafqsOZ
sVkOcVHIqqf0IVOZI3Lv1m8lL2LjgWNxUyDfBDS+3vMPubG9cNRC6WvmbiWpaVio
VMmTOdeVPIwFeKLput185+IDGsBjpNxqJ80Tbg5b3X9WzqzDppSmNs+i9L5tdBLV
aAxGVMwq7rb+jwogVVXOcOhmvlazbThyzBmUwpxj7fHmMd2i6Y2ClsOPRzm5fnnt
SQIDAQAB
-----END PUBLIC KEY-----";
    }
}
