<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Api;

use CtPassStore\Http\Problem\ProblemType;
use CtPassStore\Infrastructure\Kv\KvSchema;
use CtPassStore\Infrastructure\Store\RecordSigner;
use CtPassStore\Infrastructure\Store\SignedFileCache;
use Monolog\Logger;

/**
 * The settings and ID cache through the complete app (spec 6.1, catalog section 12, ST-18).
 */
final class CacheApiTest extends ApiTestCase
{
    private const PASSWORD = 'Custom-pass12!';

    private function cacheFile(string $name): string
    {
        return $this->cacheDir . '/cache-' . hash('sha256', $name) . '.json';
    }

    private function settingsReads(): int
    {
        return count(array_filter(
            $this->churchTools->calls(),
            fn(array $call): bool => $call['method'] === 'getValues' && $call['args'][1] === $this->categoryIds[KvSchema::SETTINGS_CATEGORY],
        ));
    }

    /**
     * CA-01 through the app: the second request loads neither settings nor IDs from ChurchTools.
     */
    public function testASecondRequestOnlyReadsThePasswordStore(): void
    {
        $this->seedEntry(self::USER);
        // An admin reading another person's entry needs the settings, the IDs and the password store.
        $this->request('GET', '/v1/entries/' . self::USER, self::ADMIN);
        $before = count($this->churchTools->calls());

        self::assertSame(200, $this->request('GET', '/v1/entries/' . self::USER, self::ADMIN)->getStatusCode());

        $calls = array_slice($this->churchTools->calls(), $before);
        self::assertSame(['getValues'], array_column($calls, 'method'));
        self::assertSame($this->categoryIds[KvSchema::PASSWORD_CATEGORY], $calls[0]['args'][1]);
    }

    /**
     * CA-02 through the app: after 60 s, changed settings apply without anyone clearing the cache.
     */
    public function testChangedSettingsApplyAfterTheTtl(): void
    {
        $this->assertProblem(ProblemType::Forbidden, $this->request('GET', '/v1/entries/' . self::OTHER, self::USER));
        // Changed in ChurchTools directly, so the cache isn't cleared.
        $category = $this->categoryIds[KvSchema::SETTINGS_CATEGORY];
        $raw = json_decode((string) $this->churchTools->storedValues($category)[0]['value'], true, 512, JSON_THROW_ON_ERROR);
        $this->churchTools->clearValues($category);
        $this->churchTools->seedValue($category, json_encode(['adminUsers' => [self::USER]] + $raw, JSON_THROW_ON_ERROR));
        $this->seedEntry(self::OTHER);

        $this->assertProblem(ProblemType::Forbidden, $this->request('GET', '/v1/entries/' . self::OTHER, self::USER));
        $this->clock->advance(61);
        self::assertSame(200, $this->request('GET', '/v1/entries/' . self::OTHER, self::USER)->getStatusCode());
        self::assertSame(2, $this->settingsReads());
    }

    /**
     * CA-03: `passwordStore` values are never cached; a read right after a write sees it.
     */
    public function testPasswordStoreIsNeverCached(): void
    {
        $this->seedEntry(self::USER, 'b2xk');
        $this->request('GET', '/v1/entries/' . self::USER, self::USER);

        self::assertSame(204, $this->request('PUT', '/v1/entries/' . self::USER, self::USER, ['secondaryPwd' => self::PASSWORD])->getStatusCode());
        $read = $this->request('GET', '/v1/entries/' . self::USER, self::USER);

        self::assertSame(200, $read->getStatusCode());
        self::assertSame(self::PASSWORD, $this->decrypt((string) $this->json($read)['secondaryPwd']));

        $this->churchTools->clearValues($this->categoryIds[KvSchema::PASSWORD_CATEGORY]);
        $this->assertProblem(ProblemType::EntryNotFound, $this->request('GET', '/v1/entries/' . self::USER, self::USER));
    }

