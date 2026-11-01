<?php

declare(strict_types=1);

namespace CtPassStore\Config;

/**
 * The local configuration from `config/credentials.php`, validated (spec 3.1).
 *
 * Error messages name the key and what's wrong with it, never its value.
 */
final class BackendConfig
{
    public const LOG_LEVELS = ['debug', 'info', 'notice', 'warning', 'error'];
    public const MIN_JWT_SECRET_BYTES = 32;

    /**
     * @param list<string> $corsOrigins
     */
    public function __construct(
        public readonly string $apiUrl,
        #[\SensitiveParameter]
        public readonly string $apiToken,
        public readonly array $corsOrigins,
        public readonly string $credentialsPath,
        public readonly string $cacheDir,
        public readonly string $oauthClientId,
        #[\SensitiveParameter]
        public readonly string $oauthClientSecret,
        #[\SensitiveParameter]
        public readonly string $jwtSecret,
        public readonly string $logLevel = 'info',
    ) {}

    /**
     * The ChurchTools instance as `https://host[:port]`, taken from CT_API_URL. Login redirect URIs must point there.
     */
    public function instanceOrigin(): string
    {
        $parts = parse_url($this->apiUrl);
        $host = strtolower((string) ($parts['host'] ?? ''));
        $port = $parts['port'] ?? 443;

        return 'https://' . $host . ($port === 443 ? '' : ':' . $port);
    }

    /**
     * @param mixed $credentials the value returned by `credentials.php`
     * @param string $cacheDir the folder for the backend's caches and security stores (spec 6.1), outside the web root
     *
     * @throws ConfigurationException naming the first problem found
     */
    public static function fromArray(mixed $credentials, string $credentialsPath, string $cacheDir): self
    {
        if (!is_array($credentials)) {
            throw new ConfigurationException('credentials.php must return an array.');
        }

        return new self(
            self::apiUrl($credentials['CT_API_URL'] ?? null),
            self::token($credentials['CT_API_TOKEN'] ?? null, 'CT_API_TOKEN'),
            self::corsOrigins($credentials['CORS'] ?? null),
            $credentialsPath,
            $cacheDir,
            self::token($credentials['OAUTH_CLIENT_ID'] ?? null, 'OAUTH_CLIENT_ID'),
            self::token($credentials['OAUTH_CLIENT_SECRET'] ?? null, 'OAUTH_CLIENT_SECRET'),
            self::jwtSecret($credentials['JWT_SECRET'] ?? null),
            self::logLevel($credentials['LOG_LEVEL'] ?? null),
        );
    }

    private static function apiUrl(mixed $value): string
    {
        if (!is_string($value) || $value === '') {
            throw new ConfigurationException('CT_API_URL is missing in credentials.php.');
        }
        $parts = parse_url($value);
        if (
            $parts === false
            || ($parts['scheme'] ?? null) !== 'https'
            || ($parts['host'] ?? '') === ''
            || isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) || isset($parts['fragment'])
        ) {
            throw new ConfigurationException('CT_API_URL in credentials.php must be an https:// URL without credentials, query or fragment, e.g. https://example.church.tools/api.');
        }

        return $value;
    }

    private static function token(mixed $value, string $key): string
    {
        if (!is_string($value) || $value === '') {
            throw new ConfigurationException("$key is missing in credentials.php.");
        }
        if (preg_match('/\s/', $value) === 1) {
            throw new ConfigurationException("$key in credentials.php must not contain whitespace.");
        }

        return $value;
    }

    private static function jwtSecret(mixed $value): string
    {
        $secret = self::token($value, 'JWT_SECRET');
        if (strlen($secret) < self::MIN_JWT_SECRET_BYTES) {
            throw new ConfigurationException('JWT_SECRET in credentials.php must have at least ' . self::MIN_JWT_SECRET_BYTES . ' bytes.');
        }

        return $secret;
    }

    /**
     * @return list<string>
     */
    private static function corsOrigins(mixed $value): array
    {
        if (!is_array($value) || !array_is_list($value) || $value === []) {
            throw new ConfigurationException('CORS in credentials.php must be a non-empty list of origins, e.g. [\'https://example.church.tools\'].');
        }
        foreach ($value as $index => $origin) {
            if (!is_string($origin) || preg_match('#^https?://[a-z0-9.-]+(:[0-9]{1,5})?\z#i', $origin) !== 1) {
                throw new ConfigurationException("CORS entry $index in credentials.php isn't an origin. An origin is scheme, host and optional port, without path or wildcard, e.g. https://example.church.tools.");
            }
        }

        return $value;
    }

    private static function logLevel(mixed $value): string
    {
        if ($value === null) {
            return 'info';
        }
        if (!is_string($value) || !in_array($value, self::LOG_LEVELS, true)) {
            throw new ConfigurationException('LOG_LEVEL in credentials.php must be one of ' . implode(', ', self::LOG_LEVELS) . '.');
        }

        return $value;
    }
}
