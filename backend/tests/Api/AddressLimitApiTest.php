<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Api;

use CtPassStore\Http\Problem\ProblemType;
use CtPassStore\Infrastructure\ChurchTools\Exception\RateLimitedException;
use Firebase\JWT\JWT;
use Psr\Http\Message\ResponseInterface;

/**
 * The per-address limit on logins and rejected tokens (spec 6.3, 4.1, 6.2; catalog RX-06, review focus 3).
 */
final class AddressLimitApiTest extends ApiTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->churchTools->setOAuthClient(self::OAUTH_CLIENT_ID, self::OAUTH_CLIENT_SECRET);
    }

    private function login(): ResponseInterface
    {
        // Wrong code: the exchange fails, but only after the limit let the request through.
        return $this->request('POST', '/v1/auth/token', null, ['code' => 'c', 'codeVerifier' => 'v', 'redirectUri' => 'https://example.church.tools/ccm/ctpassstore/']);
    }

    private function withToken(string $token): ResponseInterface
    {
        return $this->request('GET', '/v1/test', null, null, ['Authorization' => 'Bearer ' . $token]);
    }

    private function forgedHs256(): string
    {
        return JWT::encode(['sub' => '1', 'exp' => time() + 60], str_repeat('x', 40), 'HS256');
    }

    public function testThirtyLoginsFromOneAddressPass(): void
    {
        for ($i = 0; $i < 30; $i++) {
            self::assertNotSame(429, $this->login()->getStatusCode(), "login $i");
        }
    }

    public function testTheThirtyFirstLoginGets429WithRetryAfter(): void
    {
        for ($i = 0; $i < 30; $i++) {
            $this->login();
        }
        $this->clock->advance(10);

        $response = $this->login();

        $body = $this->assertProblem(ProblemType::TooManyAttempts, $response);
        self::assertSame('50', $response->getHeaderLine('Retry-After'));
        self::assertSame(50, $body['retryAfter']);
        self::assertTrue($this->log->hasWarningThatContains('Too many login attempts'), 'The refusal is logged.');
    }

    public function testABlockedLoginCostsNoChurchToolsCall(): void
    {
        for ($i = 0; $i < 30; $i++) {
            $this->login();
        }
        $calls = count($this->churchTools->calls());

        $this->assertProblem(ProblemType::TooManyAttempts, $this->login());

        self::assertSame($calls, count($this->churchTools->calls()));
    }

    public function testForgedTokensCostNoChurchToolsCallWithWarmCache(): void
    {
        self::assertSame(200, $this->request('GET', '/v1/test', self::ADMIN)->getStatusCode());
        $calls = count($this->churchTools->calls());

        $this->assertProblem(ProblemType::MissingToken, $this->request('GET', '/v1/test'));
        $this->assertProblem(ProblemType::InvalidToken, $this->withToken($this->forgedHs256()));
        $eddsa = JWT::encode(['iss' => 'x', 'exp' => time() + 60], base64_encode(sodium_crypto_sign_secretkey(sodium_crypto_sign_keypair())), 'EdDSA', 'unknown-kid');
        $this->assertProblem(ProblemType::InvalidToken, $this->withToken($eddsa));

        self::assertSame($calls, count($this->churchTools->calls()), 'RX-06: forged tokens cost no ChurchTools call.');
    }

    public function testTheSixtyFirstRejectedTokenGets429(): void
    {
        for ($i = 0; $i < 60; $i++) {
            $this->assertProblem(ProblemType::InvalidToken, $this->withToken($this->forgedHs256()));
        }

        $response = $this->withToken($this->forgedHs256());

        $body = $this->assertProblem(ProblemType::TooManyAttempts, $response);
        self::assertSame('60', $response->getHeaderLine('Retry-After'));
        self::assertSame(60, $body['retryAfter']);
    }

    public function testMissingTokensAreNotCounted(): void
    {
        for ($i = 0; $i < 70; $i++) {
            $this->assertProblem(ProblemType::MissingToken, $this->request('GET', '/v1/test'));
        }

        $this->assertProblem(ProblemType::InvalidToken, $this->withToken($this->forgedHs256()));
    }

    public function testExpiredTokensAreNotCounted(): void
    {
        $expired = $this->tokenOf(self::ADMIN);
        $this->clock->advance(900 + 31);

        for ($i = 0; $i < 70; $i++) {
            $this->assertProblem(ProblemType::TokenExpired, $this->withToken($expired));
        }

        $this->assertProblem(ProblemType::InvalidToken, $this->withToken($this->forgedHs256()));
    }

    public function testMalformedAuthorizationHeadersCountAsRejectedTokens(): void
    {
        for ($i = 0; $i < 60; $i++) {
            $this->assertProblem(ProblemType::InvalidToken, $this->request('GET', '/v1/test', null, null, ['Authorization' => 'Basic eDp5']));
        }

        $response = $this->request('GET', '/v1/test', null, null, ['Authorization' => 'Bearer a,b']);

        $this->assertProblem(ProblemType::TooManyAttempts, $response);
        self::assertSame('60', $response->getHeaderLine('Retry-After'));
    }

    /**
     * Spec 6.2: with a cold cache and ChurchTools rate limiting, forged EdDSA tokens ask ChurchTools once.
     */
    public function testForgedTokensDuringAnOutageAskChurchToolsOnce(): void
    {
        $this->forgetCache();
        $this->churchTools->failNext('getValues', new RateLimitedException('429', 60));
        $eddsa = JWT::encode(['iss' => 'x', 'exp' => time() + 60], base64_encode(sodium_crypto_sign_secretkey(sodium_crypto_sign_keypair())), 'EdDSA', 'unknown-kid');

        for ($i = 0; $i < 20; $i++) {
            $this->withToken($eddsa);
        }

        self::assertSame(1, $this->churchTools->countCalls(['getValues']));
    }

    public function testAValidTokenIsNeverRefusedByTheAddressLimit(): void
    {
        for ($i = 0; $i < 61; $i++) {
            $this->withToken($this->forgedHs256());
        }

        self::assertSame(200, $this->request('GET', '/v1/test', self::ADMIN)->getStatusCode());
        self::assertNotContains($this->request('GET', '/v1/entries/' . self::USER, self::READER_CLIENT)->getStatusCode(), [401, 429]);
    }

    public function testTheGlobalLoginCapRefusesTheHundredFirstLogin(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $this->clientIp = sprintf('198.51.%d.%d', intdiv($i, 20), $i % 20 + 1);
            self::assertNotSame(429, $this->login()->getStatusCode(), "login $i");
        }
        $this->clientIp = '192.0.2.200';
        $calls = count($this->churchTools->calls());

        $this->assertProblem(ProblemType::TooManyAttempts, $this->login());

        self::assertSame($calls, count($this->churchTools->calls()));
    }

    public function testOtherAddressesAreUnaffected(): void
    {
        for ($i = 0; $i < 31; $i++) {
            $this->login();
        }
        for ($i = 0; $i < 61; $i++) {
            $this->withToken($this->forgedHs256());
        }

        $this->clientIp = '192.0.2.99';

        self::assertNotSame(429, $this->login()->getStatusCode());
        $this->assertProblem(ProblemType::InvalidToken, $this->withToken($this->forgedHs256()));
    }
}
