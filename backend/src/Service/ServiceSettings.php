<?php

declare(strict_types=1);

namespace CtPassStore\Service;

class ServiceSettings extends ChurchToolsBaseService
{

    /**
     * Gibt zurück, ob ein Passwort erforderlich ist, um ein Passwort zu ändern.
     */
    public function requirePasswordForPasswordChange(): bool
    {
        // TODO: ChurchTools-API-Abfrage
        return false; // Dummy-Wert
    }

    /**
     * Gibt zurück, ob Benutzer eigene Passwörter setzen dürfen.
     */
    public function allowCustomPasswords(): bool
    {
        // TODO: ChurchTools-API-Abfrage
        return false; // Dummy-Wert
    }

    /**
     * Gibt die Liste der Admin-User-IDs zurück.
     *
     * @return int[]
     */
    public function adminUsers(): array
    {
        // TODO: ChurchTools-API-Abfrage
        return [42, 101, 202]; // Dummy-Werte
    }

    /**
     * Gibt die Liste der User-IDs zurück, die ReadAccess haben
     *
     * @return int[]
     */
    public function readAccessUsers(): array
    {
        // TODO: ChurchTools-API-Abfrage
        return [42, 101, 202]; // Dummy-Werte
    }

    public function pwdLength(): int
    {
        return 16; // Dummy-Wert, später aus ChurchTools laden
    }

    public function publicKey(): string
    {
        // This is just a dummy key!
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