    /**
     * Review Focus 2, CA-08: a settings entry planted by another webspace user, with the current key ID and a wrong
     * MAC, grants nothing; the settings come from ChurchTools and an error is logged.
     */
    public function testAPlantedSettingsCacheGrantsNothing(): void
    {
        $planted = new SignedFileCache($this->cacheDir, new RecordSigner(self::JWT_SECRET, SignedFileCache::PURPOSE), $this->clock, new Logger('planted'));
        $planted->put('settings', ['adminUsers' => [self::USER], 'passwordLength' => 12, KvSchema::SETTING_REQUIRE_PRIMARY_PASSWORD => false, KvSchema::SETTING_ALLOW_CUSTOM_PASSWORD => true], 60);
        $record = json_decode((string) file_get_contents($this->cacheFile('settings')), true, 512, JSON_THROW_ON_ERROR);
        $record['mac'] = hash('sha256', 'guessed');
        file_put_contents($this->cacheFile('settings'), json_encode($record, JSON_THROW_ON_ERROR));
        $this->seedEntry(self::OTHER);

        $this->assertProblem(ProblemType::Forbidden, $this->request('GET', '/v1/entries/' . self::OTHER, self::USER));

        $errors = array_values(array_filter($this->log->getRecords(), static fn($r): bool => $r['level_name'] === 'ERROR'));
        self::assertCount(1, $errors);
        self::assertStringContainsString('integrity check', $errors[0]['message']);
        self::assertSame(1, $this->settingsReads(), 'Reloaded from ChurchTools.');
    }

    /**
     * Review Focus 1: the test helper's setSettings() takes effect at once, even after a request filled the cache.
     */
    public function testChangedSettingsApplyAfterSetSettings(): void
    {
        self::assertSame(204, $this->request('PUT', '/v1/entries/' . self::USER, self::USER, ['secondaryPwd' => self::PASSWORD])->getStatusCode());

        $this->setSettings([KvSchema::SETTING_ALLOW_CUSTOM_PASSWORD => false]);

        $this->assertProblem(ProblemType::CustomPasswordNotAllowed, $this->request('PUT', '/v1/entries/' . self::USER, self::USER, ['secondaryPwd' => self::PASSWORD]));
    }

    /**
     * The same for the public key, which the test helper setPublicKey() replaces.
     */
    public function testAChangedPublicKeyAppliesAfterSetPublicKey(): void
    {
        self::assertSame(204, $this->request('PUT', '/v1/entries/' . self::USER, self::USER, ['secondaryPwd' => self::PASSWORD])->getStatusCode());

        $this->setPublicKey((string) file_get_contents(__DIR__ . '/../keys/invalid/rsa2048.pub.pem'));

        $this->assertProblem(ProblemType::Misconfigured, $this->request('PUT', '/v1/entries/' . self::USER, self::USER, ['secondaryPwd' => self::PASSWORD]));
    }

    /**
     * CA-04: the cache folder `public/index.php` passes is outside `public/`.
     */
    public function testCacheFolderIsOutsidePublic(): void
    {
        $public = __DIR__ . '/../../public';
        $index = (string) file_get_contents($public . '/index.php');
        self::assertSame(1, preg_match("~Kernel::bootstrap\\(\\s*__DIR__ \\. '[^']+',\\s*__DIR__ \\. '([^']+)',~", $index, $match), 'index.php passes the cache folder as __DIR__ . \'...\'.');

        $resolvedPublic = self::normalize((string) realpath($public));
        $resolvedCache = self::normalize($resolvedPublic . $match[1]);

        self::assertSame(self::normalize((string) realpath(__DIR__ . '/../..')) . '/cache', $resolvedCache);
        self::assertStringStartsNotWith($resolvedPublic . '/', $resolvedCache . '/');
    }

    /**
     * CA-04: the cache files hold neither the password, its ciphertext, tokens nor JWT_SECRET.
     */
    public function testCacheFilesHoldNoSecrets(): void
    {
        $token = $this->tokenOf(self::USER);
        $this->request('PUT', '/v1/entries/' . self::USER, null, ['secondaryPwd' => self::PASSWORD], ['Authorization' => 'Bearer ' . $token]);
        $ciphertext = (string) $this->json($this->request('GET', '/v1/entries/' . self::USER, self::USER))['secondaryPwd'];

        $files = glob($this->cacheDir . '/cache-*') ?: [];
        self::assertCount(3, $files, 'settings, publicKey and ids');
        foreach ($files as $file) {
            $content = (string) file_get_contents($file);
            foreach ([self::PASSWORD, $ciphertext, $token, self::JWT_SECRET, self::OAUTH_CLIENT_SECRET, 'service-token'] as $secret) {
                self::assertStringNotContainsString($secret, $content);
            }
        }
    }

