<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Domain;

use CtPassStore\Domain\AccessPolicy;
use CtPassStore\Domain\PersonId;
use CtPassStore\Domain\PersonPrincipal;
use CtPassStore\Domain\Principal;
use CtPassStore\Domain\Settings;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * The access matrix of spec 4.5–4.7 without HTTP; the API tests check that the endpoints use it.
 */
final class AccessPolicyTest extends TestCase
{
    private const USER = 10;
    private const OTHER = 11;
    private const ADMIN = 100;
    private const READER = 200;

    private static function settings(): Settings
    {
        return new Settings(true, true, 16, [self::ADMIN], [self::READER], null);
    }

    private static function person(int $id): PersonPrincipal
    {
        return new PersonPrincipal(new PersonId($id), "user$id");
    }

    #[DataProvider('matrix')]
    public function testMatrix(int $caller, int $target, bool $mayRead, bool $mayChange): void
    {
        $principal = self::person($caller);
        $targetId = new PersonId($target);

        self::assertSame($mayRead, AccessPolicy::mayRead($principal, $targetId, self::settings()), 'read');
        self::assertSame($mayChange, AccessPolicy::mayChange($principal, $targetId, self::settings()), 'change');
        self::assertSame($caller === $target, AccessPolicy::isOwner($principal, $targetId), 'owner');
    }

    /**
     * @return iterable<string, array{int, int, bool, bool}>
     */
    public static function matrix(): iterable
    {
        yield 'own entry' => [self::USER, self::USER, true, true];
        yield 'another person' => [self::USER, self::OTHER, false, false];
        yield 'admin, another person' => [self::ADMIN, self::USER, true, true];
        yield 'admin, own entry' => [self::ADMIN, self::ADMIN, true, true];
        yield 'reader, another person' => [self::READER, self::USER, true, false];
        yield 'reader, own entry' => [self::READER, self::READER, true, true];
    }

    public function testAnUnknownKindOfPrincipalGetsNothing(): void
    {
        // Machine clients (plan item 3.3) must be granted explicitly; nothing falls through to them by default.
        $machine = new class implements Principal {
            public function describe(): string
            {
                return 'machine client test';
            }
        };
        $target = new PersonId(self::USER);

        self::assertFalse(AccessPolicy::isOwner($machine, $target));
        self::assertFalse(AccessPolicy::mayRead($machine, $target, self::settings()));
        self::assertFalse(AccessPolicy::mayChange($machine, $target, self::settings()));
    }

    /**
     * Spec 4.3 matrix, machine rows (catalog AZ-03, AZ-12 on the policy level).
     */
    public function testMachineClients(): void
    {
        $reader = new \CtPassStore\Domain\MachinePrincipal('ct-radius', [\CtPassStore\Domain\MachineClient::PERMISSION_READ_ENTRIES]);
        $none = new \CtPassStore\Domain\MachinePrincipal('no-rights', []);

        foreach ([self::USER, self::OTHER, self::ADMIN] as $target) {
            $id = new PersonId($target);
            self::assertTrue(AccessPolicy::mayRead($reader, $id, self::settings()));
            self::assertFalse(AccessPolicy::mayChange($reader, $id, self::settings()));
            self::assertFalse(AccessPolicy::isOwner($reader, $id));
            self::assertFalse(AccessPolicy::mayRead($none, $id, self::settings()));
            self::assertFalse(AccessPolicy::mayChange($none, $id, self::settings()));
        }
    }

    public function testAMachineClientNamedLikeAnAdminGetsNoAdminRights(): void
    {
        // Principals are never compared across kinds: client "100" isn't admin person 100.
        $client = new \CtPassStore\Domain\MachinePrincipal('100', []);

        self::assertFalse(AccessPolicy::mayRead($client, new PersonId(self::USER), self::settings()));
        self::assertFalse(AccessPolicy::isOwner($client, new PersonId(100)));
    }
}
