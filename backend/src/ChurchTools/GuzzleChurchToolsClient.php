<?php

declare(strict_types=1);

namespace CtPassStore\ChurchTools;

use CtPassStore\ChurchTools\Exception\InvalidResponseException;
use CtPassStore\ChurchTools\Exception\NotAuthenticatedException;
use CtPassStore\ChurchTools\Exception\NotFoundException;
use CtPassStore\ChurchTools\Exception\NotPermittedException;
use CtPassStore\ChurchTools\Exception\RateLimitedException;
use CtPassStore\ChurchTools\Exception\ServiceCredentialRejectedException;
use CtPassStore\ChurchTools\Exception\UnavailableException;
use GuzzleHttp\Client;
use GuzzleHttp\ClientInterface;
use GuzzleHttp\Exception\GuzzleException;
use GuzzleHttp\RequestOptions;
use Psr\Http\Message\ResponseInterface;

/**
 * {@see ChurchToolsClient} on top of Guzzle (spec 5.6).
 *
 * - The base URL always ends with `/` and paths never start with `/`, so `/api` is never dropped.
 * - TLS verification stays on, redirects aren't followed, no cookies are kept.
 * - Authenticated calls send `X-OnlyAuthenticated: 1`, so ChurchTools answers 401 instead of anonymous data.
 * - No retries.
 */
final class GuzzleChurchToolsClient implements ChurchToolsClient
{
    public const DEFAULT_TIMEOUT_SECONDS = 5.0;
    public const MIN_RETRY_AFTER_SECONDS = 60;

    private const MODULE_KEY_PATTERN = '/^[a-z0-9-]{1,64}\z/';

    private readonly ClientInterface $http;

    /** @var \Closure(): int */
    private readonly \Closure $now;

    /**
     * @param string $apiUrl ChurchTools API base URL, e.g. `https://example.church.tools/api`
     * @param ClientInterface|null $http only for tests; must be configured like the default client
     * @param (\Closure(): int)|null $now current Unix time, only for tests
     */
    public function __construct(
        string $apiUrl,
        private readonly Credential $serviceUser,
        float $timeoutSeconds = self::DEFAULT_TIMEOUT_SECONDS,
        ?ClientInterface $http = null,
        ?\Closure $now = null,
    ) {
        $this->http = $http ?? new Client(self::guzzleOptions($apiUrl, $timeoutSeconds));
        $this->now = $now ?? static fn(): int => time();
    }

    /**
     * The Guzzle options this client relies on. Tests that inject their own Guzzle client use them too.
     *
     * @return array<string, mixed>
     */
    public static function guzzleOptions(string $apiUrl, float $timeoutSeconds = self::DEFAULT_TIMEOUT_SECONDS): array
    {
        return [
            'base_uri' => rtrim($apiUrl, '/') . '/',
            RequestOptions::TIMEOUT => $timeoutSeconds,
            RequestOptions::CONNECT_TIMEOUT => $timeoutSeconds,
            RequestOptions::VERIFY => true,
            RequestOptions::ALLOW_REDIRECTS => false,
            RequestOptions::COOKIES => false,
            RequestOptions::HTTP_ERRORS => false,
        ];
    }

    public function whoami(Credential $user): array
    {
        return $this->expectObject($this->data($this->send('GET', 'whoami', $user, false)), 'GET whoami');
    }

    public function globalPermissions(Credential $user): array
    {
        return $this->expectObject($this->data($this->send('GET', 'permissions/global', $user, false)), 'GET permissions/global');
    }

    public function serviceUserGlobalPermissions(): array
    {
        return $this->expectObject($this->data($this->send('GET', 'permissions/global', $this->serviceUser, true)), 'GET permissions/global');
    }

