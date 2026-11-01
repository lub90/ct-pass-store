<?php

declare(strict_types=1);

namespace CtPassStore\Config;

/**
 * The local configuration from `config/credentials.php` (spec 3.1).
 *
 * The full validation of every key and format follows in plan item 2.2.
 */
final class BackendConfig
{
    /**
     * @param list<string> $corsOrigins
     */
    public function __construct(
        public readonly string $apiUrl,
        #[\SensitiveParameter]
        public readonly string $apiToken,
        public readonly array $corsOrigins,
        public readonly string $credentialsPath,
    ) {}

    /**
     * @param array<string, mixed> $credentials the array returned by `credentials.php`
     */
    public static function fromArray(array $credentials, string $credentialsPath): self
    {
        $apiUrl = $credentials['CT_API_URL'] ?? null;
        $apiToken = $credentials['CT_API_TOKEN'] ?? null;
        $cors = $credentials['CORS'] ?? null;

        if (!is_string($apiUrl) || $apiUrl === '') {
            throw new \InvalidArgumentException('CT_API_URL is missing in credentials.php.');
        }
        if (!is_string($apiToken) || $apiToken === '') {
            throw new \InvalidArgumentException('CT_API_TOKEN is missing in credentials.php.');
        }
        if (!is_array($cors) || !array_is_list($cors) || array_filter($cors, 'is_string') !== $cors) {
            throw new \InvalidArgumentException('CORS must be a list of origins in credentials.php.');
        }

        return new self($apiUrl, $apiToken, $cors, $credentialsPath);
    }
}
