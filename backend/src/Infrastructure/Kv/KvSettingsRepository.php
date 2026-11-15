<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Kv;

use CtPassStore\Application\Exception\ConfigurationException;
use CtPassStore\Application\Port\Clock;
use CtPassStore\Application\Port\SettingsRepository;
use CtPassStore\Domain\Settings;
use CtPassStore\Infrastructure\ChurchTools\Exception\NotFoundException;
use CtPassStore\Infrastructure\ChurchTools\Exception\RateLimitedException;
use CtPassStore\Infrastructure\ChurchTools\Exception\ServiceCredentialRejectedException;
use CtPassStore\Infrastructure\ChurchTools\Exception\UnavailableException;
use CtPassStore\Infrastructure\Crypto\RsaPublicKey;
use CtPassStore\Infrastructure\Store\SignedFileCache;
use CtPassStore\Infrastructure\Time\SystemClock;
use Psr\Log\LoggerInterface;

/**
 * The extension's settings and public key from the KV store, validated when loaded and then kept for the request
 * (spec 3.2, 5.4).
 *
 * Across requests, the decoded JSON of both values is cached for SETTINGS_TTL seconds (spec 6.1): the raw object,
 * before SettingsParser, so validation and its findings run on every request exactly as without the cache. Only a
 * value that passed the structural check (exactly one value, a JSON object) is cached.
 *
 * A failed load because ChurchTools is unavailable or rate limiting is remembered briefly (its Retry-After for 429, at
 * least FAILURE_MIN_SECONDS; otherwise FAILURE_MIN_SECONDS), so forged tokens can't make every request ask ChurchTools
 * again during an outage (spec 6.2). Other failures (misconfigured, invalid) aren't remembered.
 *
 * Loading only; the rules are in SettingsParser.
 */
final class KvSettingsRepository implements SettingsRepository
{
    /** Admin changes apply within this many seconds (spec 6.1). */
    public const SETTINGS_TTL = 300;

    /** How long an outage of ChurchTools is remembered at least (spec 6.2). */
    public const FAILURE_MIN_SECONDS = 10;

    private const CACHE_SETTINGS = 'settings';

    private const CACHE_ACCESS = 'access';

    /** The remembered outcome of a missing or unusable access value (the finding), so it isn't asked for on every request. */
    private const CACHE_ACCESS_MISSING = 'access-missing';

    private const CACHE_PUBLIC_KEY = 'publicKey';

    private ?Settings $settings = null;

    private ?RsaPublicKey $publicKey = null;

    /** @var list<string> */
    private array $findings = [];

    /** Whether access is missing or unreadable: access() logs that finding itself, once when it's remembered. */
    private bool $accessUnusable = false;

    /**
     * Whether settings or access were read from ChurchTools (or access found missing) since the change log last
     * looked, rather than coming from the cache. The public key doesn't count.
     */
    private bool $loadedFresh = false;

    public function __construct(
        private readonly ExtensionData $extension,
        private readonly LoggerInterface $logger,
        private readonly ?SignedFileCache $cache = null,
        private readonly Clock $clock = new SystemClock(),
        private readonly ?SettingsChangeLog $changeLog = null,
    ) {}

    public function settings(): Settings
    {
        if ($this->settings !== null) {
            return $this->settings;
        }

        $raw = $this->cachedValue(self::CACHE_SETTINGS, KvSchema::SETTINGS_CATEGORY, 'The extension settings', 'Save the settings in the extension.');

        $parsed = SettingsParser::parse($raw);
        $access = $this->access();
        $findings = [...$parsed->findings, ...$access->findings];
        // A disabled client only sees 401 invalid-token, like an unknown one; the log tells the admin why. A missing or
        // unreadable access is logged once per TTL, when it's remembered, not on every request.
        foreach ($this->accessUnusable ? $parsed->findings : $findings as $finding) {
            $this->logger->warning($finding);
        }
        $this->findings = $findings;
        $settings = $parsed->settings->withAccess($access->adminGroupId, $access->machineClients);
        // Compared only when something came from ChurchTools (about once per TTL), not on every request (spec 6.4).
        if ($this->loadedFresh) {
            $this->loadedFresh = false;
            $this->changeLog?->observe($settings);
        }

        return $this->settings = $settings;
    }

    /**
     * The admin group and machine clients. A missing or unusable access category or value is a finding, never an
     * exception: nobody is an admin and no machine client is enabled, but users can log in. That outcome is cached
     * like a valid value, so the normal state before the setup isn't asked for on every request. So is a service user
     * that may not read the category (rejected, or 404 on its values): a partial rights grant never makes the backend
     * unusable for users. A failing
     * ChurchTools (unavailable, rate limiting) still throws, with the same failure memory as for the settings.
     */
    private function access(): ParsedAccess
    {
        $missing = $this->cache?->get(self::CACHE_ACCESS_MISSING);
        if ($missing !== null && is_string($missing['finding'] ?? null)) {
            $this->accessUnusable = true;

            return new ParsedAccess(null, [], [$missing['finding']]);
        }

        try {
            return AccessParser::parseJson($this->cachedJson(self::CACHE_ACCESS, KvSchema::ACCESS_CATEGORY, 'The access settings', 'Run the extension setup.'));
        } catch (ConfigurationException $e) {
            return $this->rememberNoAccess($e->getMessage() . ' Nobody is an admin and no machine client is enabled.');
        } catch (ServiceCredentialRejectedException|NotFoundException) {
            return $this->rememberNoAccess("The service user can't read the category access; grant it view custom category and view custom data on access. Nobody is an admin and no machine client is enabled.");
        }
    }

