<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\ChurchTools;

use CtPassStore\Infrastructure\ChurchTools\Exception\ChurchToolsException;

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
    /** The most person IDs {@see activePersonIds()} accepts in one call. */
    public const MAX_BATCH = 100;

    /**
     * Exchanges an OAuth authorization code (with PKCE) for a ChurchTools access token (spec 4.4.2). The token is
     * returned as is; checking it is the caller's job.
     *
     * @throws Exception\OAuthCodeRejectedException if ChurchTools doesn't accept the code
     * @throws Exception\OAuthClientRejectedException if ChurchTools doesn't accept the client ID or secret
     * @throws Exception\ChurchToolsException for every other failure
     */
    public function exchangeAuthorizationCode(
        string $clientId,
        #[\SensitiveParameter]
        string $clientSecret,
        #[\SensitiveParameter]
        string $code,
        string $redirectUri,
        #[\SensitiveParameter]
        string $codeVerifier,
    ): string;

    /**
     * `GET /whoami` as the given user.
     */
    public function whoami(Credential $user): WhoAmI;

    /**
     * `GET /permissions/global` as the given user.
     */
    public function globalPermissions(Credential $user): Permissions;

    /**
     * `GET /permissions/global` as the service user (for the self-check).
     */
    public function serviceUserGlobalPermissions(): Permissions;

    /**
     * `POST /login` with username and password.
     *
     * @return LoginResult|null the result if ChurchTools accepted the credentials, null if it rejected them
     */
    public function verifyLogin(string $username, #[\SensitiveParameter] string $password): ?LoginResult;

    /**
     * `GET /persons/{id}` as the service user: `404` is `Gone`; `403` is never "gone" but a
     * {@see Exception\ServiceCredentialRejectedException} (the service user lacks the persons right).
     */
    public function personStatus(int $personId): PersonStatus;

    /**
     * `GET /persons?ids[]=…&limit=n` as the service user: the IDs among `$personIds` that exist, are visible and aren't
     * archived. Persons that are missing just aren't in the result; the method never says why. The answer is checked
     * (`meta.pagination.total`, only asked IDs), else {@see Exception\InvalidResponseException}.
     *
     * @param list<int> $personIds at most {@see MAX_BATCH}
     * @return list<int>
     * @throws \InvalidArgumentException for more than {@see MAX_BATCH} IDs
     */
    public function activePersonIds(array $personIds): array;

    /**
     * `GET /person/masterdata` as the service user: the IDs of all departments (`data.departments[].id`).
     *
     * @return list<int>
     */
    public function personDepartmentIds(): array;

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
