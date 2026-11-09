<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Infrastructure\ChurchTools;

use CtPassStore\Infrastructure\ChurchTools\Exception\InvalidResponseException;
use CtPassStore\Infrastructure\ChurchTools\Permissions;
use CtPassStore\Infrastructure\ChurchTools\WhoAmI;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * The typed ChurchTools answers check their shape in one place, for the real client and the fake alike.
 */
final class AnswersTest extends TestCase
{
    public function testWhoAmIReadsIdAndUsername(): void
    {
        $person = WhoAmI::fromData(['id' => 5, 'cmsUserId' => 'jdoe', 'firstName' => 'Jane']);

        self::assertSame([5, 'jdoe'], [$person->id, $person->username]);
    }

    /**
     * @return iterable<string, array{array<string, mixed>}>
     */
    public static function malformedPeople(): iterable
    {
        yield 'no id' => [['cmsUserId' => 'jdoe']];
        yield 'id as string' => [['id' => '5', 'cmsUserId' => 'jdoe']];
        yield 'id as float' => [['id' => 5.0, 'cmsUserId' => 'jdoe']];
        yield 'no username' => [['id' => 5]];
        yield 'username as number' => [['id' => 5, 'cmsUserId' => 5]];
        yield 'username null' => [['id' => 5, 'cmsUserId' => null]];
    }

    /**
     * @param array<string, mixed> $data
     */
    #[DataProvider('malformedPeople')]
    public function testMalformedPeopleAreInvalidResponses(array $data): void
    {
        $this->expectException(InvalidResponseException::class);
        WhoAmI::fromData($data);
    }

    public function testViewIsGrantedOnlyByExactlyTrue(): void
    {
        self::assertTrue((new Permissions(['ctpassstore' => ['view' => true]]))->mayView('ctpassstore'));

        foreach ([['view' => false], ['view' => 'true'], ['view' => 1], ['view' => null], ['view' => [true]], [], true, 'view'] as $value) {
            self::assertFalse((new Permissions(['ctpassstore' => $value]))->mayView('ctpassstore'), json_encode($value, JSON_THROW_ON_ERROR));
        }
        self::assertFalse((new Permissions([]))->mayView('ctpassstore'));
        self::assertNull((new Permissions(['ctpassstore' => true]))->of('ctpassstore'));
    }
}