    private function rememberNoAccess(string $finding): ParsedAccess
    {
        $this->cache?->put(self::CACHE_ACCESS_MISSING, ['finding' => $finding], self::SETTINGS_TTL);
        $this->loadedFresh = true;
        $this->logger->warning($finding);
        $this->accessUnusable = true;

        return new ParsedAccess(null, [], [$finding]);
    }

    /**
     * Forgets everything this repository remembers, in memory and in the cache (settings, access, public key and remembered
     * upstream failures), so the next call asks ChurchTools. For the self-check, so a fix shows at once (spec 4.8).
     */
    public function refresh(): void
    {
        $this->settings = null;
        $this->findings = [];
        $this->accessUnusable = false;
        $this->forget(self::CACHE_SETTINGS);
        $this->forget(self::CACHE_ACCESS);
        $this->cache?->forget(self::CACHE_ACCESS_MISSING);
        $this->refreshPublicKey();
    }

    /**
     * Like refresh(), for the public key only; the settings stay as they are.
     */
    public function refreshPublicKey(): void
    {
        $this->publicKey = null;
        $this->forget(self::CACHE_PUBLIC_KEY);
    }

    private function forget(string $cacheName): void
    {
        $this->cache?->forget($cacheName);
        $this->cache?->forget($cacheName . '-failure');
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

        /** @var array<string, mixed> $decoded */
        $decoded = json_decode($this->loadValue($cacheName, $category, $what, $fix), true);
        $this->cache?->put($cacheName, $decoded, self::SETTINGS_TTL);

        return $decoded;
    }

    /**
     * The JSON text of the only value in a category (a JSON object), from the cache if it holds a valid entry. The
     * text is cached as it is, so the difference between objects and lists survives (`{"0": …}` is no list).
     */
    private function cachedJson(string $cacheName, string $category, string $what, string $fix): string
    {
        $cached = $this->cache?->get($cacheName);
        if ($cached !== null && is_string($cached['json'] ?? null) && json_decode($cached['json'], false) instanceof \stdClass) {
            return $cached['json'];
        }

        $json = $this->loadValue($cacheName, $category, $what, $fix);
        $this->cache?->put($cacheName, ['json' => $json], self::SETTINGS_TTL);

        return $json;
    }

    /**
     * Reads the value from ChurchTools, with the failure memory for outages and rate limits.
     */
    private function loadValue(string $cacheName, string $category, string $what, string $fix): string
    {
        $failureName = $cacheName . '-failure';
        $this->rethrowRememberedFailure($failureName);

        try {
            $json = $this->singleValue($category, $what, $fix);
        } catch (RateLimitedException $e) {
            $this->rememberFailure($failureName, 'rateLimited', max(self::FAILURE_MIN_SECONDS, $e->retryAfterSeconds()));
            throw $e;
        } catch (UnavailableException $e) {
            $this->rememberFailure($failureName, 'unavailable', self::FAILURE_MIN_SECONDS);
            throw $e;
        }
        $this->cache?->forget($failureName);
        if ($category !== KvSchema::ENCRYPTION_CATEGORY) {
            $this->loadedFresh = true;
        }

        return $json;
    }

    private function rememberFailure(string $name, string $kind, int $seconds): void
    {
        $this->cache?->put($name, ['kind' => $kind, 'until' => $this->clock->now()->getTimestamp() + $seconds], $seconds);
    }

    /**
     * @throws RateLimitedException|UnavailableException while a remembered failure is valid, without asking ChurchTools
     */
    private function rethrowRememberedFailure(string $name): void
    {
        $failure = $this->cache?->get($name);
        if ($failure === null) {
            return;
        }
        $remaining = max(1, (is_int($failure['until'] ?? null) ? $failure['until'] : 0) - $this->clock->now()->getTimestamp());
        $message = 'ChurchTools failed a moment ago and isn\'t asked again yet.';

        throw ($failure['kind'] ?? null) === 'rateLimited' ? new RateLimitedException($message, max(60, $remaining)) : new UnavailableException($message);
    }

    /**
     * The JSON text of the only value in a category, checked to be a JSON object.
     */
    private function singleValue(string $category, string $what, string $fix): string
    {
        $values = $this->extension->values($category);
        if (count($values) !== 1) {
            throw new ConfigurationException(sprintf('%s must be exactly one value in the category %s, but there are %d. %s', $what, $category, count($values), $fix));
        }

        $value = $values[0]['value'] ?? null;
        if (!is_string($value) || !(json_decode($value, false) instanceof \stdClass)) {
            throw new ConfigurationException("$what aren't a valid JSON object. $fix");
        }

        return $value;
    }
}
