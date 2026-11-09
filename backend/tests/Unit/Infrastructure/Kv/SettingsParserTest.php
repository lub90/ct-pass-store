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
        self::assertCount(2, $parsed->findings);
    }

    public function testInvalidSettingsThrow(): void
    {
        $this->expectException(ConfigurationException::class);
        SettingsParser::parse(['requirePasswordForPasswordChange' => 'yes', 'allowCustomPassword' => false, 'passwordLength' => 16]);
    }
}
