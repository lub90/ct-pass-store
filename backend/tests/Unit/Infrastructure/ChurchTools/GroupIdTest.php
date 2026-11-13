<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Infrastructure\ChurchTools;

use CtPassStore\Infrastructure\ChurchTools\GroupId;
use PHPUnit\Framework\TestCase;

/**
 * Catalog AG-01.
 */
final class GroupIdTest extends TestCase
{
    /** AG-01 */
    public function testOnlyAPlainPositiveDecimalIsAGroupId(): void
    {
        self::assertSame(12, GroupId::parse('12'));
        self::assertSame(12, GroupId::parse(12));
        foreach (['012', '12 ', ' 12', '1e1', '+12', '-12', '0', '', null, 12.0, true, [], 0, -12, "12\n"] as $bad) {
            self::assertNull(GroupId::parse($bad), var_export($bad, true));
        }
    }
}
