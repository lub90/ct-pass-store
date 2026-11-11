<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Application\SelfCheck;

use CtPassStore\Application\SelfCheck\Check;
use CtPassStore\Application\SelfCheck\CheckOutcome;
use CtPassStore\Application\SelfCheck\SelfCheck;
use Monolog\Handler\TestHandler;
use Monolog\Logger;
use PHPUnit\Framework\TestCase;

/**
 * The self-check runner (spec 4.8).
 */
final class SelfCheckTest extends TestCase
{
    private TestHandler $log;

    private function runner(Check ...$checks): SelfCheck
    {
        $this->log = new TestHandler();

        return new SelfCheck($checks, new Logger('test', [$this->log]));
    }

    private function check(string $name, \Closure $run): Check
    {
        return new class ($name, $run) implements Check {
            public function __construct(private readonly string $name, private readonly \Closure $run) {}

            public function name(): string
            {
                return $this->name;
            }

            public function run(): CheckOutcome
            {
                return ($this->run)();
            }
        };
    }

    public function testAllOkPasses(): void
    {
        $result = $this->runner($this->check('A', static fn() => CheckOutcome::ok('fine')), $this->check('B', static fn() => CheckOutcome::ok('fine')))->run();

        self::assertTrue($result['passed']);
        self::assertSame([['name' => 'A', 'status' => 'ok', 'message' => 'fine'], ['name' => 'B', 'status' => 'ok', 'message' => 'fine']], $result['tests']);
    }

    public function testOneFailingCheckFailsOnlyThatOne(): void
    {
        $result = $this->runner($this->check('A', static fn() => CheckOutcome::ok('fine')), $this->check('B', static fn() => CheckOutcome::fail('broken')))->run();

        self::assertFalse($result['passed']);
        self::assertSame(['ok', 'fail'], array_column($result['tests'], 'status'));
        self::assertSame('broken', $result['tests'][1]['message']);
    }

    public function testUnexpectedExceptionGivesGenericMessageAndIsLogged(): void
    {
        $result = $this->runner($this->check('A', static fn() => throw new \RuntimeException('secret /home/x/path')))->run();

        self::assertFalse($result['passed']);
        self::assertSame('fail', $result['tests'][0]['status']);
        self::assertSame('The check failed unexpectedly; see the log.', $result['tests'][0]['message']);
        self::assertTrue($this->log->hasErrorRecords());
    }

    public function testApplicationExceptionMessageIsShown(): void
    {
        $result = $this->runner($this->check('A', static fn() => throw new \CtPassStore\Application\Exception\EntryNotFoundException('visible')))->run();

        self::assertSame('visible', $result['tests'][0]['message']);
    }
}
