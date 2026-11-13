<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Infrastructure\Kv;

use CtPassStore\Application\Exception\ConfigurationException;
use CtPassStore\Infrastructure\Kv\SettingsParser;
use PHPUnit\Framework\TestCase;

/**
 * The parser needs no ChurchTools, no fake and no logger. The full rule set is tested through KvSettingsRepositoryTest;
 * this shows the split: findings come back as data, invalid settings as an exception.
 */
final class SettingsParserTest extends TestCase
{
    public function testFindingsAreReturnedNotLogged(): void
    {
        $parsed = SettingsParser::parse([
            'requirePasswordForPasswordChange' => true,
            'allowCustomPassword' => false,
            'passwordLength' => 16,
            'backendUrl' => 'http://not-https.example',
            'machineClients' => 'not a list',
        ]);

        self::assertSame(16, $parsed->settings->passwordLength);
        self::assertNull($parsed->settings->backendUrl);
        self::assertSame([], $parsed->settings->machineClients);
        self::assertCount(1, $parsed->findings, 'machineClients in settings is ignored; only backendUrl is reported.');
    }

    /**
     * AG-09: the fields the extension writes besides the ones the backend reads change nothing.
     */
    public function testFieldsTheBackendDoesntUseChangeNothing(): void
    {
        $base = ['requirePasswordForPasswordChange' => true, 'allowCustomPassword' => false, 'passwordLength' => 16, 'adminUsers' => [7], 'backendUrl' => 'https://backend.example.org'];
        $extra = $base + [
            'schema' => 2,
            'revision' => 9,
            'oauthClientId' => 'abc',
            'texts' => ['de' => ['title' => 'Passwörter']],
            'machineClients' => [['id' => 'ct-radius', 'publicKeys' => [], 'permissions' => []]],
        ];

        $plain = SettingsParser::parse($base);
        $withExtras = SettingsParser::parse($extra);

        self::assertEquals($plain->settings, $withExtras->settings);
        self::assertSame($plain->findings, $withExtras->findings);
        self::assertSame([], $withExtras->settings->machineClients);
        self::assertNull($withExtras->settings->adminGroupId);
    }

    public function testInvalidSettingsThrow(): void
    {
        $this->expectException(ConfigurationException::class);
        SettingsParser::parse(['requirePasswordForPasswordChange' => 'yes', 'allowCustomPassword' => false, 'passwordLength' => 16]);
    }
}
