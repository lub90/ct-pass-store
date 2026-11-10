<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Application\Auth;

use CtPassStore\Application\Auth\UserTokens;
use CtPassStore\Application\Exception\InvalidTokenException;
use CtPassStore\Application\Exception\TokenExpiredException;
use CtPassStore\Domain\PersonId;
use CtPassStore\Domain\PersonPrincipal;
use CtPassStore\Infrastructure\Auth\FirebaseTokenCodec;
use CtPassStore\Tests\Support\FrozenClock;
use Firebase\JWT\JWT;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Catalog TK-01 to TK-16 (spec 4.3.3, 4.4).
 */
final class UserTokensTest extends TestCase
{
    private const SECRET = 'test-secret-with-at-least-32-bytes-0123456789';

    private FrozenClock $clock;
    private UserTokens $tokens;

    protected function setUp(): void
    {
        $this->clock = new FrozenClock();
        $this->tokens = new UserTokens(self::SECRET, $this->clock, new FirebaseTokenCodec());
    }

    private static function person(): PersonPrincipal
    {
        return new PersonPrincipal(new PersonId(5), 'jdoe');
    }

    /**
     * Valid claims at the clock's current time, with overrides; a null override removes the claim.
     *
     * @param array<string, mixed> $overrides
     * @return array<string, mixed>
     */
    private function claims(array $overrides = []): array
    {
        $now = $this->clock->timestamp();
        $claims = array_merge([
            'iss' => UserTokens::ISSUER,
            'aud' => UserTokens::AUDIENCE,
            'sub' => '5',
            'username' => 'jdoe',
            'iat' => $now,
            'nbf' => $now,
            'exp' => $now + 900,
            'jti' => 'abc',
        ], $overrides);

        return array_filter($claims, static fn(mixed $v): bool => $v !== null);
    }

    /**
     * @param array<string, mixed> $claims
     * @param array<string, mixed>|null $head
     */
    private static function sign(array $claims, string $secret = self::SECRET, string $alg = 'HS256', ?string $kid = null, ?array $head = null): string
    {
        return JWT::encode($claims, $secret, $alg, $kid, $head);
    }

