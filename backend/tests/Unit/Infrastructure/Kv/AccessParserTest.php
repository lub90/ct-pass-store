<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Infrastructure\Kv;

use CtPassStore\Infrastructure\Kv\AccessParser;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * AG-04 (parser part): a missing or invalid admin group means no admins and never an exception. The machine-client
 * rules are tested through KvSettingsRepositoryTest.
 */
final class AccessParserTest extends TestCase
{
    public function testMissingAccessMeansNoAdminsAndNoClients(): void
    {
        $parsed = AccessParser::parse(null);

        self::assertNull($parsed->adminGroupId);
        self::assertSame([], $parsed->machineClients);
        self::assertCount(1, $parsed->findings);
        self::assertStringContainsString('access', $parsed->findings[0]);
    }

    /**
     * @return iterable<string, array{array<string, mixed>}>
     */
    public static function invalidGroupIds(): iterable
    {
        yield 'empty value' => [[]];
        yield 'no groups' => [['schema' => 2]];
        yield 'groups not an object' => [['groups' => 12]];
        yield 'no admins' => [['groups' => ['users' => ['groupId' => 5]]]];
        yield 'admins not an object' => [['groups' => ['admins' => 12]]];
        yield 'no groupId' => [['groups' => ['admins' => ['createdBySetup' => true]]]];
        yield 'zero' => [['groups' => ['admins' => ['groupId' => 0]]]];
        yield 'negative' => [['groups' => ['admins' => ['groupId' => -1]]]];
        yield 'string' => [['groups' => ['admins' => ['groupId' => '12']]]];
        yield 'float' => [['groups' => ['admins' => ['groupId' => 1.5]]]];
        yield 'whole float' => [['groups' => ['admins' => ['groupId' => 12.0]]]];
        yield 'null' => [['groups' => ['admins' => ['groupId' => null]]]];
        yield 'bool' => [['groups' => ['admins' => ['groupId' => true]]]];
    }

    /**
     * @param array<string, mixed> $raw
     */
    #[DataProvider('invalidGroupIds')]
    public function testAnInvalidGroupIdMeansNoAdminsWithAFinding(array $raw): void
    {
        $parsed = AccessParser::parse($raw);

        self::assertNull($parsed->adminGroupId);
        self::assertCount(1, $parsed->findings);
        self::assertStringContainsString('groups.admins.groupId', $parsed->findings[0]);
    }

    public function testAValidValueGivesTheGroupAndIgnoresTheRest(): void
    {
        $key = base64_encode(str_repeat('k', 32));
        $parsed = AccessParser::parse([
            'schema' => 2,
            'revision' => 3,
            'groups' => [
                'users' => ['groupId' => 11, 'createdBySetup' => false],
                'admins' => ['groupId' => 12, 'createdBySetup' => true],
                'service' => ['groupId' => 13, 'createdBySetup' => true],
            ],
            'machineClients' => [['id' => 'ct-radius', 'name' => 'RADIUS', 'publicKeys' => [$key], 'permissions' => ['entries:read'], 'createdAt' => '2026-11-01']],
        ]);

        self::assertSame(12, $parsed->adminGroupId);
        self::assertSame(['ct-radius'], array_keys($parsed->machineClients));
        self::assertSame([], $parsed->findings);
    }

    public function testBrokenClientsDontAffectTheAdminGroup(): void
    {
        $parsed = AccessParser::parse(['groups' => ['admins' => ['groupId' => 12]], 'machineClients' => 'not a list']);

        self::assertSame(12, $parsed->adminGroupId);
        self::assertSame([], $parsed->machineClients);
        self::assertCount(1, $parsed->findings);
    }

    /**
     * AG-13: the shared fixture pins the machine client rules for the backend and the extension. It is decoded
     * without assoc, so JSON objects and lists stay apart as in production.
     *
     * @return iterable<string, array{\stdClass}>
     */
    public static function fixtureCases(): iterable
    {
        $cases = json_decode((string) file_get_contents(__DIR__ . '/../../../../../shared/access-client-cases.json'), false, 512, JSON_THROW_ON_ERROR);
        foreach ($cases as $case) {
            yield $case->name => [$case];
        }
    }

    /**
     * The `access` value for a case: the raw machineClients value, or the single client or the list of clients.
     */
    public static function accessJson(\stdClass $case): string
    {
        $clients = property_exists($case, 'machineClients') ? $case->machineClients : (property_exists($case, 'client') ? [$case->client] : $case->clients);

        return json_encode(['groups' => ['admins' => ['groupId' => 12]], 'machineClients' => $clients], JSON_THROW_ON_ERROR);
    }

    #[DataProvider('fixtureCases')]
    public function testFixtureCase(\stdClass $case): void
    {
        $parsed = AccessParser::parseJson(self::accessJson($case));

        if (property_exists($case, 'client')) {
            self::assertSame($case->valid, $parsed->machineClients !== [], 'enabled');
            self::assertSame([$case->reasons], $parsed->entryReasons);
            self::assertSame($case->valid, $parsed->findings === [] || self::onlyPermissionFindings($parsed->findings));
        } elseif (property_exists($case, 'clients')) {
            self::assertSame($case->enabled, array_map(strval(...), array_keys($parsed->machineClients)));
            self::assertSame($case->reasons, $parsed->entryReasons);
        } else {
            self::assertSame($case->enabled, array_map(strval(...), array_keys($parsed->machineClients)));
        }
    }

    /**
     * @param list<string> $findings
     */
    private static function onlyPermissionFindings(array $findings): bool
    {
        foreach ($findings as $finding) {
            if (!str_contains($finding, 'is unknown and grants nothing')) {
                return false;
            }
        }

        return true;
    }

    public function testTheStoredNameIsTrimmed(): void
    {
        $key = base64_encode(str_repeat('k', 32));
        $parsed = AccessParser::parse(['machineClients' => [['id' => 'ct-radius', 'name' => "  RADIUS \t", 'publicKeys' => [$key], 'createdAt' => '2026-11-01']]]);

        self::assertSame('RADIUS', $parsed->machineClients['ct-radius']->name);
    }

    public function testAFindingNamesTheClientAndTheMissingField(): void
    {
        $parsed = AccessParser::parse(['machineClients' => [['id' => 'ct-radius', 'publicKeys' => [base64_encode(str_repeat('k', 32))]]]]);

        self::assertSame([], $parsed->machineClients);
        $finding = current(array_filter($parsed->findings, static fn(string $f): bool => str_contains($f, 'Machine client ct-radius is disabled')));
        self::assertIsString($finding);
        self::assertStringContainsString('name', $finding);
        self::assertStringContainsString('createdAt', $finding);
    }
}
