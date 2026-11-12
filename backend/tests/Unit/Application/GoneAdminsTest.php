<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Application;

use CtPassStore\Application\GoneAdmins;
use CtPassStore\Application\GonePersons;
use CtPassStore\Domain\Settings;
use CtPassStore\Infrastructure\ChurchTools\ChurchToolsPersonDirectory;
use CtPassStore\Tests\Support\FakeChurchToolsClient;
use CtPassStore\Tests\Support\FrozenClock;
use PHPUnit\Framework\TestCase;

/**
 * Catalog GP-03.
 */
final class GoneAdminsTest extends TestCase
{
    private FakeChurchToolsClient $fake;

    private GoneAdmins $admins;

    protected function setUp(): void
    {
        $this->fake = new FakeChurchToolsClient();
        $this->fake->setServiceUserPermissions(['churchdb' => [
            'view' => true,
            'view alldata' => [1],
            'view archive' => true,
            'view hidden persons' => true,
        ]]);
        $this->admins = new GoneAdmins(new GonePersons(new ChurchToolsPersonDirectory($this->fake), new FrozenClock()));
    }

    /**
     * @param list<int> $adminUsers
     */
    private static function settings(array $adminUsers): Settings
    {
        return new Settings(false, true, 12, $adminUsers, null);
    }

    public function testReturnsTheGoneAdminsInSettingsOrder(): void
    {
        $this->fake->addPerson(100);
        $this->fake->addPerson(101, archived: true);

        $gone = $this->admins->find(self::settings([102, 100, 101]));

        self::assertSame([102, 101], array_map(static fn($p): int => $p->value, $gone));
    }

    public function testNoGoneAdmins(): void
    {
        $this->fake->addPerson(100);
        $this->fake->addPerson(101);

        self::assertSame([], $this->admins->find(self::settings([100, 101])));
    }
}
