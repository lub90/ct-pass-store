<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Application\Auth;

use CtPassStore\Application\Auth\MachineTokens;
use CtPassStore\Application\Exception\ConfigurationException;
use CtPassStore\Application\Exception\InvalidTokenException;
use CtPassStore\Application\Exception\TokenExpiredException;
use CtPassStore\Application\Port\SettingsRepository;
use CtPassStore\Domain\MachineClient;
use CtPassStore\Domain\Settings;
use CtPassStore\Infrastructure\Auth\FileReplayCache;
use CtPassStore\Infrastructure\Auth\FirebaseTokenCodec;
use CtPassStore\Infrastructure\Store\SignedFileStore;
use CtPassStore\Tests\Support\FrozenClock;
use Firebase\JWT\JWT;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;

/**
 * Catalog MC-01 to MC-22 (spec 4.4a).
 */
final class MachineTokensTest extends TestCase
{
    private const BACKEND_URL = 'https://backend.example.org/ctpassstore';

    private FrozenClock $clock;
    private string $cacheDir;

    /** @var array<string, string> secret keys (sodium format) by name */
    private array $secretKeys = [];

    /** @var array<string, string> raw public keys by name */
    private array $publicKeys = [];

    private Settings $settings;

    protected function setUp(): void
    {
        $this->clock = new FrozenClock();
        $this->cacheDir = sys_get_temp_dir() . '/ctps-mc-' . bin2hex(random_bytes(6));
        foreach (['radius-1', 'radius-2', 'other', 'attacker'] as $name) {
            $pair = sodium_crypto_sign_keypair();
            $this->secretKeys[$name] = sodium_crypto_sign_secretkey($pair);
            $this->publicKeys[$name] = sodium_crypto_sign_publickey($pair);
        }
        $this->useClients([
            new MachineClient('ct-radius', 'WiFi RADIUS', [$this->publicKeys['radius-1'], $this->publicKeys['radius-2']], [MachineClient::PERMISSION_READ_ENTRIES]),
            new MachineClient('other-client', 'Other', [$this->publicKeys['other']], [MachineClient::PERMISSION_READ_ENTRIES]),
            new MachineClient('no-rights', 'No rights', [$this->publicKeys['other']], []),
        ]);
    }

    protected function tearDown(): void
    {
        foreach (glob($this->cacheDir . '/*') ?: [] as $file) {
            @chmod($file, 0o600);
            @unlink($file);
        }
        @chmod($this->cacheDir, 0o700);
        @rmdir($this->cacheDir);
    }

    /**
     * @param list<MachineClient> $clients
     */
    private function useClients(array $clients, ?string $backendUrl = self::BACKEND_URL): void
    {
        $byId = [];
        foreach ($clients as $client) {
            $byId[$client->id] = $client;
        }
        $this->settings = new Settings(true, true, 16, [], $backendUrl, $byId);
    }

    private function verifier(?string $cacheDir = null): MachineTokens
    {
        $settings = new class ($this) implements SettingsRepository {
            public function __construct(private readonly MachineTokensTest $test) {}

            public function settings(): Settings
            {
                return $this->test->currentSettings();
            }
        };

        return new MachineTokens($settings, new FileReplayCache(new SignedFileStore($cacheDir ?? $this->cacheDir, str_repeat('s', 40), new NullLogger())), $this->clock, new FirebaseTokenCodec());
    }

    public function currentSettings(): Settings
    {
        return $this->settings;
    }

    /**
     * Valid claims for ct-radius at the clock's current time; a null override removes the claim.
     *
     * @param array<string, mixed> $overrides
     * @return array<string, mixed>
     */
    private function claims(array $overrides = []): array
    {
        $now = $this->clock->timestamp();

        return array_filter(array_merge([
            'iss' => 'ct-radius',
            'sub' => 'ct-radius',
            'aud' => self::BACKEND_URL,
            'iat' => $now,
            'exp' => $now + 60,
            'jti' => bin2hex(random_bytes(16)),
        ], $overrides), static fn(mixed $v): bool => $v !== null);
    }

