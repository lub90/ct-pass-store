<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Support;

use CtPassStore\Infrastructure\ChurchTools\ChurchToolsClient;
use CtPassStore\Infrastructure\ChurchTools\Credential;
use CtPassStore\Infrastructure\ChurchTools\Exception\NotAuthenticatedException;
use CtPassStore\Infrastructure\ChurchTools\Exception\NotFoundException;
use CtPassStore\Infrastructure\ChurchTools\LoginResult;

/**
 * In-memory ChurchTools for unit and API tests (spec 6.6).
 *
 * It behaves like the real ChurchTools as far as the backend relies on it. The contract cases (catalog CT-06a)
 * keep it honest. Every call is recorded, and single calls can be made to fail.
 */
final class FakeChurchToolsClient implements ChurchToolsClient
{
    /** @var array<string, array<string, mixed>> person data per Authorization header */
    private array $people = [];

    /** @var array<string, array<string, mixed>> global permissions per Authorization header */
    private array $permissions = [];

    /** @var array<string, array{password: string, personId: int, status: string}> */
    private array $logins = [];

    /** @var array<string, array<string, mixed>> modules by key */
    private array $modules = [];

    /** @var array<int, list<array<string, mixed>>> categories by module ID */
    private array $categories = [];

    /** @var array<int, array<int, array<string, mixed>>> values by category ID, then value ID */
    private array $values = [];

    private int $nextId = 1;

    /** @var list<array{method: string, args: list<mixed>}> */
    private array $calls = [];

    /** @var array<string, list<\Throwable>> */
    private array $failures = [];

    /** @var array<string, list<\Closure(): void>> */
    private array $hooks = [];

    /** @var array<string, mixed> */
    private array $servicePermissions = [];

    // ---------------------------------------------------------------- setup helpers

    /**
     * @param array<string, mixed> $permissions the user's `permissions/global` data
     */
    public function addUser(Credential $credential, int $personId, string $username, array $permissions): void
    {
        $this->people[$credential->authorizationHeader()] = ['id' => $personId, 'cmsUserId' => $username];
        $this->permissions[$credential->authorizationHeader()] = $permissions;
    }

    public function addLogin(string $username, string $password, int $personId, string $status = LoginResult::STATUS_SUCCESS): void
    {
        $this->logins[$username] = ['password' => $password, 'personId' => $personId, 'status' => $status];
    }

    /**
     * @param array<string, mixed> $permissions
     */
    public function setServiceUserPermissions(array $permissions): void
    {
        $this->servicePermissions = $permissions;
    }

    /**
     * @param list<string> $categoryNames
     * @return array<string, int> category IDs by name
     */
    public function addModule(string $key, array $categoryNames): array
    {
        $moduleId = $this->nextId++;
        $this->modules[$key] = ['id' => $moduleId, 'shorty' => $key, 'name' => $key];
        $ids = [];
        foreach ($categoryNames as $name) {
            $categoryId = $this->nextId++;
            $this->categories[$moduleId][] = ['id' => $categoryId, 'customModuleId' => $moduleId, 'name' => $name, 'shorty' => $name];
            $this->values[$categoryId] = [];
            $ids[$name] = $categoryId;
        }

        return $ids;
    }

    /**
     * Puts a raw value into a category, bypassing the recorded calls (test setup).
     */
    public function seedValue(int $categoryId, string $value): int
    {
        $id = $this->nextId++;
        $this->values[$categoryId][$id] = ['id' => $id, 'dataCategoryId' => $categoryId, 'value' => $value];

        return $id;
    }

    /**
     * Removes all values of a category, bypassing the recorded calls (test setup).
     */
    public function clearValues(int $categoryId): void
    {
        $this->values[$categoryId] = [];
    }

    /**
     * The values of a category, as stored (test assertions).
     *
     * @return list<array<string, mixed>>
     */
    public function storedValues(int $categoryId): array
    {
        return array_values($this->values[$categoryId] ?? []);
    }

    /**
     * Lets the next call of `$method` throw `$exception`.
     */
    public function failNext(string $method, \Throwable $exception): void
    {
        $this->failures[$method][] = $exception;
    }

    /**
     * Runs `$hook` once, right before the next call of `$method` takes effect. Used to interleave a second request
     * with a first one, e.g. between its read and its write (catalog TR-02).
     *
     * @param \Closure(): void $hook
     */
    public function beforeNext(string $method, \Closure $hook): void
    {
        $this->hooks[$method][] = $hook;
    }

