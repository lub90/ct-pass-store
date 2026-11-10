<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Infrastructure\Auth;

use CtPassStore\Application\Auth\AddressLimit;
use CtPassStore\Application\Exception\ConfigurationException;
use CtPassStore\Application\Exception\TooManyAttemptsException;
use CtPassStore\Infrastructure\Auth\FileAddressLimiter;
use CtPassStore\Infrastructure\Store\SignedFileStore;
use CtPassStore\Tests\Support\FrozenClock;
use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;

/**
 * Spec 6.1 (bounded size) and 6.3 (per-address limit, Q26).
 */
final class FileAddressLimiterTest extends TestCase
{
    private string $dir;
    private FrozenClock $clock;
    private FileAddressLimiter $limiter;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/ctps-addr-' . bin2hex(random_bytes(6));
        $this->clock = new FrozenClock();
        $this->limiter = $this->limiter($this->dir);
    }

    protected function tearDown(): void
    {
        @chmod($this->dir, 0o700);
        foreach (glob($this->dir . '/*') ?: [] as $file) {
            @unlink($file);
        }
        @rmdir($this->dir);
    }

    private function limiter(string $dir): FileAddressLimiter
    {
        return new FileAddressLimiter(new SignedFileStore($dir, str_repeat('s', 40), new NullLogger()), $this->clock, str_repeat('j', 40));
    }

    private function hits(AddressLimit $limit, string $addr, int $times): void
    {
        for ($i = 0; $i < $times; $i++) {
            $this->limiter->hit($limit, $addr);
        }
    }

    private function assertRefused(callable $call): TooManyAttemptsException
    {
        try {
            $call();
        } catch (TooManyAttemptsException $e) {
            self::assertGreaterThanOrEqual(1, $e->retryAfterSeconds);

            return $e;
        }
        self::fail('Expected TooManyAttemptsException.');
    }

    public function testThirtyLoginsPassAndTheThirtyFirstIsRefused(): void
    {
        $this->hits(AddressLimit::Login, '192.0.2.1', 30);
        $this->assertRefused(fn() => $this->limiter->hit(AddressLimit::Login, '192.0.2.1'));
    }

    public function testRefusedAttemptsAreNotCounted(): void
    {
        $this->hits(AddressLimit::Login, '192.0.2.1', 30);
        $this->clock->advance(30);
        $this->assertRefused(fn() => $this->limiter->hit(AddressLimit::Login, '192.0.2.1'));
        $this->assertRefused(fn() => $this->limiter->hit(AddressLimit::Login, '192.0.2.1'));
        self::assertLessThanOrEqual(30, $this->largestRecord());

        // The 30 first hits have expired; the refused ones would still count if they had been stored.
        $this->clock->advance(30);
        $this->limiter->hit(AddressLimit::Login, '192.0.2.1');
        $this->hits(AddressLimit::Login, '192.0.2.1', 29);
        $this->assertRefused(fn() => $this->limiter->hit(AddressLimit::Login, '192.0.2.1'));
    }

    public function testTheHundredFirstLoginFromManyAddressesIsRefused(): void
    {
        for ($i = 1; $i <= 100; $i++) {
            $this->limiter->hit(AddressLimit::Login, '198.51.100.' . $i);
        }
        $this->assertRefused(fn() => $this->limiter->hit(AddressLimit::Login, '203.0.113.9'));
        $this->clock->advance(60);
        $this->limiter->hit(AddressLimit::Login, '203.0.113.9');
    }

    public function testARefusedLoginCountsNowhere(): void
    {
        // One address fills its own bucket: 30 of the 100.
        $this->hits(AddressLimit::Login, '192.0.2.1', 30);
        for ($i = 0; $i < 20; $i++) {
            $this->assertRefused(fn() => $this->limiter->hit(AddressLimit::Login, '192.0.2.1'));
        }
        // 70 more from other addresses fit exactly; had the 20 refused ones counted globally, fewer would.
        for ($i = 1; $i <= 70; $i++) {
            $this->limiter->hit(AddressLimit::Login, '198.51.100.' . $i);
        }
        $this->assertRefused(fn() => $this->limiter->hit(AddressLimit::Login, '203.0.113.9'));
        // A globally refused login isn't counted in its address bucket either.
        $this->clock->advance(60);
        $this->hits(AddressLimit::Login, '203.0.113.9', 30);
    }

    public function testRejectedTokensHaveNoGlobalCap(): void
    {
        for ($i = 1; $i <= 200; $i++) {
            $this->limiter->hit(AddressLimit::RejectedToken, '198.51.100.' . $i);
        }
        $this->addToAssertionCount(1);
    }

    private function largestRecord(): int
    {
        $largest = 0;
        foreach (glob($this->dir . '/*.json') ?: [] as $path) {
            $file = json_decode((string) file_get_contents($path), true);
            $data = is_array($file) ? json_decode((string) ($file['data'] ?? ''), true) : null;
            $largest = max($largest, is_array($data) && is_array($data['hits'] ?? null) ? count($data['hits']) : 0);
        }

        return $largest;
    }

    public function testRetryAfterIsTheRemainingWindow(): void
    {
        $this->hits(AddressLimit::Login, '192.0.2.1', 30);
        $this->clock->advance(20);
        $e = $this->assertRefused(fn() => $this->limiter->hit(AddressLimit::Login, '192.0.2.1'));
        self::assertSame(40, $e->retryAfterSeconds);
        self::assertStringContainsString('40 seconds', $e->getMessage());
        self::assertStringNotContainsString('192.0.2.1', $e->getMessage());
    }

    public function testRejectedTokenLimitIsSixty(): void
    {
        $this->hits(AddressLimit::RejectedToken, '192.0.2.1', 60);
        $this->assertRefused(fn() => $this->limiter->hit(AddressLimit::RejectedToken, '192.0.2.1'));
    }

    public function testLimitsAreIndependent(): void
    {
        $this->hits(AddressLimit::Login, '192.0.2.1', 30);
        $this->limiter->hit(AddressLimit::RejectedToken, '192.0.2.1');
        $this->limiter->assertOpen(AddressLimit::RejectedToken, '192.0.2.1');
        $this->addToAssertionCount(1);
    }

    public function testIpv6SameSlash64SharesTheCount(): void
    {
        $this->hits(AddressLimit::Login, '2001:db8::1', 30);
        $this->assertRefused(fn() => $this->limiter->hit(AddressLimit::Login, '2001:db8::ffff'));
    }

    public function testIpv6OtherSlash64DoesNot(): void
    {
        $this->hits(AddressLimit::Login, '2001:db8::1', 30);
        $this->limiter->hit(AddressLimit::Login, '2001:db8:0:1::1');
        $this->addToAssertionCount(1);
    }

    public function testIpv4MappedCountsAsIpv4(): void
    {
        $this->hits(AddressLimit::Login, '192.0.2.7', 30);
        $this->assertRefused(fn() => $this->limiter->hit(AddressLimit::Login, '::ffff:192.0.2.7'));
    }

    public function testNetworkNormalisation(): void
    {
        self::assertSame('192.0.2.7', FileAddressLimiter::network('192.0.2.7'));
        self::assertSame('192.0.2.7', FileAddressLimiter::network('::ffff:192.0.2.7'));
        self::assertSame('20010db800000000/64', FileAddressLimiter::network('2001:db8::1'));
        self::assertSame('unknown', FileAddressLimiter::network(''));
        self::assertSame('unknown', FileAddressLimiter::network('not-an-address'));
    }

    public function testBucketCountIsBounded(): void
    {
        for ($i = 0; $i < 1000; $i++) {
            $this->limiter->hit(AddressLimit::RejectedToken, implode('.', [random_int(1, 223), random_int(0, 255), random_int(0, 255), random_int(1, 254)]));
        }
        self::assertLessThanOrEqual(2 * FileAddressLimiter::BUCKETS, count(glob($this->dir . '/*') ?: []));
    }

    public function testAssertOpenNeverCounts(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $this->limiter->assertOpen(AddressLimit::Login, '192.0.2.1');
        }
        $this->hits(AddressLimit::Login, '192.0.2.1', 29);
        $this->limiter->assertOpen(AddressLimit::Login, '192.0.2.1');
        $this->limiter->hit(AddressLimit::Login, '192.0.2.1');
        $this->assertRefused(fn() => $this->limiter->assertOpen(AddressLimit::Login, '192.0.2.1'));
    }

    public function testTheRecordStaysBounded(): void
    {
        $this->hits(AddressLimit::RejectedToken, '192.0.2.1', 30);
        $this->clock->advance(61);
        $this->limiter->hit(AddressLimit::RejectedToken, '192.0.2.1');
        $stored = '';
        foreach (glob($this->dir . '/*.json') ?: [] as $file) {
            $stored .= (string) file_get_contents($file);
        }
        self::assertSame(1, substr_count($stored, (string) $this->clock->now()->getTimestamp()));
    }

    public function testUnusableStoreFailsClosed(): void
    {
        $file = sys_get_temp_dir() . '/ctps-addr-file-' . bin2hex(random_bytes(4));
        file_put_contents($file, 'x');
        try {
            $this->expectException(ConfigurationException::class);
            $this->limiter($file . '/sub')->hit(AddressLimit::RejectedToken, '192.0.2.1');
        } finally {
            @unlink($file);
        }
    }
}
