<?php

declare(strict_types=1);

namespace CtPassStore\ChurchTools;

use CtPassStore\ChurchTools\Exception\ChurchToolsException;

/**
 * Every call the backend makes to ChurchTools (spec 5.6).
 *
 * Services depend on this interface only, so tests can replace ChurchTools with a fake. All methods throw a
 * {@see ChurchToolsException} subclass when ChurchTools can't be reached or answers unexpectedly.
 *
 * KV store calls use the service user's credential the client was created with. Calls on behalf of a user take
 * the user's credential as a parameter.
 */
interface ChurchToolsClient
{
    /**
     * `GET /whoami` as the given user.
     *
     * @return array<string, mixed> the `data` member (the person)
     */
    public function whoami(Credential $user): array;

    /**
     * `GET /permissions/global` as the given user.
     *
     * @return array<string, mixed> the `data` member
     */
    public function globalPermissions(Credential $user): array;

    /**
     * `GET /permissions/global` as the service user (for the self-check).
     *
     * @return array<string, mixed> the `data` member
     */
    public function serviceUserGlobalPermissions(): array;

    /**
     * `POST /login` with username and password.
     *
     * @return LoginResult|null the result if ChurchTools accepted the credentials, null if it rejected them
     */
    public function verifyLogin(string $username, #[\SensitiveParameter] string $password): ?LoginResult;

    /**
     * `GET /custommodules/{key}`.
     *
     * @return array<string, mixed> the module
     */
    public function getModuleByKey(string $key): array;

    /**
     * `GET /custommodules/{moduleId}/customdatacategories`.
     *
     * @return list<array<string, mixed>>
     */
    public function getCategories(int $moduleId): array;

    /**
     * `GET /custommodules/{moduleId}/customdatacategories/{categoryId}/customdatavalues`.
     *
     * Checks that the number of returned values equals `meta.count` (spec 5.3.9).
     *
     * @return list<array<string, mixed>>
     */
    public function getValues(int $moduleId, int $categoryId): array;

    /**
     * Creates a value whose content is the given JSON string.
     *
     * @return int the new value's ID
     */
    public function createValue(int $moduleId, int $categoryId, string $value): int;

    public function updateValue(int $moduleId, int $categoryId, int $valueId, string $value): void;

    public function deleteValue(int $moduleId, int $categoryId, int $valueId): void;
}