    /**
     * @return list<array{method: string, args: list<mixed>}>
     */
    public function calls(): array
    {
        return $this->calls;
    }

    /**
     * @param list<string> $methods
     */
    public function countCalls(array $methods): int
    {
        return count(array_filter($this->calls, static fn(array $call): bool => in_array($call['method'], $methods, true)));
    }

    public function writeCount(): int
    {
        return $this->countCalls(['createValue', 'updateValue', 'deleteValue']);
    }

    // ---------------------------------------------------------------- ChurchToolsClient

    public function whoami(Credential $user): array
    {
        $this->record(__FUNCTION__, [$user->scheme()]);

        return $this->people[$user->authorizationHeader()] ?? throw new NotAuthenticatedException('GET whoami: ChurchTools answered 401.');
    }

    public function globalPermissions(Credential $user): array
    {
        $this->record(__FUNCTION__, [$user->scheme()]);

        return $this->permissions[$user->authorizationHeader()] ?? throw new NotAuthenticatedException('GET permissions/global: ChurchTools answered 401.');
    }

    public function serviceUserGlobalPermissions(): array
    {
        $this->record(__FUNCTION__, []);

        return $this->servicePermissions;
    }

    public function verifyLogin(string $username, #[\SensitiveParameter] string $password): ?LoginResult
    {
        $this->record(__FUNCTION__, [$username]);

        $login = $this->logins[$username] ?? null;
        if ($login === null || !hash_equals($login['password'], $password)) {
            return null;
        }

        return new LoginResult($login['personId'], $login['status']);
    }

    public function getModuleByKey(string $key): array
    {
        $this->record(__FUNCTION__, [$key]);

        return $this->modules[$key] ?? throw new NotFoundException("GET custommodules/$key: ChurchTools answered 404.");
    }

    public function getCategories(int $moduleId): array
    {
        $this->record(__FUNCTION__, [$moduleId]);

        return $this->categories[$moduleId] ?? throw new NotFoundException("GET custommodules/$moduleId/customdatacategories: ChurchTools answered 404.");
    }

    public function getValues(int $moduleId, int $categoryId): array
    {
        $this->record(__FUNCTION__, [$moduleId, $categoryId]);
        $this->assertCategory($moduleId, $categoryId);

        return array_values($this->values[$categoryId]);
    }

    public function createValue(int $moduleId, int $categoryId, string $value): int
    {
        $this->record(__FUNCTION__, [$moduleId, $categoryId, $value]);
        $this->assertCategory($moduleId, $categoryId);

        $id = $this->nextId++;
        $this->values[$categoryId][$id] = ['id' => $id, 'dataCategoryId' => $categoryId, 'value' => $value];

        return $id;
    }

    public function updateValue(int $moduleId, int $categoryId, int $valueId, string $value): void
    {
        $this->record(__FUNCTION__, [$moduleId, $categoryId, $valueId, $value]);
        $this->assertCategory($moduleId, $categoryId);
        if (!isset($this->values[$categoryId][$valueId])) {
            throw new NotFoundException('PUT customdatavalues: ChurchTools answered 404.');
        }

        $this->values[$categoryId][$valueId]['value'] = $value;
    }

    public function deleteValue(int $moduleId, int $categoryId, int $valueId): void
    {
        $this->record(__FUNCTION__, [$moduleId, $categoryId, $valueId]);
        $this->assertCategory($moduleId, $categoryId);
        if (!isset($this->values[$categoryId][$valueId])) {
            throw new NotFoundException('DELETE customdatavalues: ChurchTools answered 404.');
        }

        unset($this->values[$categoryId][$valueId]);
    }

    // ---------------------------------------------------------------- internals

    /**
     * @param list<mixed> $args
     */
    private function record(string $method, array $args): void
    {
        $this->calls[] = ['method' => $method, 'args' => $args];

        if (($this->hooks[$method] ?? []) !== []) {
            // Removed before it runs, so calls made by the hook itself aren't intercepted again.
            $hook = array_shift($this->hooks[$method]);
            $hook();
        }

        if (($this->failures[$method] ?? []) !== []) {
            throw array_shift($this->failures[$method]);
        }
    }

    private function assertCategory(int $moduleId, int $categoryId): void
    {
        foreach ($this->categories[$moduleId] ?? [] as $category) {
            if ($category['id'] === $categoryId) {
                return;
            }
        }
        throw new NotFoundException('customdatacategories: ChurchTools answered 404.');
    }
}