    /**
     * @param array<string, mixed> $claims
     * @param array<string, mixed>|null $head
     */
    private function sign(array $claims, string $key = 'radius-1', ?string $kid = 'ct-radius', ?array $head = null): string
    {
        return JWT::encode($claims, base64_encode($this->secretKeys[$key]), 'EdDSA', $kid, $head);
    }

    private function assertInvalid(string $token): void
    {
        try {
            $this->verifier()->verify($token);
            self::fail('Expected an invalid token.');
        } catch (InvalidTokenException $e) {
            self::assertSame('The access token is invalid.', $e->getMessage());
        }
    }

    // ---------------------------------------------------------------- MC-01, MC-02, MC-14, MC-11, MC-21

    public function testAValidTokenYieldsTheClientWithItsPermissions(): void
    {
        $principal = $this->verifier()->verify($this->sign($this->claims()));

        self::assertSame('ct-radius', $principal->clientId);
        self::assertSame([MachineClient::PERMISSION_READ_ENTRIES], $principal->permissions);
    }

    public function testEachOfTheClientsKeysIsAccepted(): void
    {
        self::assertSame('ct-radius', $this->verifier()->verify($this->sign($this->claims(), 'radius-1'))->clientId);
        self::assertSame('ct-radius', $this->verifier()->verify($this->sign($this->claims(), 'radius-2'))->clientId);
    }

    public function testARemovedKeyIsRejectedWhileTheOtherKeepsWorking(): void
    {
        $this->useClients([new MachineClient('ct-radius', 'WiFi RADIUS', [$this->publicKeys['radius-2']], [MachineClient::PERMISSION_READ_ENTRIES])]);

        $this->assertInvalid($this->sign($this->claims(), 'radius-1'));
        self::assertSame('ct-radius', $this->verifier()->verify($this->sign($this->claims(), 'radius-2'))->clientId);
    }

    public function testARemovedOrDisabledClientIsRejected(): void
    {
        $token = $this->sign($this->claims());
        // A disabled client (invalid settings entry) is simply not among the enabled ones, like a removed one.
        $this->useClients([new MachineClient('other-client', 'Other', [$this->publicKeys['other']], [])]);

        $this->assertInvalid($token);
    }

    // ---------------------------------------------------------------- MC-03, MC-04, MC-05, MC-06, MC-12, MC-18

    public function testUnregisteredOrForeignKeysAreRejected(): void
    {
        $this->assertInvalid($this->sign($this->claims(), 'attacker'));
        $this->assertInvalid($this->sign($this->claims(), 'other')); // another client's key
    }

    public function testAnUnknownKidIsRejected(): void
    {
        $this->assertInvalid($this->sign($this->claims(['iss' => 'unknown', 'sub' => 'unknown']), kid: 'unknown'));
        $this->assertInvalid($this->sign($this->claims(), kid: 'CT-RADIUS'));
    }

    public function testIssAndSubMustBeTheKid(): void
    {
        $this->assertInvalid($this->sign($this->claims(['iss' => 'other-client'])));
        $this->assertInvalid($this->sign($this->claims(['sub' => 'other-client'])));
        $this->assertInvalid($this->sign($this->claims(['sub' => '123'])));
    }

    /**
     * MC-22: aud normalization.
     */
    #[DataProvider('audiences')]
    public function testAudience(string $aud, bool $accepted): void
    {
        $token = $this->sign($this->claims(['aud' => $aud]));

        if ($accepted) {
            self::assertSame('ct-radius', $this->verifier()->verify($token)->clientId);
        } else {
            $this->assertInvalid($token);
        }
    }

