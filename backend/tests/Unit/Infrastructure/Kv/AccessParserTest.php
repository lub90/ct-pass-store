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
            'machineClients' => [['id' => 'ct-radius', 'name' => 'RADIUS', 'publicKeys' => [$key], 'permissions' => ['entries:read']]],
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
}
