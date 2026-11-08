<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Application;

use CtPassStore\Application\EntryGuard;
use CtPassStore\Application\Exception\InvalidPrimaryPasswordException;
use CtPassStore\Application\Exception\TooManyAttemptsException;
use CtPassStore\Application\Port\PrimaryPasswordVerifier;
use CtPassStore\Application\Port\SettingsRepository;
use CtPassStore\Domain\PersonId;
use CtPassStore\Domain\PersonPrincipal;
use CtPassStore\Domain\Settings;
use CtPassStore\Infrastructure\Auth\FileAttemptLimiter;
use CtPassStore\Infrastructure\ChurchTools\Exception\UnavailableException;
use CtPassStore\Infrastructure\Store\SignedFileStore;
use CtPassStore\Tests\Support\FrozenClock;
use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;

/**
 * Catalog TR-05: parallel attempts can't run more primary-password checks than the limit allows (spec 6.3).
 *
 * Real parallelism isn't needed: the fake verifier starts the next attempt while "ChurchTools is being asked", so
 * all attempts are in flight at the same time, as with parallel requests.
 */
final class EntryGuardAttemptsTest extends TestCase
{
    private string $dir;
    private EntryGuard $guard;

    /** @var \Closure(int): bool what ChurchTools answers for the n-th check (1-based) */
    private \Closure $answer;

    private int $checks = 0;
    private int $inFlight = 0;
    private int $maxInFlight = 0;

    /** @var list<string> outcome of each attempt: ok, wrong, blocked, outage */
    private array $outcomes = [];

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/ctps-guard-' . bin2hex(random_bytes(6));
        $settings = new class implements SettingsRepository {
            public function settings(): Settings
            {
                return new Settings(true, true, 16, [], null);
            }
        };
        $verifier = new class ($this) implements PrimaryPasswordVerifier {
            public function __construct(private readonly EntryGuardAttemptsTest $test) {}

            public function verify(string $username, #[\SensitiveParameter] string $password, PersonId $person): bool
            {
                return $this->test->check();
            }
        };
        $this->answer = static fn(int $n): bool => false;
        $this->guard = new EntryGuard($settings, $verifier, new FileAttemptLimiter(new SignedFileStore($this->dir, str_repeat('s', 40), new NullLogger()), new FrozenClock()), new NullLogger());
    }

    protected function tearDown(): void
    {
        foreach (glob($this->dir . '/*') ?: [] as $file) {
            @unlink($file);
        }
        @rmdir($this->dir);
    }

    /** Remaining attempts to start while a check is running. */
    private int $pending = 0;

    /**
     * Called by the fake verifier: ChurchTools is "being asked". The next attempt starts now, before this one ends.
     */
    public function check(): bool
    {
        $n = ++$this->checks;
        $this->maxInFlight = max($this->maxInFlight, ++$this->inFlight);
        $this->startNext();
        $this->inFlight--;

        return ($this->answer)($n);
    }

    private function startNext(): void
    {
        if ($this->pending === 0) {
            return;
        }
        $this->pending--;
        $this->attempt();
    }

    private function attempt(): void
    {
        try {
            $this->guard->authorizeChange(new PersonPrincipal(new PersonId(5), 'jdoe'), new PersonId(5), 'some-password');
            $this->outcomes[] = 'ok';
        } catch (InvalidPrimaryPasswordException) {
            $this->outcomes[] = 'wrong';
        } catch (TooManyAttemptsException) {
            $this->outcomes[] = 'blocked';
            // A blocked request returns at once; the chain of requests goes on.
            $this->startNext();
        } catch (UnavailableException) {
            $this->outcomes[] = 'outage';
        }
    }

    /**
     * Starts `$count` attempts that are all in flight at the same time.
     */
    private function parallel(int $count): void
    {
        $this->pending = $count - 1;
        $this->attempt();
    }

    public function testParallelWrongAttemptsReachChurchToolsAtMostFiveTimes(): void
    {
        $this->parallel(50);

        self::assertSame(5, $this->checks, 'Without counting up front, all 50 would have been checked.');
        self::assertSame(5, $this->maxInFlight);
        self::assertSame(45, count(array_keys($this->outcomes, 'blocked', true)));
        self::assertSame(5, count(array_keys($this->outcomes, 'wrong', true)));
    }

    public function testAfterParallelFailuresTheCorrectPasswordIsBlockedToo(): void
    {
        $this->parallel(10);
        $this->answer = static fn(int $n): bool => true;

        $this->parallel(1);

        self::assertSame('blocked', $this->outcomes[array_key_last($this->outcomes)]);
        self::assertSame(5, $this->checks);
    }

    public function testAnOutageWithdrawsItsAttemptAndTheBlockItCaused(): void
    {
        // The 5th check fails with an outage: it doesn't count, so four failures remain and nobody is blocked.
        $this->answer = static fn(int $n): bool => $n === 5 ? throw new UnavailableException('down') : false;
        $this->parallel(5);
        self::assertContains('outage', $this->outcomes);

        $this->answer = static fn(int $n): bool => true;
        $this->parallel(1);

        self::assertSame('ok', $this->outcomes[array_key_last($this->outcomes)]);
    }

    public function testACorrectPasswordAmongParallelAttemptsResetsTheCounter(): void
    {
        // The 3rd of 4 parallel attempts is correct. Its reset clears all earlier ones; one more failure doesn't block.
        $this->answer = static fn(int $n): bool => $n === 3;
        $this->parallel(4);
        $this->answer = static fn(int $n): bool => false;
        $this->parallel(4);

        self::assertNotContains('blocked', $this->outcomes);
    }
}
