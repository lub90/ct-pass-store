<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Load\Helpers;

use GuzzleHttp\Client;
use GuzzleHttp\Exception\TransferException;
use GuzzleHttp\RequestOptions;

/**
 * Direct, strictly sequential calls to the ChurchTools test instance for the load test's setup and teardown, with a
 * login token per call. Paced to stay well below the rate limit of about 600 requests per minute (spec 6.2); on 429 it
 * waits for Retry-After, on a timeout or connection error it waits and tries again. Every such event is recorded.
 *
 * Tokens and the instance URL never appear in what this class records or throws.
 */
final class ChurchToolsCalls
{
    /** At most about 400 requests per minute from here; the backend under test shares the address. */
    private const MIN_GAP_SECONDS = 0.15;

    private const MAX_ATTEMPTS = 5;

    private Client $http;

    private float $lastCall = 0.0;

    /** @var list<string> rate-limit and timeout events, without secrets */
    public array $events = [];

    public function __construct(string $apiUrl)
    {
        $this->http = new Client([
            'base_uri' => rtrim($apiUrl, '/') . '/',
            RequestOptions::HTTP_ERRORS => false,
            RequestOptions::TIMEOUT => 30,
            RequestOptions::CONNECT_TIMEOUT => 10,
        ]);
    }

    /**
     * @param array<string, mixed>|null $json
     * @return array{status: int, body: array<mixed>|null, bytes: int, ms: float}
     */
    public function call(string $method, string $path, #[\SensitiveParameter] string $loginToken, ?array $json = null): array
    {
        $options = [RequestOptions::HEADERS => ['Accept' => 'application/json', 'Authorization' => 'Login ' . $loginToken]];
        if ($json !== null) {
            $options[RequestOptions::JSON] = $json;
        }
        $what = $method . ' ' . preg_replace('/\d+/', '{n}', explode('?', $path)[0]);

        for ($attempt = 1; ; $attempt++) {
            $this->pace();
            $start = hrtime(true);
            try {
                $response = $this->http->request($method, $path, $options);
            } catch (TransferException $e) {
                $this->events[] = sprintf('%s %s: no answer (%s), attempt %d', date('H:i:s'), $what, $e::class, $attempt);
                if ($attempt >= self::MAX_ATTEMPTS) {
                    throw new \RuntimeException("$what: ChurchTools didn't answer after $attempt attempts.");
                }
                sleep(5 * $attempt);

                continue;
            }
            $ms = (hrtime(true) - $start) / 1e6;
            $status = $response->getStatusCode();
            if ($status === 429 && $attempt < self::MAX_ATTEMPTS) {
                $wait = max(10, (int) $response->getHeaderLine('Retry-After'));
                $this->events[] = sprintf('%s %s: 429, waited %d s', date('H:i:s'), $what, $wait);
                sleep($wait);

                continue;
            }
            $raw = (string) $response->getBody();
            $body = $raw === '' ? null : json_decode($raw, true);

            return ['status' => $status, 'body' => is_array($body) ? $body : null, 'bytes' => strlen($raw), 'ms' => $ms];
        }
    }

    private function pace(): void
    {
        $gap = microtime(true) - $this->lastCall;
        if ($gap < self::MIN_GAP_SECONDS) {
            usleep((int) ((self::MIN_GAP_SECONDS - $gap) * 1e6));
        }
        $this->lastCall = microtime(true);
    }
}
