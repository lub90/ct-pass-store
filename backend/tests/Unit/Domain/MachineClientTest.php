<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Domain;

use CtPassStore\Domain\MachineClient;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * The key fingerprint the backend logs is the one the extension shows (extension spec 4.7): both test suites read the
 * vectors of shared/key-fingerprint-cases.json, computed with node's crypto (base64url of SHA-256, first 16 characters).
 */
final class MachineClientTest extends TestCase
{
    /** @return iterable<string, array{string, string}> */
    public static function cases(): iterable
    {
        $cases = json_decode((string) file_get_contents(__DIR__ . '/../../../../shared/key-fingerprint-cases.json'), true, 512, JSON_THROW_ON_ERROR);
        self::assertIsArray($cases);
        foreach ($cases as $case) {
            yield (string) $case['name'] => [(string) hex2bin((string) $case['keyHex']), (string) $case['fingerprint']];
        }
    }

    #[DataProvider('cases')]
    public function testTheFingerprintIsTheFirst16CharactersOfBase64urlSha256OfTheKeyBytes(string $key, string $fingerprint): void
    {
        self::assertSame(32, strlen($key));
        self::assertSame($fingerprint, MachineClient::keyFingerprint($key));
    }

    public function testTheSharedCasesHoldEachBase64urlSpecialCharacterAndARepeatedOne(): void
    {
        $prints = array_column(iterator_to_array(self::cases()), 1);

        // A '-' (from '+') and a '_' (from '/') each, and a print with two of one: a mapping that misses '+' or replaces
        // only the first '/' fails the vectors above.
        self::assertNotEmpty(array_filter($prints, static fn(string $p): bool => str_contains($p, '-')));
        self::assertNotEmpty(array_filter($prints, static fn(string $p): bool => str_contains($p, '_')));
        self::assertNotEmpty(array_filter($prints, static fn(string $p): bool => substr_count($p, '_') >= 2));
        self::assertNotEmpty(array_filter($prints, static fn(string $p): bool => substr_count($p, '-') >= 2));
    }

    public function testTheFingerprintUsesOnlyTheBase64urlAlphabetOverManyKeys(): void
    {
        $prints = array_map(static fn(int $n): string => MachineClient::keyFingerprint(str_repeat(chr($n), 32)), range(0, 255));

        foreach ($prints as $n => $print) {
            self::assertMatchesRegularExpression('/^[A-Za-z0-9_-]{16}$/', $print, (string) $n);
        }
        self::assertNotEmpty(array_filter($prints, static fn(string $p): bool => str_contains($p, '-')));
        self::assertNotEmpty(array_filter($prints, static fn(string $p): bool => str_contains($p, '_')));
    }
}