    /**
     * @return iterable<string, array{string, bool}>
     */
    public static function audiences(): iterable
    {
        yield 'exact' => [self::BACKEND_URL, true];
        yield 'trailing slash' => [self::BACKEND_URL . '/', true];
        yield 'http' => ['http://backend.example.org/ctpassstore', false];
        yield 'path case' => ['https://backend.example.org/CtPassStore', false];
        yield 'other port' => ['https://backend.example.org:8443/ctpassstore', false];
        yield 'longer path' => [self::BACKEND_URL . '/x', false];
        yield 'host only' => ['https://backend.example.org', false];
        yield 'another backend' => ['https://other-backend.example.org/ctpassstore', false];
        yield 'empty' => ['', false];
    }

    public function testAudAsListIsRejected(): void
    {
        $this->assertInvalid($this->sign($this->claims(['aud' => [self::BACKEND_URL]])));
    }

    public function testKeyConfusionWithHs256AndAClientKidIsRejected(): void
    {
        // MC-12: the public key used as an HMAC secret.
        $token = JWT::encode($this->claims(), str_repeat($this->publicKeys['radius-1'], 2), 'HS256', 'ct-radius');

        $this->assertInvalid($token);
    }

    public function testKeysEmbeddedInTheHeaderAreNeverUsed(): void
    {
        $attackerKey = rtrim(strtr(base64_encode($this->publicKeys['attacker']), '+/', '-_'), '=');
        $head = ['jwk' => ['kty' => 'OKP', 'crv' => 'Ed25519', 'x' => $attackerKey], 'jku' => 'https://evil.example/jwks', 'x5u' => 'https://evil.example/cert', 'x5c' => ['MIIB']];

        $this->assertInvalid($this->sign($this->claims(), 'attacker', head: $head));
        self::assertSame('ct-radius', $this->verifier()->verify($this->sign($this->claims(), 'radius-1', head: $head))->clientId);
    }

    public function testATokenWithCritIsRejected(): void
    {
        $this->assertInvalid($this->sign($this->claims(), head: ['crit' => ['exp']]));
    }

    public function testAnEdDsaTokenWithoutKidIsRejected(): void
    {
        $this->assertInvalid($this->sign($this->claims(), kid: null));
    }

    // ---------------------------------------------------------------- MC-07, MC-08, MC-16, MC-15

    public function testLifetimeOfAtMost300Seconds(): void
    {
        $now = $this->clock->timestamp();

        self::assertSame('ct-radius', $this->verifier()->verify($this->sign($this->claims(['exp' => $now + 300])))->clientId);
        $this->assertInvalid($this->sign($this->claims(['exp' => $now + 301])));
    }

    public function testNonPositiveLifetimesAreRejected(): void
    {
        $now = $this->clock->timestamp();

        $this->assertInvalid($this->sign($this->claims(['exp' => $now])));
        $this->assertInvalid($this->sign($this->claims(['exp' => $now - 1])));
    }

    public function testIatAllowsThirtySecondsOfClockSkew(): void
    {
        $now = $this->clock->timestamp();

        self::assertSame('ct-radius', $this->verifier()->verify($this->sign($this->claims(['iat' => $now + 29, 'exp' => $now + 89])))->clientId);
        $this->assertInvalid($this->sign($this->claims(['iat' => $now + 31, 'exp' => $now + 91])));
    }

    public function testExpAllowsThirtySecondsOfClockSkew(): void
    {
        $now = $this->clock->timestamp();

        self::assertSame('ct-radius', $this->verifier()->verify($this->sign($this->claims(['iat' => $now - 89, 'exp' => $now - 29])))->clientId);

        $this->expectException(TokenExpiredException::class);
        $this->verifier()->verify($this->sign($this->claims(['iat' => $now - 91, 'exp' => $now - 31])));
    }

    public function testAnExpiredTokenWithABadSignatureIsInvalidNotExpired(): void
    {
        $now = $this->clock->timestamp();

        $this->assertInvalid($this->sign($this->claims(['iat' => $now - 400, 'exp' => $now - 340]), 'attacker'));
    }

