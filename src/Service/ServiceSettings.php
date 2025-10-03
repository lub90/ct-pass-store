<?php

declare(strict_types=1);

namespace CtPassStore\Service;

class ServiceSettings
{
    private string $apiUrl;
    private string $token;

    public function __construct(string $apiUrl, string $token)
    {
        if (empty($apiUrl)) {
            throw new RuntimeException('Churchtools API URL must be set.');
        }
        if (empty($token)) {
            throw new RuntimeException('Churchtools API token must be set.');
        }
        $this->apiUrl = rtrim($apiUrl, '/');
        $this->token = $token;
    }

    /**
     * Gibt zurück, ob ein Passwort erforderlich ist, um ein Passwort zu ändern.
     */
    public function requirePasswordForPasswordChange(): bool
    {
        // TODO: ChurchTools-API-Abfrage
        return true; // Dummy-Wert
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
}
