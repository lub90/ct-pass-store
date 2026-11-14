<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Domain;

use CtPassStore\Domain\MachineClient;
use PHPUnit\Framework\TestCase;

/**
 * The key fingerprint the backend logs is the one the extension shows (extension spec 4.7).
 */
final class MachineClientTest extends TestCase
{
    /**
     * The expected values were computed with node's crypto (base64url of SHA-256, first 16 characters), the reference
     * the extension's own tests use.
     */
    public function testTheFingerprintIsTheFirst16CharactersOfBase64urlSha256OfTheKeyBytes(): void
    {
        $key = implode('', array_map(static fn(int $i): string => chr(0xff - $i), range(0, 31)));

        self::assertSame('GGXACDHnP37iP8E8', MachineClient::keyFingerprint($key));
    }

    public function testTheFingerprintUsesTheBase64urlAlphabetWithoutPadding(): void
    {
        self::assertSame('cs1uhCLEB_ttCYaQ', MachineClient::keyFingerprint(str_repeat(chr(1), 32)));
    }
}