    public function testAnExpiredTokenWithAWrongAudIsInvalidNotExpired(): void
    {
        $now = $this->clock->timestamp();

        $this->assertInvalid($this->sign($this->claims(['iat' => $now - 400, 'exp' => $now - 340, 'aud' => 'https://other.example'])));
    }

    #[DataProvider('requiredClaims')]
    public function testEveryClaimIsRequired(string $claim): void
    {
        $this->assertInvalid($this->sign($this->claims([$claim => null])));
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function requiredClaims(): iterable
    {
        foreach (['iss', 'sub', 'aud', 'iat', 'exp', 'jti'] as $claim) {
            yield $claim => [$claim];
        }
    }

    public function testShortOrHugeJtisAreRejected(): void
    {
        $this->assertInvalid($this->sign($this->claims(['jti' => 'short'])));
        $this->assertInvalid($this->sign($this->claims(['jti' => str_repeat('a', 129)])));
        $this->assertInvalid($this->sign($this->claims(['jti' => 12345678901234567])));
    }

    // ---------------------------------------------------------------- MC-09, MC-10, MC-17, MC-19, MC-20

    public function testTheSameTokenIsAcceptedOnlyOnce(): void
    {
        $token = $this->sign($this->claims());

        self::assertSame('ct-radius', $this->verifier()->verify($token)->clientId);
        $this->assertInvalid($token);
    }

    public function testTheSameJtiInAnotherTokenOfTheSameClientIsRejected(): void
    {
        $jti = bin2hex(random_bytes(16));
        $this->verifier()->verify($this->sign($this->claims(['jti' => $jti]), 'radius-1'));

        $this->assertInvalid($this->sign($this->claims(['jti' => $jti, 'exp' => $this->clock->timestamp() + 61]), 'radius-2'));
    }

    /**
     * TR-04: the same token sent in parallel is accepted at most once. Real processes, started together at a barrier,
     * share one replay cache, as PHP workers do.
     */
    public function testTheSameTokenInParallelIsAcceptedOnlyOnce(): void
    {
        if (!function_exists('pcntl_fork') || !function_exists('posix_kill')) {
            self::markTestSkipped('pcntl and posix are needed for real parallel processes.');
        }
        $token = $this->sign($this->claims());
        $results = sys_get_temp_dir() . '/ctps-tr04-' . bin2hex(random_bytes(6));
        mkdir($results);
        $go = $results . '/go';
        $children = [];

        for ($i = 0; $i < 8; $i++) {
            $pid = pcntl_fork();
            self::assertNotSame(-1, $pid);
            if ($pid === 0) {
                while (!file_exists($go)) {
                    usleep(1000);
                }
                try {
                    $this->verifier()->verify($token);
                    $outcome = 'accepted';
                } catch (InvalidTokenException) {
                    $outcome = 'replay';
                } catch (\Throwable $e) {
                    $outcome = 'error: ' . $e::class;
                }
                file_put_contents("$results/$i", $outcome);
                // Ends the child without running PHPUnit's shutdown code.
                posix_kill(getmypid(), SIGKILL);
            }
            $children[] = $pid;
        }
        touch($go);
        foreach ($children as $pid) {
            pcntl_waitpid($pid, $status);
        }

        $outcomes = [];
        for ($i = 0; $i < 8; $i++) {
            $outcomes[] = (string) @file_get_contents("$results/$i");
            @unlink("$results/$i");
        }
        @unlink($go);
        @rmdir($results);

        sort($outcomes);
        self::assertSame(array_merge(['accepted'], array_fill(0, 7, 'replay')), $outcomes);
    }

    // ---------------------------------------------------------------- RX-05

    public function testExpiredJtisAreRemovedFromTheReplayCache(): void
    {
        for ($i = 0; $i < 50; $i++) {
            $this->verifier()->verify($this->sign($this->claims()));
        }
        self::assertSame(50, $this->storedJtis());

        $this->clock->advance(60 + 31);
        $this->verifier()->verify($this->sign($this->claims()));

        self::assertSame(1, $this->storedJtis(), 'Only the token that can still be valid is kept.');
    }

    public function testInvalidTokensCreateNoCacheFiles(): void
    {
        foreach (['unknown-1', 'unknown-2', 'ct-radius'] as $kid) {
            try {
                $this->verifier()->verify($this->sign($this->claims(['iss' => $kid, 'sub' => $kid]), 'attacker', $kid));
            } catch (InvalidTokenException) {
            }
        }

        self::assertSame([], glob($this->cacheDir . '/*.json') ?: [], 'Unauthenticated requests can\'t fill the disk.');
    }

    private function storedJtis(): int
    {
        $files = glob($this->cacheDir . '/*.json') ?: [];
        self::assertCount(1, $files);
        $file = json_decode((string) file_get_contents($files[0]), true);
        self::assertIsArray($file);
        $data = json_decode((string) $file['data'], true);
        self::assertIsArray($data);

        return count($data);
    }

    public function testTwoJtisInTheSameSecondAreBothAccepted(): void
    {
        $first = $this->verifier()->verify($this->sign($this->claims()));
        $second = $this->verifier()->verify($this->sign($this->claims()));

        self::assertSame(['ct-radius', 'ct-radius'], [$first->clientId, $second->clientId]);
    }

    public function testAJtiIsRecordedOnlyAfterFullVerification(): void
    {
        $jti = bin2hex(random_bytes(16));
        $now = $this->clock->timestamp();
        $this->assertInvalid($this->sign($this->claims(['jti' => $jti]), 'attacker'));
        $this->assertInvalid($this->sign($this->claims(['jti' => $jti, 'aud' => 'https://other.example'])));
        try {
            $this->verifier()->verify($this->sign($this->claims(['jti' => $jti, 'iat' => $now - 100, 'exp' => $now - 40])));
            self::fail('Expected an expired token.');
        } catch (TokenExpiredException) {
        }

        self::assertSame('ct-radius', $this->verifier()->verify($this->sign($this->claims(['jti' => $jti])))->clientId);
    }

    public function testTwoClientsMayUseTheSameJti(): void
    {
        $jti = bin2hex(random_bytes(16));
        $this->verifier()->verify($this->sign($this->claims(['jti' => $jti])));

        $other = $this->sign($this->claims(['iss' => 'other-client', 'sub' => 'other-client', 'jti' => $jti]), 'other', 'other-client');
        self::assertSame('other-client', $this->verifier()->verify($other)->clientId);
    }

    public function testAJtiIsForgottenOnlyAfterTheTokenCanNoLongerBeValid(): void
    {
        $now = $this->clock->timestamp();
        $token = $this->sign($this->claims(['exp' => $now + 60]));
        $this->verifier()->verify($token);

        // At exp + 29 the token would still pass the expiry check, so the replay must still be caught.
        $this->clock->advance(60 + 29);
        $this->assertInvalid($token);
    }

    public function testAnUnusableReplayCacheRejectsMachineRequests(): void
    {
        $file = (string) tempnam(sys_get_temp_dir(), 'ctps-not-a-dir-');
        try {
            $this->expectException(ConfigurationException::class);
            $this->verifier($file . '/cache')->verify($this->sign($this->claims()));
        } finally {
            @unlink($file);
        }
    }

    public function testWithoutBackendUrlMachineAuthenticationFailsClosed(): void
    {
        $this->useClients($this->clientsOf($this->settings), null);

        $this->expectException(ConfigurationException::class);
        $this->verifier()->verify($this->sign($this->claims(['aud' => ''])));
    }

    public function testAClientWithoutPermissionsAuthenticatesButGetsNoRights(): void
    {
        $token = $this->sign($this->claims(['iss' => 'no-rights', 'sub' => 'no-rights']), 'other', 'no-rights');

        self::assertSame([], $this->verifier()->verify($token)->permissions);
    }

    /**
     * @return list<MachineClient>
     */
    private function clientsOf(Settings $settings): array
    {
        return array_values($settings->machineClients);
    }
}