    /**
     * CA-05: corrupt settings and ID cache files lead to loading from ChurchTools, not to an error response.
     */
    public function testCorruptCacheFilesAreLoadedFromChurchTools(): void
    {
        $this->request('GET', '/v1/entries/' . self::USER, self::ADMIN);
        $files = glob($this->cacheDir . '/cache-*') ?: [];
        self::assertCount(2, $files, 'settings and ids');
        foreach ($files as $file) {
            file_put_contents($file, '{"format": 1, "keyId"');
        }
        $this->seedEntry(self::USER);

        self::assertSame(200, $this->request('GET', '/v1/entries/' . self::USER, self::ADMIN)->getStatusCode());
        self::assertSame(2, $this->churchTools->countCalls(['getModuleByKey']));
        self::assertSame(2, $this->settingsReads());
    }

    /**
     * CA-05: a cache folder that can't be created costs ChurchTools calls, nothing else (the security stores aren't
     * needed for a plain read).
     */
    public function testAnUnusableCacheFolderStillAnswers(): void
    {
        $file = (string) tempnam(sys_get_temp_dir(), 'ctps-not-a-folder-');
        $this->cacheDir = $file . '/cache';
        try {
            $this->seedEntry(self::USER);
            foreach ([1, 2] as $request) {
                self::assertSame(200, $this->request('GET', '/v1/entries/' . self::USER, self::ADMIN)->getStatusCode());
            }
        } finally {
            @unlink($file);
        }
        self::assertSame(2, $this->settingsReads());
        self::assertTrue($this->log->hasWarningThatContains('could not be written'));
    }

    /**
     * ST-18 through the app: after a reinstall (new module and category IDs), the cached IDs are resolved once more
     * and the request succeeds.
     */
    public function testAReinstallIsPickedUpWithinTheSameRequest(): void
    {
        $this->request('GET', '/v1/entries/' . self::USER, self::USER);
        $settings = $this->churchTools->storedValues($this->categoryIds[KvSchema::SETTINGS_CATEGORY])[0]['value'];
        $encryption = $this->churchTools->storedValues($this->categoryIds[KvSchema::ENCRYPTION_CATEGORY])[0]['value'];
        $this->churchTools->removeModule(KvSchema::EXTENSION_KEY);
        $ids = $this->churchTools->addModule(KvSchema::EXTENSION_KEY, [KvSchema::SETTINGS_CATEGORY, KvSchema::ENCRYPTION_CATEGORY, KvSchema::PASSWORD_CATEGORY]);
        $this->churchTools->seedValue($ids[KvSchema::SETTINGS_CATEGORY], (string) $settings);
        $this->churchTools->seedValue($ids[KvSchema::ENCRYPTION_CATEGORY], (string) $encryption);
        $this->churchTools->seedValue($ids[KvSchema::PASSWORD_CATEGORY], json_encode([KvSchema::ENTRY_PERSON_ID => self::USER, KvSchema::ENTRY_CIPHERTEXT => 'bmV3'], JSON_THROW_ON_ERROR));
        $this->clock->advance(61);

        $response = $this->request('GET', '/v1/entries/' . self::USER, self::USER);

        self::assertSame(200, $response->getStatusCode(), (string) $response->getBody());
        self::assertSame('bmV3', $this->json($response)['secondaryPwd']);
        self::assertSame(2, $this->churchTools->countCalls(['getModuleByKey']));
    }

    /**
     * ST-18: if the module is gone for good, the answer is 500 misconfigured, never entry-not-found.
     */
    public function testAnUninstalledExtensionIsMisconfiguredNotEntryNotFound(): void
    {
        $this->request('GET', '/v1/entries/' . self::USER, self::USER);
        $this->churchTools->removeModule(KvSchema::EXTENSION_KEY);
        $this->clock->advance(61);

        $this->assertProblem(ProblemType::Misconfigured, $this->request('GET', '/v1/entries/' . self::USER, self::USER));
        self::assertSame(2, $this->churchTools->countCalls(['getModuleByKey']), 'One re-resolution, no loop.');
    }

    private static function normalize(string $path): string
    {
        $parts = [];
        foreach (explode('/', $path) as $part) {
            if ($part === '..') {
                array_pop($parts);
            } elseif ($part !== '.' && $part !== '') {
                $parts[] = $part;
            }
        }

        return '/' . implode('/', $parts);
    }
}