    private static function b64(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    private function assertInvalid(string $token): void
    {
        try {
            $this->tokens->verify($token);
            self::fail('Expected an invalid token.');
        } catch (InvalidTokenException $e) {
            self::assertSame('The access token is invalid.', $e->getMessage(), 'No hint about what was wrong.');
        }
    }

    // ---------------------------------------------------------------- TK-01, TK-02

    public function testAnIssuedTokenValidatesAndYieldsThePerson(): void
    {
        $issued = $this->tokens->issue(self::person());

        $person = $this->tokens->verify($issued->token);

        self::assertSame(5, $person->id->value);
        self::assertSame('jdoe', $person->username);
        self::assertSame(900, $issued->expiresIn);
    }

    public function testIssuedTokenHasTheSpecifiedHeaderAndClaims(): void
    {
        $token = $this->tokens->issue(self::person())->token;
        [$head, $body] = explode('.', $token);
        $header = json_decode((string) base64_decode(strtr($head, '-_', '+/')), true);
        $claims = json_decode((string) base64_decode(strtr($body, '-_', '+/')), true);
        self::assertIsArray($header);
        self::assertIsArray($claims);

        self::assertSame('HS256', $header['alg']);
        self::assertArrayNotHasKey('kid', $header);
        $now = $this->clock->timestamp();
        self::assertSame('ctpassstore-backend', $claims['iss']);
        self::assertSame('ctpassstore-api', $claims['aud']);
        self::assertSame('5', $claims['sub'], 'sub is a string.');
        self::assertSame('jdoe', $claims['username']);
        self::assertSame($now, $claims['iat']);
        self::assertSame($now, $claims['nbf']);
        self::assertSame($now + 900, $claims['exp']);
        self::assertMatchesRegularExpression('/^[0-9a-f]{32}$/', $claims['jti']);
    }

    public function testEveryTokenGetsItsOwnJti(): void
    {
        $jtis = [];
        for ($i = 0; $i < 20; $i++) {
            $claims = json_decode((string) base64_decode(strtr(explode('.', $this->tokens->issue(self::person())->token)[1], '-_', '+/')), true);
            self::assertIsArray($claims);
            $jtis[] = $claims['jti'];
        }

        self::assertCount(20, array_unique($jtis));
    }

    // ---------------------------------------------------------------- TK-03, TK-04, TK-05, TK-12

    public function testAlgNoneIsRejected(): void
    {
        $unsigned = self::b64('{"alg":"none","typ":"JWT"}') . '.' . self::b64((string) json_encode($this->claims()));

        $this->assertInvalid($unsigned . '.');
        $this->assertInvalid($unsigned . '.' . explode('.', self::sign($this->claims()))[2]);
    }

    public function testATokenSignedWithAnotherSecretIsRejected(): void
    {
        $this->assertInvalid(self::sign($this->claims(), 'another-secret-with-at-least-32-bytes-012345'));
    }

    public function testAfterTheSecretChangesOldTokensAreRejected(): void
    {
        $token = $this->tokens->issue(self::person())->token;

        $this->expectException(InvalidTokenException::class);
        (new UserTokens('a-rotated-secret-with-at-least-32-bytes-0123', $this->clock, new FirebaseTokenCodec()))->verify($token);
    }

    public function testChangingAClaimWithoutResigningIsRejected(): void
    {
        [$head, , $signature] = explode('.', $this->tokens->issue(self::person())->token);
        $forged = self::b64((string) json_encode($this->claims(['sub' => '6'])));

        $this->assertInvalid("$head.$forged.$signature");
    }

    // ---------------------------------------------------------------- TK-06, TK-13

    /**
     * @param array<string, mixed> $overrides
     */
    #[DataProvider('badClaims')]
    public function testWrongOrMissingClaimsAreRejected(array $overrides): void
    {
        $this->assertInvalid(self::sign($this->claims($overrides)));
    }

    /**
     * @return iterable<string, array{array<string, mixed>}>
     */
    public static function badClaims(): iterable
    {
        yield 'wrong aud' => [['aud' => 'other-api']];
        yield 'aud as list' => [['aud' => ['ctpassstore-api']]];
        yield 'wrong iss' => [['iss' => 'https://evil.example']];
        foreach (['iss', 'aud', 'sub', 'username', 'iat', 'nbf', 'exp', 'jti'] as $claim) {
            yield "missing $claim" => [[$claim => null]];
        }
        yield 'empty sub' => [['sub' => '']];
        yield 'sub as number' => [['sub' => 5]];
        yield 'sub 0' => [['sub' => '0']];
        yield 'sub with leading zero' => [['sub' => '05']];
        yield 'negative sub' => [['sub' => '-5']];
        yield 'empty username' => [['username' => '']];
        yield 'empty jti' => [['jti' => '']];
        // TY-04, RX-04: claim types are never cast. A float or a numeric string would pass firebase/php-jwt's own checks.
        yield 'exp as string' => [['exp' => '9999999999']];
        yield 'exp as float' => [['exp' => 1.0e30]];
        yield 'iat as string' => [['iat' => '1']];
        yield 'nbf as float' => [['nbf' => 1.5]];
        yield 'sub above PHP_INT_MAX' => [['sub' => '9223372036854775808']];
        yield 'sub with whitespace' => [['sub' => ' 5']];
        yield 'username as number' => [['username' => 5]];
        yield 'jti as number' => [['jti' => 5]];
    }

    // ---------------------------------------------------------------- TK-07, TK-08, TK-15

    public function testExpiryAllowsThirtySecondsOfClockSkew(): void
    {
        $now = $this->clock->timestamp();

        self::assertSame(5, $this->tokens->verify(self::sign($this->claims(['iat' => $now - 929, 'nbf' => $now - 929, 'exp' => $now - 29])))->id->value);

        $this->expectException(TokenExpiredException::class);
        $this->tokens->verify(self::sign($this->claims(['iat' => $now - 931, 'nbf' => $now - 931, 'exp' => $now - 31])));
    }

    public function testNotBeforeAllowsThirtySecondsOfClockSkew(): void
    {
        $now = $this->clock->timestamp();

        self::assertSame(5, $this->tokens->verify(self::sign($this->claims(['nbf' => $now + 29])))->id->value);
        $this->assertInvalid(self::sign($this->claims(['nbf' => $now + 31])));
    }

    public function testABadSignatureOnAnExpiredTokenIsInvalidNotExpired(): void
    {
        $now = $this->clock->timestamp();

        $this->assertInvalid(self::sign($this->claims(['exp' => $now - 3600]), 'another-secret-with-at-least-32-bytes-012345'));
    }

    public function testAnExpiredTokenWithWrongClaimsIsInvalidNotExpired(): void
    {
        $now = $this->clock->timestamp();

        $this->assertInvalid(self::sign($this->claims(['exp' => $now - 3600, 'aud' => 'other-api'])));
    }

    public function testAnIssuedTokenExpiresAfterFifteenMinutes(): void
    {
        $token = $this->tokens->issue(self::person())->token;

        $this->clock->advance(900 + 29);
        self::assertSame(5, $this->tokens->verify($token)->id->value);

        $this->clock->advance(2);
        $this->expectException(TokenExpiredException::class);
        $this->tokens->verify($token);
    }

    // ---------------------------------------------------------------- TK-09, TK-10, TK-11, TK-16

    public function testAnHs256TokenWithAKidIsRejected(): void
    {
        $this->assertInvalid(self::sign($this->claims(), kid: 'ct-radius'));
    }

    public function testOtherAlgorithmsAreRejected(): void
    {
        $this->assertInvalid(self::sign($this->claims(), self::SECRET . self::SECRET, 'HS512'));

        $rsa = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
        self::assertNotFalse($rsa);
        self::assertTrue(openssl_pkey_export($rsa, $pem));
        $this->assertInvalid(self::sign($this->claims(), (string) $pem, 'RS256'));

        $ed = sodium_crypto_sign_keypair();
        $this->assertInvalid(self::sign($this->claims(), base64_encode(sodium_crypto_sign_secretkey($ed)), 'EdDSA'));
    }

    /**
     * TK-10: a ChurchTools OAuth access token (RS256, other claims) is not a backend token.
     */
    public function testAChurchToolsAccessTokenIsRejected(): void
    {
        $rsa = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
        self::assertNotFalse($rsa);
        self::assertTrue(openssl_pkey_export($rsa, $pem));
        $now = $this->clock->timestamp();
        $churchToolsToken = self::sign(['aud' => 'client-id', 'sub' => '5', 'scopes' => ['api'], 'iat' => $now, 'exp' => $now + 3600, 'jti' => 'x'], (string) $pem, 'RS256');

        $this->assertInvalid($churchToolsToken);
    }

    #[DataProvider('garbage')]
    public function testGarbageIsInvalidWithoutAPhpError(string $token): void
    {
        $this->assertInvalid($token);
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function garbage(): iterable
    {
        yield 'empty' => [''];
        yield 'one part' => ['abc'];
        yield 'two parts' => ['abc.def'];
        yield 'four parts' => ['a.b.c.d'];
        yield 'broken base64' => ['!!!.def.ghi'];
        yield 'header not JSON' => [self::b64('not json') . '.e30.sig'];
        yield 'header a list' => [self::b64('["HS256"]') . '.e30.sig'];
        yield 'alg not a string' => [self::b64('{"alg":1}') . '.e30.sig'];
        yield 'very long' => [str_repeat('a', 100_000) . '.b.c'];
        yield 'claims not JSON' => [self::b64('{"alg":"HS256","typ":"JWT"}') . '.' . self::b64('nope') . '.sig'];
    }

    public function testDeeplyNestedClaimsAreInvalidNotAnError(): void
    {
        $this->assertInvalid(self::sign($this->claims(['deep' => json_decode(str_repeat('[', 40) . str_repeat(']', 40))])));
    }

    /**
     * TY-04: a negative exp is simply long expired, never wrapped around into the future.
     */
    public function testANegativeExpIsExpired(): void
    {
        $this->expectException(TokenExpiredException::class);
        $this->tokens->verify(self::sign($this->claims(['iat' => -1000, 'nbf' => -1000, 'exp' => -100])));
    }

    /**
     * @return iterable<string, array{array<string, mixed>}>
     */
    public static function badKids(): iterable
    {
        yield 'kid as number' => [['kid' => 5]];
        yield 'kid as list' => [['kid' => ['a']]];
        yield 'kid empty' => [['kid' => '']];
    }

    /**
     * TY-04: any kid at all makes it no backend token, whatever its type.
     *
     * @param array<string, mixed> $head
     */
    #[DataProvider('badKids')]
    public function testTokensWithAnyKidAreRejected(array $head): void
    {
        $this->assertInvalid(self::sign($this->claims(), head: $head));
    }

    public function testATokenWithCritIsRejected(): void
    {
        $this->assertInvalid(self::sign($this->claims(), head: ['crit' => ['exp']]));
    }

    public function testEmbeddedKeysInTheHeaderAreIgnored(): void
    {
        // Signed with the right secret, so the extra header parameters must simply not matter.
        $token = self::sign($this->claims(), head: ['jwk' => ['kty' => 'oct', 'k' => 'YXR0YWNrZXI'], 'jku' => 'https://evil.example/keys', 'x5u' => 'https://evil.example/cert', 'x5c' => ['MIIBszCCAVmgAwIBAgIUQ']]);
        self::assertSame(5, $this->tokens->verify($token)->id->value);

        // Signed with the attacker's key named in jwk: rejected.
        $this->assertInvalid(self::sign($this->claims(), 'attacker-secret-with-at-least-32-bytes-01234', head: ['jwk' => ['kty' => 'oct', 'k' => self::b64('attacker-secret-with-at-least-32-bytes-01234')]]));
    }
}
