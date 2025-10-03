<?php

declare(strict_types=1);

namespace CtPassStore\Service;

use RuntimeException;

/**
 * Handles ChurchTools token validation via Authorization header.
 */
class ChurchtoolsAuth
{

    private string $apiUrl;

    public function __construct(string $apiUrl) {
        if (empty($apiUrl)) {
            throw new RuntimeException('Churchtools API URL must be set.');
        }
        $this->apiUrl = rtrim($apiUrl, '/');
    }

    /**
     * Validates a ChurchTools token and returns user info.
     *
     * @param string $token The ChurchTools API token.
     * @return array|null Returns user data if valid, null otherwise.
     */
    public function validateToken(string $token): ?array
    {
        $url = $this->apiUrl . '/whoami';

        $curl = curl_init($url);
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => [
                'Authorization: Login ' . $token,
                'Accept: application/json',
            ],
            CURLOPT_TIMEOUT => 5, // 5 second timeout
        ]);

        $response = curl_exec($curl);
        $httpCode = curl_getinfo($curl, CURLINFO_HTTP_CODE);
        curl_close($curl);

        if ($httpCode !== 200 || !$response) {
            return null;
        }

        $json = json_decode($response, true);
        if (!is_array($json)) {
            return null;
        }
        $person = $json['data'] ?? null;

        if (!is_array($person) || ($person['id'] ?? -1) < 0) {
            return null;
        }

        return $person;
    }
}
