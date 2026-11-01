<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Config;

use CtPassStore\Config\BackendConfig;
use CtPassStore\Config\ConfigurationException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Catalog CF-01, CF-02 (unit part), CF-03, CF-04, LG-05.
 */
final class BackendConfigTest extends TestCase
{
    private const TOKEN = 'service-token-SECRET';

    /**
     * @return array<string, mixed>
     */
    private static function valid(): array
    {
        return [
            'CT_API_URL' => 'https://example.church.tools/api',
            'CT_API_TOKEN' => self::TOKEN,
            'CORS' => ['https://example.church.tools', 'http://localhost:5173'],
            'OAUTH_CLIENT_ID' => 'oauth-client-id',
            'OAUTH_CLIENT_SECRET' => 'oauth-client-SECRET-4711',
            'JWT_SECRET' => str_repeat('j', 40),
        ];
    }

    public function testAValidConfigurationIsAccepted(): void
    {
        $config = BackendConfig::fromArray(['LOG_LEVEL' => 'warning'] + self::valid(), '/path/credentials.php', '/cache');

        self::assertSame('https://example.church.tools/api', $config->apiUrl);
        self::assertSame(self::TOKEN, $config->apiToken);
        self::assertSame(['https://example.church.tools', 'http://localhost:5173'], $config->corsOrigins);
        self::assertSame('warning', $config->logLevel);
        self::assertSame('/path/credentials.php', $config->credentialsPath);
        self::assertSame('oauth-client-id', $config->oauthClientId);
        self::assertSame('oauth-client-SECRET-4711', $config->oauthClientSecret);
        self::assertSame(str_repeat('j', 40), $config->jwtSecret);
    }

    public function testInstanceOriginComesFromTheApiUrl(): void
    {
        self::assertSame('https://example.church.tools', BackendConfig::fromArray(self::valid(), 'x', '/cache')->instanceOrigin());
        self::assertSame('https://example.church.tools:8443', BackendConfig::fromArray(['CT_API_URL' => 'https://Example.church.tools:8443/api'] + self::valid(), 'x', '/cache')->instanceOrigin());
    }

    public function testDefaultsForOptionalKeys(): void
    {
        $config = BackendConfig::fromArray(self::valid(), 'x', '/cache');

        self::assertSame('info', $config->logLevel);
    }

    /**
     * @return iterable<string, array{array<string, mixed>, string}>
     */
    public static function invalidConfigurations(): iterable
    {
        $v = self::valid();
        foreach (['CT_API_URL', 'CT_API_TOKEN', 'CORS', 'OAUTH_CLIENT_ID', 'OAUTH_CLIENT_SECRET', 'JWT_SECRET'] as $key) {
            $missing = $v;
            unset($missing[$key]);
            yield "$key missing" => [$missing, $key];
            yield "$key empty" => [[$key => ''] + $v, $key];
        }
        yield 'URL with http' => [['CT_API_URL' => 'http://example.church.tools/api'] + $v, 'CT_API_URL'];
        yield 'URL without scheme' => [['CT_API_URL' => 'example.church.tools/api'] + $v, 'CT_API_URL'];
        yield 'URL with credentials' => [['CT_API_URL' => 'https://user:pass@example.church.tools/api'] + $v, 'CT_API_URL'];
        yield 'URL with query' => [['CT_API_URL' => 'https://example.church.tools/api?x=1'] + $v, 'CT_API_URL'];
        yield 'URL with fragment' => [['CT_API_URL' => 'https://example.church.tools/api#x'] + $v, 'CT_API_URL'];
        yield 'token with whitespace' => [['CT_API_TOKEN' => 'abc def'] + $v, 'CT_API_TOKEN'];
        yield 'token not a string' => [['CT_API_TOKEN' => 12345] + $v, 'CT_API_TOKEN'];
        yield 'CORS not a list' => [['CORS' => 'https://example.church.tools'] + $v, 'CORS'];
        yield 'CORS map' => [['CORS' => ['a' => 'https://example.church.tools']] + $v, 'CORS'];
        yield 'CORS wildcard' => [['CORS' => ['*']] + $v, 'CORS'];
        yield 'CORS with path' => [['CORS' => ['https://example.church.tools/path']] + $v, 'CORS'];
        yield 'CORS with trailing slash' => [['CORS' => ['https://example.church.tools/']] + $v, 'CORS'];
        yield 'CORS without scheme' => [['CORS' => ['example.church.tools']] + $v, 'CORS'];
        yield 'CORS non-string' => [['CORS' => [42]] + $v, 'CORS'];
        yield 'JWT secret 31 bytes' => [['JWT_SECRET' => str_repeat('x', 31)] + $v, 'JWT_SECRET'];
        yield 'empty OAuth client ID' => [['OAUTH_CLIENT_ID' => ''] + $v, 'OAUTH_CLIENT_ID'];
        yield 'LOG_LEVEL unknown' => [['LOG_LEVEL' => 'verbose'] + $v, 'LOG_LEVEL'];
        yield 'LOG_LEVEL uppercase' => [['LOG_LEVEL' => 'INFO'] + $v, 'LOG_LEVEL'];
        yield 'LOG_LEVEL with space' => [['LOG_LEVEL' => 'info '] + $v, 'LOG_LEVEL'];
        yield 'LOG_LEVEL empty' => [['LOG_LEVEL' => ''] + $v, 'LOG_LEVEL'];
    }

    /**
     * @param array<string, mixed> $credentials
     */
    #[DataProvider('invalidConfigurations')]
    public function testInvalidConfigurationNamesTheKeyButNotItsValue(array $credentials, string $key): void
    {
        try {
            BackendConfig::fromArray($credentials, 'x', '/cache');
            self::fail('Expected a ConfigurationException.');
        } catch (ConfigurationException $e) {
            self::assertStringContainsString($key, $e->getMessage());
            self::assertStringNotContainsString(self::TOKEN, $e->getMessage());
            foreach (['user:pass', 'abc def', 'verbose'] as $value) {
                self::assertStringNotContainsString($value, $e->getMessage());
            }
        }
    }

    public function testJwtSecretOfExactly32BytesIsAccepted(): void
    {
        self::assertSame(str_repeat('y', 32), BackendConfig::fromArray(['JWT_SECRET' => str_repeat('y', 32)] + self::valid(), 'x', '/cache')->jwtSecret);
    }

    public function testCredentialsMustBeAnArray(): void
    {
        $this->expectException(ConfigurationException::class);
        BackendConfig::fromArray(1, 'x', '/cache');
    }
}
