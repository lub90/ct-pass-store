<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Infrastructure\ChurchTools;

use CtPassStore\Infrastructure\ChurchTools\Permissions;
use CtPassStore\Infrastructure\ChurchTools\ServiceUserPersonsRight;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Catalog section 5 (CC-19).
 */
final class ServiceUserPersonsRightTest extends TestCase
{
    /**
     * @param array<string, mixed> $overrides
     */
    private static function permissions(array $overrides = []): Permissions
    {
        $churchdb = array_merge(
            ['view' => true, 'view alldata' => [1, 2], 'view archive' => true, 'view hidden persons' => true],
            $overrides,
        );
        foreach ($churchdb as $key => $value) {
            if ($value === '__absent__') {
                unset($churchdb[$key]);
            }
        }

        return new Permissions(['churchdb' => $churchdb]);
    }

    public function testGrantedRightHasNothingMissing(): void
    {
        self::assertSame([], ServiceUserPersonsRight::missingIn(self::permissions(), [1, 2]));
        self::assertTrue(ServiceUserPersonsRight::isGrantedIn(self::permissions(), [1, 2]));
    }

    /**
     * @return iterable<string, array{array<string, mixed>, string}>
     */
    public static function singleMissingParts(): iterable
    {
        yield 'view' => [['view' => false], 'churchdb view'];
        yield 'view archive' => [['view archive' => false], 'churchdb view archive'];
        yield 'view hidden persons' => [['view hidden persons' => false], 'churchdb view hidden persons'];
        yield 'view alldata' => [['view alldata' => [1]], 'churchdb view alldata for department 2'];
    }

    /**
     * @param array<string, mixed> $override
     */
    #[DataProvider('singleMissingParts')]
    public function testEachPartMissingOnItsOwn(array $override, string $text): void
    {
        $permissions = self::permissions($override);

        self::assertSame([$text], ServiceUserPersonsRight::missingIn($permissions, [1, 2]));
        self::assertFalse(ServiceUserPersonsRight::isGrantedIn($permissions, [1, 2]));
    }

    /**
     * @return iterable<string, array{mixed}>
     */
    public static function notExactlyTrue(): iterable
    {
        yield 'string true' => ['true'];
        yield 'one' => [1];
        yield 'null' => [null];
        yield 'absent' => ['__absent__'];
    }

    #[DataProvider('notExactlyTrue')]
    public function testFlagsThatAreNotExactlyTrueCountAsMissing(mixed $value): void
    {
        $permissions = self::permissions(['view' => $value, 'view archive' => $value, 'view hidden persons' => $value]);

        self::assertSame(
            ['churchdb view', 'churchdb view archive', 'churchdb view hidden persons'],
            ServiceUserPersonsRight::missingIn($permissions, []),
        );
    }

    /**
     * @return iterable<string, array{mixed}>
     */
    public static function notAListOfInts(): iterable
    {
        yield 'true' => [true];
        yield 'strings' => [['1']];
        yield 'object' => [['a' => 1]];
        yield 'absent' => ['__absent__'];
    }

    #[DataProvider('notAListOfInts')]
    public function testViewAlldataThatIsNotAListOfIntsMissesEveryDepartment(mixed $value): void
    {
        self::assertSame(
            ['churchdb view alldata for department 1', 'churchdb view alldata for department 2'],
            ServiceUserPersonsRight::missingIn(self::permissions(['view alldata' => $value]), [1, 2]),
        );
    }

    public function testMissingChurchdbModuleMissesEverything(): void
    {
        self::assertSame(
            ['churchdb view', 'churchdb view archive', 'churchdb view hidden persons', 'churchdb view alldata for department 1'],
            ServiceUserPersonsRight::missingIn(new Permissions([]), [1]),
        );
    }
}
