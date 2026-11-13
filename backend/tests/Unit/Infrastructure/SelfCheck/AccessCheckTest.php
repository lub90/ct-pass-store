<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Infrastructure\SelfCheck;

use CtPassStore\Infrastructure\ChurchTools\Exception\NotFoundException;
use CtPassStore\Infrastructure\ChurchTools\Exception\RateLimitedException;
use CtPassStore\Infrastructure\ChurchTools\Exception\ServiceCredentialRejectedException;
use CtPassStore\Infrastructure\ChurchTools\Exception\UnavailableException;
use CtPassStore\Infrastructure\Kv\ExtensionData;
use CtPassStore\Infrastructure\Kv\KvSchema;
use CtPassStore\Infrastructure\SelfCheck\AccessCheck;
use CtPassStore\Tests\Support\FakeChurchToolsClient;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * The self-check "access" (spec 4.8; catalog AG-08).
 */
final class AccessCheckTest extends TestCase
{
    private FakeChurchToolsClient $fake;

    private int $access;

    protected function setUp(): void
    {
        $this->fake = new FakeChurchToolsClient();
        $this->access = $this->fake->addModule(KvSchema::EXTENSION_KEY, [KvSchema::ACCESS_CATEGORY])[KvSchema::ACCESS_CATEGORY];
    }

    private function outcome(): \CtPassStore\Application\SelfCheck\CheckOutcome
    {
        return (new AccessCheck(new ExtensionData($this->fake)))->run();
    }

    public function testNameIsAccess(): void
    {
        self::assertSame('access', (new AccessCheck(new ExtensionData($this->fake)))->name());
    }

    public function testAReadableCategoryWithAGroupIsOkAndNamesTheGroup(): void
    {
        $this->fake->seedValue($this->access, json_encode(['groups' => ['admins' => ['groupId' => 12]], 'machineClients' => []], JSON_THROW_ON_ERROR));

        $result = $this->outcome();

        self::assertTrue($result->ok);
        self::assertSame('The service user can read access; the admin group is 12.', $result->message);
    }

    public function testAnUnreadableCategoryFails(): void
    {
        $this->fake->failNextRead($this->access, new NotFoundException('GET customdatavalues: ChurchTools answered 404.'));

        $result = $this->outcome();

        self::assertFalse($result->ok);
        self::assertSame("The service user can't read the category access; grant it view custom category and view custom data on access.", $result->message);
    }

    public function testARejectedServiceUserFailsWithTheRightsMessage(): void
    {
        $this->fake->failNextRead($this->access, new ServiceCredentialRejectedException('GET customdatavalues: ChurchTools answered 403.'));

        $result = $this->outcome();

        self::assertFalse($result->ok);
        self::assertSame("The service user can't read the category access; grant it view custom category and view custom data on access.", $result->message);
    }

    /**
     * @return iterable<string, array{\Throwable}>
     */
    public static function outages(): iterable
    {
        yield 'unavailable' => [new UnavailableException('503')];
        yield 'rate limited' => [new RateLimitedException('429', 60)];
    }

    #[DataProvider('outages')]
    public function testAnOutageIsNotReportedAsMissingRights(\Throwable $outage): void
    {
        $log = new \Monolog\Handler\TestHandler();
        $this->fake->failNextRead($this->access, $outage);

        $result = (new AccessCheck(new ExtensionData($this->fake), new \Monolog\Logger('test', [$log])))->run();

        self::assertFalse($result->ok);
        self::assertSame("ChurchTools didn't answer while reading access; try again.", $result->message);
        self::assertTrue($log->hasWarningThatContains('access'));
    }

    public function testSeveralValuesAreNamed(): void
    {
        $this->fake->seedValue($this->access, '{"groups":{"admins":{"groupId":12}}}');
        $this->fake->seedValue($this->access, '{"groups":{"admins":{"groupId":13}}}');

        $result = $this->outcome();

        self::assertFalse($result->ok);
        self::assertStringStartsWith('The category access holds 2 values; it must hold exactly one.', $result->message);
    }

    public function testAMissingCategoryFails(): void
    {
        $fake = new FakeChurchToolsClient();
        $fake->addModule(KvSchema::EXTENSION_KEY, [KvSchema::SETTINGS_CATEGORY]);

        $result = (new AccessCheck(new ExtensionData($fake)))->run();

        self::assertFalse($result->ok);
        self::assertStringStartsWith("The service user can't read the category access;", $result->message);
    }

    /**
     * @return iterable<string, array{string|null}>
     */
    public static function unusableValues(): iterable
    {
        yield 'no value' => [null];
        yield 'not JSON' => ['nope'];
        yield 'no groups' => ['{"schema":2}'];
        yield 'zero' => ['{"groups":{"admins":{"groupId":0}}}'];
        yield 'negative' => ['{"groups":{"admins":{"groupId":-3}}}'];
        yield 'string' => ['{"groups":{"admins":{"groupId":"12"}}}'];
        yield 'float' => ['{"groups":{"admins":{"groupId":1.5}}}'];
    }

    #[DataProvider('unusableValues')]
    public function testAMissingOrInvalidGroupIdFails(?string $value): void
    {
        if ($value !== null) {
            $this->fake->seedValue($this->access, $value);
        }

        $result = $this->outcome();

        self::assertFalse($result->ok);
        self::assertSame("access.groups.admins.groupId is missing or not a positive integer; nobody is admin until the extension's setup fixes it.", $result->message);
    }
}