    public function verifyLogin(string $username, #[\SensitiveParameter] string $password): ?LoginResult
    {
        $response = $this->request('POST', 'login', [
            RequestOptions::HEADERS => ['Accept' => 'application/json'],
            RequestOptions::JSON => ['username' => $username, 'password' => $password],
        ]);

        $status = $response->getStatusCode();
        if (in_array($status, [400, 401, 403], true)) {
            return null;
        }
        $this->throwForStatus($response, 'POST login', null);

        $data = $this->expectObject($this->data(['response' => $response, 'what' => 'POST login']), 'POST login');
        $personId = $data['personId'] ?? null;
        $loginStatus = $data['status'] ?? null;
        if (!is_int($personId) || $personId < 1 || !is_string($loginStatus)) {
            throw new InvalidResponseException('POST login: unexpected response shape.');
        }

        return new LoginResult($personId, $loginStatus);
    }

    public function getModuleByKey(string $key): array
    {
        if (preg_match(self::MODULE_KEY_PATTERN, $key) !== 1) {
            throw new \InvalidArgumentException('Invalid module key.');
        }

        // ChurchTools answers 400 (validation.integer) instead of 404 for a key that doesn't exist: it then tries to
        // read the key as a numeric module ID. Measured on the test instance (contract test).
        return $this->expectObject($this->data($this->send('GET', 'custommodules/' . $key, $this->serviceUser, true, notFoundStatuses: [400, 404])), 'GET custommodules/{key}');
    }

    public function getCategories(int $moduleId): array
    {
        $path = sprintf('custommodules/%d/customdatacategories', $this->positive($moduleId));

        return $this->expectList($this->data($this->send('GET', $path, $this->serviceUser, true)), 'GET ' . $path);
    }

    public function getValues(int $moduleId, int $categoryId): array
    {
        $path = $this->valuesPath($moduleId, $categoryId);
        $result = $this->send('GET', $path, $this->serviceUser, true);
        $body = $this->decode($result['response'], $result['what']);
        $values = $this->expectList($body['data'] ?? null, $result['what']);

        $count = $body['meta']['count'] ?? null;
        if (!is_int($count) || $count !== count($values)) {
            throw new InvalidResponseException($result['what'] . ': meta.count is missing or doesn\'t match the number of values.');
        }

        return $values;
    }

    public function createValue(int $moduleId, int $categoryId, string $value): int
    {
        $path = $this->valuesPath($moduleId, $categoryId);
        $data = $this->expectObject($this->data($this->send('POST', $path, $this->serviceUser, true, [
            'dataCategoryId' => $categoryId,
            'value' => $value,
        ])), 'POST ' . $path);

        $id = $data['id'] ?? null;
        if (!is_int($id) || $id < 1) {
            throw new InvalidResponseException('POST ' . $path . ': the response has no valid value ID.');
        }

        return $id;
    }

    public function updateValue(int $moduleId, int $categoryId, int $valueId, string $value): void
    {
        $path = $this->valuesPath($moduleId, $categoryId) . '/' . $this->positive($valueId);
        $this->send('PUT', $path, $this->serviceUser, true, [
            'id' => $valueId,
            'dataCategoryId' => $categoryId,
            'value' => $value,
        ]);
    }

    public function deleteValue(int $moduleId, int $categoryId, int $valueId): void
    {
        $path = $this->valuesPath($moduleId, $categoryId) . '/' . $this->positive($valueId);
        $this->send('DELETE', $path, $this->serviceUser, true);
    }

    /**
     * Sends an authenticated request and throws for every non-2xx answer.
     *
     * @param array<string, mixed>|null $json
     * @param list<int> $notFoundStatuses statuses that mean "not found" for this call
     * @return array{response: ResponseInterface, what: string}
     */
    private function send(string $method, string $path, Credential $credential, bool $isServiceUser, ?array $json = null, array $notFoundStatuses = [404]): array
    {
        $options = [
            RequestOptions::HEADERS => [
                'Accept' => 'application/json',
                'Authorization' => $credential->authorizationHeader(),
                'X-OnlyAuthenticated' => '1',
            ],
        ];
        if ($json !== null) {
            $options[RequestOptions::JSON] = $json;
        }

        $what = $method . ' ' . $path;
        $response = $this->request($method, $path, $options);
        if (in_array($response->getStatusCode(), $notFoundStatuses, true)) {
            throw new NotFoundException(sprintf('%s: ChurchTools answered %d.', $what, $response->getStatusCode()));
        }
        $this->throwForStatus($response, $what, $isServiceUser);

        return ['response' => $response, 'what' => $what];
    }

    /**
     * @param array<string, mixed> $options
     */
    private function request(string $method, string $path, array $options): ResponseInterface
    {
        try {
            return $this->http->request($method, $path, $options);
        } catch (GuzzleException $e) {
            // Guzzle's messages may contain the request; only the class name is passed on.
            throw new UnavailableException(sprintf('%s %s: ChurchTools is unreachable (%s).', $method, $path, (new \ReflectionClass($e))->getShortName()));
        }
    }

    /**
     * @param bool|null $isServiceUser null for unauthenticated calls such as login
     */
    private function throwForStatus(ResponseInterface $response, string $what, ?bool $isServiceUser): void
    {
        $status = $response->getStatusCode();
        if ($status >= 200 && $status < 300) {
            return;
        }

        $message = sprintf('%s: ChurchTools answered %d.', $what, $status);

        if ($status === 401 || $status === 403) {
            if ($isServiceUser === true) {
                throw new ServiceCredentialRejectedException($message);
            }
            throw $status === 401 ? new NotAuthenticatedException($message) : new NotPermittedException($message);
        }
        if ($status === 404) {
            throw new NotFoundException($message);
        }
        if ($status === 429) {
            throw new RateLimitedException($message, $this->retryAfterSeconds($response->getHeaderLine('Retry-After')));
        }
        if ($status >= 500) {
            throw new UnavailableException($message);
        }

        throw new InvalidResponseException($message);
    }

    /**
     * `Retry-After` as seconds or HTTP date; missing or unparsable counts as the minimum (spec 5.6).
     */
    private function retryAfterSeconds(string $header): int
    {
        $header = trim($header);
        $seconds = null;

        if (preg_match('/^\d{1,9}\z/', $header) === 1) {
            $seconds = (int) $header;
        } elseif ($header !== '') {
            $date = \DateTimeImmutable::createFromFormat(\DateTimeInterface::RFC7231, $header);
            if ($date !== false) {
                $seconds = $date->getTimestamp() - ($this->now)();
            }
        }

        return max(self::MIN_RETRY_AFTER_SECONDS, $seconds ?? 0);
    }

    /**
     * @param array{response: ResponseInterface, what: string} $result
     */
    private function data(array $result): mixed
    {
        $body = $this->decode($result['response'], $result['what']);
        if (!array_key_exists('data', $body)) {
            throw new InvalidResponseException($result['what'] . ': the response has no data member.');
        }

        return $body['data'];
    }

    /**
     * @return array<string, mixed>
     */
    private function decode(ResponseInterface $response, string $what): array
    {
        try {
            $body = json_decode((string) $response->getBody(), true, 64, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new InvalidResponseException($what . ': the response isn\'t valid JSON.');
        }
        if (!is_array($body) || array_is_list($body) && $body !== []) {
            throw new InvalidResponseException($what . ': the response isn\'t a JSON object.');
        }

        return $body;
    }

    /**
     * @return array<string, mixed>
     */
    private function expectObject(mixed $data, string $what): array
    {
        if (!is_array($data) || ($data !== [] && array_is_list($data))) {
            throw new InvalidResponseException($what . ': expected an object in data.');
        }

        return $data;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function expectList(mixed $data, string $what): array
    {
        if (!is_array($data) || !array_is_list($data)) {
            throw new InvalidResponseException($what . ': expected a list in data.');
        }
        foreach ($data as $item) {
            if (!is_array($item) || ($item !== [] && array_is_list($item))) {
                throw new InvalidResponseException($what . ': expected a list of objects in data.');
            }
        }

        /** @var list<array<string, mixed>> $data */
        return $data;
    }

    private function valuesPath(int $moduleId, int $categoryId): string
    {
        return sprintf('custommodules/%d/customdatacategories/%d/customdatavalues', $this->positive($moduleId), $this->positive($categoryId));
    }

    private function positive(int $id): int
    {
        if ($id < 1) {
            throw new \InvalidArgumentException('IDs must be positive.');
        }

        return $id;
    }
}
