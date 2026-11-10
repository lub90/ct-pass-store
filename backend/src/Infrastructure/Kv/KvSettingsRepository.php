<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Kv;

use CtPassStore\Application\Exception\ConfigurationException;
use CtPassStore\Application\Port\SettingsRepository;
use CtPassStore\Domain\Settings;
use CtPassStore\Infrastructure\Crypto\RsaPublicKey;
use CtPassStore\Infrastructure\Store\SignedFileCache;
use Psr\Log\LoggerInterface;

/**
 * The extension's settings and public key from the KV store, validated when loaded and then kept for the request
 * (spec 3.2, 5.4).
 *
 * Across requests, the decoded JSON of both values is cached for SETTINGS_TTL seconds (spec 6.1): the raw object,
 * before SettingsParser, so validation and its findings run on every request exactly as without the cache. Only a
 * value that passed the structural check (exactly one value, a JSON object) is cached.
 *
 * Loading only; the rules are in SettingsParser.
 */
final class KvSettingsRepository implements SettingsRepository
{
    /** Admin changes apply within this many seconds (spec 6.1). */
    public const SETTINGS_TTL = 60;

    private const CACHE_SETTINGS = 'settings';

    private const CACHE_PUBLIC_KEY = 'publicKey';

    private ?Settings $settings = null;

    private ?RsaPublicKey $publicKey = null;

    /** @var list<string> */
    private array $findings = [];

    public function __construct(
        private readonly ExtensionData $extension,
        private readonly LoggerInterface $logger,
        private readonly ?SignedFileCache $cache = null,
    ) {}

    public function settings(): Settings
    {
        if ($this->settings !== null) {
            return $this->settings;
        }

        $raw = $this->cachedValue(self::CACHE_SETTINGS, KvSchema::SETTINGS_CATEGORY, 'The extension settings', 'Save the settings in the extension.');

        $parsed = SettingsParser::parse($raw);
        // A disabled client only sees 401 invalid-token, like an unknown one; the log tells the admin why.
        foreach ($parsed->findings as $finding) {
            $this->logger->warning($finding);
        }
        $this->findings = $parsed->findings;

        return $this->settings = $parsed->settings;
    }

    /**
     * What was ignored or disabled when the settings were parsed, for `/test` (plan 4.2).
     *
     * @return list<string>
     *
     * @throws ConfigurationException if the settings themselves are invalid
     */
    public function findings(): array
    {
        $this->settings();

        return $this->findings;
    }

    /**
     * @throws ConfigurationException if the key is missing or not an RSA public key of at least 4096 bits
     */
    public function publicKey(): RsaPublicKey
    {
        if ($this->publicKey !== null) {
            return $this->publicKey;
        }

        $raw = $this->cachedValue(self::CACHE_PUBLIC_KEY, KvSchema::ENCRYPTION_CATEGORY, 'The encryption settings', 'Run the encryption step of the extension setup.');
        $pem = $raw[KvSchema::PUBLIC_KEY] ?? null;
        if (!is_string($pem) || $pem === '') {
            throw new ConfigurationException('The encryption settings have no publicKey. Run the encryption step of the extension setup.');
        }

        return $this->publicKey = RsaPublicKey::fromPem($pem);
    }

    /**
     * The decoded JSON object of the only value in a category, from the cache if it holds a valid entry.
     *
     * @return array<string, mixed>
     */
    private function cachedValue(string $cacheName, string $category, string $what, string $fix): array
    {
        $cached = $this->cache?->get($cacheName);
        if ($cached !== null) {
            return $cached;
        }

        $raw = $this->singleValue($category, $what, $fix);
        $this->cache?->put($cacheName, $raw, self::SETTINGS_TTL);

        return $raw;
    }

    /**
     * The decoded JSON object of the only value in a category.
     *
     * @return array<string, mixed>
     */
    private function singleValue(string $category, string $what, string $fix): array
    {
        $values = $this->extension->values($category);
        if (count($values) !== 1) {
            throw new ConfigurationException(sprintf('%s must be exactly one value in the category %s, but there are %d. %s', $what, $category, count($values), $fix));
        }

        $value = $values[0]['value'] ?? null;
        $decoded = is_string($value) ? json_decode($value, true) : null;
        if (!is_array($decoded) || ($decoded !== [] && array_is_list($decoded))) {
            throw new ConfigurationException("$what aren't a valid JSON object. $fix");
        }

        return $decoded;
    }
}
