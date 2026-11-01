<?php

declare(strict_types=1);

namespace CtPassStore\Tests\EndToEnd;

use CtPassStore\Application\Port\SettingsRepository;
use CtPassStore\Domain\MachineClient;
use CtPassStore\Domain\Settings;
use CtPassStore\Infrastructure\Auth\MachineTokenVerifier;
use CtPassStore\Infrastructure\Auth\ReplayGuard;
use CtPassStore\Infrastructure\Store\SignedFileStore;
use CtPassStore\Infrastructure\Time\SystemClock;
use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;

/**
 * Catalog MC-13: a token signed with Node.js's crypto module, as ct-radius will sign it, passes the PHP verifier.
 * Needs `node` on the PATH; skipped otherwise.
 */
final class NodeSignedMachineTokenTest extends TestCase
{
    private const BACKEND_URL = 'https://backend.example.org/ctpassstore';

    private const SIGNER = <<<'JS'
        const crypto = require('crypto');
        const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
        const b64u = (data) => Buffer.from(data).toString('base64url');
        const now = Math.floor(Date.now() / 1000);
        const header = b64u(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid: 'ct-radius' }));
        const claims = b64u(JSON.stringify({
            iss: 'ct-radius', sub: 'ct-radius', aud: process.argv[1],
            iat: now, exp: now + 60, jti: crypto.randomBytes(16).toString('hex'),
        }));
        const signature = b64u(crypto.sign(null, Buffer.from(header + '.' + claims), privateKey));
        console.log(JSON.stringify({ publicKey: publicKey.export({ format: 'jwk' }).x, token: header + '.' + claims + '.' + signature }));
        JS;

    public function testANodeSignedTokenIsAccepted(): void
    {
        exec('command -v node', $found, $status);
        if ($status !== 0) {
            self::markTestSkipped('node is not installed.');
        }

        exec(sprintf('node -e %s %s', escapeshellarg(self::SIGNER), escapeshellarg(self::BACKEND_URL)), $output, $status);
        self::assertSame(0, $status);
        $signed = json_decode(implode('', $output), true, 4, JSON_THROW_ON_ERROR);
        self::assertIsArray($signed);

        $key = base64_decode(strtr((string) $signed['publicKey'], '-_', '+/'), true);
        self::assertIsString($key);
        $settings = new Settings(true, true, 16, [], [], self::BACKEND_URL, [
            'ct-radius' => new MachineClient('ct-radius', 'WiFi RADIUS', [$key], [MachineClient::PERMISSION_READ_ENTRIES]),
        ]);
        $repository = new class ($settings) implements SettingsRepository {
            public function __construct(private readonly Settings $settings) {}

            public function settings(): Settings
            {
                return $this->settings;
            }
        };
        $cacheDir = sys_get_temp_dir() . '/ctps-node-' . bin2hex(random_bytes(6));
        $verifier = new MachineTokenVerifier($repository, new ReplayGuard(new SignedFileStore($cacheDir, str_repeat('s', 40), new NullLogger())), new SystemClock());

        try {
            self::assertSame('ct-radius', $verifier->verify((string) $signed['token'])->clientId);
        } finally {
            array_map('unlink', glob($cacheDir . '/*') ?: []);
            @rmdir($cacheDir);
        }
    }
}
