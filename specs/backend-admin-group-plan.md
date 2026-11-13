# Backend: Admin Group and `access` Category – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carry section 11 of the extension spec into the backend: admins come from a ChurchTools group stored in the
new KV category `access`, the login answer reports `admin` and `version`, and releases follow `versioning.md`.

**Architecture:** The admin role moves from the settings into the user token. `ChurchToolsIdentityProvider` checks the
group membership once, at login, with the user's own OAuth token; `UserTokens` signs it as the claim `admin`;
`AccessPolicy` and the self-check read it from the principal. `KvSettingsRepository` reads a second category,
`access`, for the admin group and the machine clients.

**Tech Stack:** PHP ^8.3, Slim 4, Guzzle 7, PHPUnit 12, PHPStan 2, PHP-CS-Fixer (PER).

**Spec:** [`extension-spec.md`](extension-spec.md) section 11 (and 6.1 for the `access` value),
[`versioning.md`](versioning.md), [`backend-spec.md`](backend-spec.md). Test cases go into a new catalog section
**19. Admin group and `access` (extension spec 11)** with the prefix `AG-` in
[`backend-test-catalog.md`](backend-test-catalog.md). Add a case to the catalog before its test; tick it in the commit
that proves it.

**Branch:** `feature/admin-group`, created from `feature/backend-cleanup` once its load test is finished (memory note
"Gone-persons load test paused"), or from `main` after that branch is merged. Never on top of uncommitted work of
another agent: check `git status` first.

## Global Constraints

- One commit per task. Every commit passes `composer check` in `backend/`.
- Layer rules of `tests/Unit/Security/ArchitectureTest.php` hold: `Http` and `Application` never import
  `Infrastructure`.
- Errors follow the existing pattern: exceptions with a `Reason`, mapped exhaustively in `ProblemMapping`; controllers
  don't catch them.
- No new runtime dependency.
- Messages and comments in `src/` use only `example.church.tools` or `your.church.tools` as hosts.
- `access` value (extension spec 6.1): `{"schema": 2, "revision": <int>, "groups": {"users": {"groupId": <int>,
  "createdBySetup": <bool>}, "admins": {…}, "service": {…}}, "machineClients": [ … ]}`. The backend reads only
  `groups.admins.groupId` and `machineClients`; it ignores everything else.
- `settings` may contain `schema`, `revision`, `oauthClientId` and `texts`; the backend ignores them. `adminUsers` and
  `machineClients` in `settings` are ignored too (they belong to the old layout; the migration moves them).
- A missing or invalid `groups.admins.groupId` means **no admins** (fail closed). It never breaks logins of users.
- Removing a person from the admin group takes effect when their token expires (15 minutes).
- The token claim `admin` is a JSON boolean and required; a token without it is `401 invalid-token`.
- Tags: `backend-vX.Y.Z`. Backend and extension share `MAJOR.MINOR`.

## Review Focus

1. **A person in the admin group whose membership is "waiting" or "to delete"** (ChurchTools membership statuses other
   than `active`) must not become admin. → AG-02, Task 3.
2. **The admin group was deleted in ChurchTools** while `access` still names it: logins of everyone keep working, nobody
   is admin. → AG-05, Task 5.
3. **An old token from before the update** (no `admin` claim) must be rejected, not treated as a user. → AG-07, Task 5.
4. **`access` category missing on an installation that wasn't migrated yet:** users can still log in; machine clients
   and admins are off; `/v1/test` says why. → AG-04, Task 4.
5. **Group IDs as strings** (`GET /persons/{id}/groups` returns `group.domainIdentifier` as a string): `"12"` must match
   `12`, `"012"` or `"12 "` must not. → AG-01, Task 3.

---

### Task 1: Spec and catalog

Carry extension spec section 11 into the backend's documents before any code changes.

**Files:**
- Modify: `specs/backend-spec.md` (sections 2, 3.2, 3.3, 4.3, 4.4, 4.8, 4.9 only if a type changes, 5.5, 6.5, 7, 8)
- Modify: `specs/backend-test-catalog.md` (new section 19; mark replaced cases)
- Modify: `specs/backend-cleanup-design.md` (gone admins removed)
- Modify: `specs/extension-spec.md` section 11 item 4 (the decisions below)

- [ ] **Step 1: Update `backend-spec.md`**
  - Section 2: the category table gains `access` (written by the admin group; read by the service user and the admin
    group); `settings` loses `adminUsers` and `machineClients`.
  - Section 3.2: `adminUsers` rules removed; `machineClients` rules now refer to `access.machineClients` (unchanged
    otherwise); new rule: `access.groups.admins.groupId` is a positive integer (JSON integer, not a string); missing or
    invalid → no admins, logged as `warning`, reported by `/v1/test`. Missing `access` category or value → no admins
    and no machine clients, same reporting.
  - Section 3.3: redirect URI `https://<instance>/ccm/ctpassstore/auth/callback`.
  - Section 4.3: "The admin role is taken from the token claim `admin`" replaces "from the current settings".
  - Section 4.4: processing step 4 gains: if `groups.admins.groupId` is set, `GET /api/persons/{personId}/groups` with
    the user's token; admin = an entry whose `group.domainIdentifier` equals the group ID and whose
    `groupMemberStatus` is `active`. Claims gain `admin` (boolean, required). Response gains `"admin"` and
    `"version"`.
  - Section 4.8: `AdminUsersCheck` removed; new check "access": the service user can read `access`, and
    `groups.admins.groupId` is a positive integer. Existence of the group isn't checked here (the extension's rights
    check does it; the service user gets no group right).
  - Section 6.5: link to `versioning.md`; tags `backend-v*.*.*`.
  - Section 7: Q22 removed from the open questions; section 8: new decision **D9** (or the next free number) "Admin
    role from a ChurchTools group, checked at login", with the reasons of extension spec E4/E5.
- [ ] **Step 2: Catalog section 19** with these cases (layer in brackets), and mark `GP-03`, the `AdminUsersCheck`
  cases and the cleanup report's gone-admins cases as **removed (AG, 2026-11-13)** instead of deleting them:
  - **AG-01** (! · U) Group ID matching: `"12"` matches 12; `"012"`, `"12 "`, `"1e1"`, `12.0`, `null` don't.
  - **AG-02** (! · A) Admin only with an `active` membership in exactly the configured group; `waiting`, `requested`,
    `to_delete`, another group, or no `groups.admins` → `admin: false`.
  - **AG-03** (N · A) Login answer: `admin` and `version` present; `version` equals `Version::current()`.
  - **AG-04** (! · A) `access` missing, value missing, `groupId` missing, `0`, negative or a string → login works,
    `admin: false`; machine clients without `access` are refused.
  - **AG-05** (S · A) ChurchTools answers `404` or `403` for the person's groups → login works, `admin: false`,
    `warning` logged; `5xx`/timeout → `502 upstream-unavailable` (no token issued with a guessed role).
  - **AG-06** (! · A) Authorization reads only the token: a token with `admin: true` may act on others; `admin: false`
    may not, even if `adminUsers` in `settings` still lists the person.
  - **AG-07** (! · U) A token without `admin`, or with `admin` as `"true"`/`1` → `401 invalid-token`.
  - **AG-08** (N · A) `/v1/test` check "access": ok; fails for unreadable `access`, invalid `groupId`.
  - **AG-09** (N · U) `settings` with `schema`, `revision`, `oauthClientId`, `texts`, `adminUsers`, `machineClients`
    parses as before; none of them changes `Settings`.
  - **AG-10** (! · C) Contract: with a user's OAuth token, `GET /api/persons/{id}/groups` lists the user's own active
    memberships (measures extension spec 14.3).
  - **AG-11** (N · C) Contract: an OAuth client with redirect URI `…/ccm/ctpassstore/auth/callback` is accepted, and
    the authorize step redirects there with `code` and `state` (measures extension spec 14.1).
  - **AG-12** (N · U) Release check: tag `backend-vX.Y.Z`; `MAJOR.MINOR` differing from `extension/package.json`
    fails.
- [ ] **Step 3: Cleanup design:** section 3.4 `GoneAdmins` and every mention of gone admins (report, CLI warning,
  exit code 1 for gone admins) marked as removed, with the reason: membership lives in ChurchTools; a gone person can't
  log in.
- [ ] **Step 4: Extension spec 11.4** rewritten to the decisions above (group existence checked by the extension, not
  `/v1/test`; gone-admins checks dropped).
- [ ] **Step 5: Commit** — `git commit -m "Spec: admin group and access category for the backend (extension spec 11)"`

### Task 2: Measure OAuth group membership and the callback URI

**Files:**
- Create: `backend/tests/Contract/Helpers/OAuthCodeFetcher.php`
- Create: `backend/tests/Contract/AdminGroupContractTest.php`
- Modify: `specs/ct-extension-info.md` section 4 (OAuth) with the results

**Interfaces:**
- Produces: `OAuthCodeFetcher::code(string $username, string $password, string $clientId, string $redirectUri): array{code: string, state: string}`
  — logs in with `POST /api/login` in its own cookie jar, calls `GET /oauth/authorize` with PKCE, follows a consent
  form if one appears, and returns the `code` from the `Location` of the redirect (redirects are **not** followed to
  the redirect URI). Also `codeVerifier(): string` for the last call. Task 3 and the extension's contract layer
  (extension plan Task 18) use the same steps.

- [ ] **Step 1:** Contract test setup: as the admin, `POST /api/oauthclients` with `redirectUri` =
  `<CT_API_URL without /api>/ccm/ctpassstore/auth/callback` (string), remember `identifier` and `clientSecret`;
  teardown deletes it by `identifier` (see `backend-plan.md` 5.1 API facts).
- [ ] **Step 2: AG-11:** `code()` for a normal test user returns a non-empty `code` and the `state` sent; the redirect
  goes to exactly the registered URI. Exchanging it at `POST /oauth/access_token` gives a token.
- [ ] **Step 3: AG-10:** with that token as `Authorization: Bearer`, `GET /api/persons/{id}/groups` answers `200` and
  contains the user's known group with `groupMemberStatus` `active` and `group.domainIdentifier` as a string.
- [ ] **Step 4: Run** `composer test:contract -- --filter AdminGroupContractTest`. Expected: both pass. **If AG-10
  fails** (the OAuth token can't read groups): stop and report to the human partner. The fallback (the service user
  reads the admin group's members with „view group“ on it, a new rights-table row S5) changes the extension spec.
- [ ] **Step 5:** Record both results in `ct-extension-info.md` section 4 and tick spec 14.1 and 14.3 in
  `extension-spec.md`. Commit: `"Tests: measure OAuth group membership and the callback URI (AG-10, AG-11)"`.

### Task 3: Client: group memberships with the user's token

**Files:**
- Modify: `backend/src/Infrastructure/ChurchTools/ChurchToolsClient.php`,
  `GuzzleChurchToolsClient.php`, `backend/tests/Support/FakeChurchToolsClient.php`,
  `backend/tests/Support/ChurchToolsClientContractTestCase.php`
- Create: `backend/src/Infrastructure/ChurchTools/GroupId.php`
- Test: `backend/tests/Unit/Infrastructure/ChurchTools/GroupIdTest.php`, the shared contract case

**Interfaces:**
- Produces: `ChurchToolsClient::activeGroupIds(Credential $user, int $personId): list<int>` — the IDs of the groups in
  which the person's membership status is `active`; throws the client's existing exceptions (`404`/`403` as
  `NotFoundException`/`ForbiddenException` or the names the client already uses).
- Produces: `GroupId::parse(mixed $value): ?int` — positive decimal without sign, leading zeros or whitespace, as
  string or int; otherwise null.

- [ ] **Step 1: Failing test AG-01** in `GroupIdTest`:

```php
self::assertSame(12, GroupId::parse('12'));
self::assertSame(12, GroupId::parse(12));
foreach (['012', '12 ', ' 12', '1e1', '+12', '-12', '0', '', null, 12.0, true, []] as $bad) {
    self::assertNull(GroupId::parse($bad), var_export($bad, true));
}
```

- [ ] **Step 2: Run** `vendor/bin/phpunit --filter GroupIdTest` → FAIL (class missing).
- [ ] **Step 3: Implement** `GroupId::parse()`; reuse `PersonId::decimal()` if its rules are identical.
- [ ] **Step 4:** Shared contract case `testActiveGroupIds`: the fake and the real client return the same list for the
  normal test user, and an entry with status `waiting` is left out (fake only; the real one asserts the known group is
  present). Implement in the fake, then in Guzzle (`GET persons/{id}/groups` with the bearer credential and
  `X-OnlyAuthenticated: 1`; all pages).
- [ ] **Step 5: Run** `composer check` → PASS. Commit: `"Backend: read a person's active groups with their token (AG-01)"`.

### Task 4: `access` category in the settings repository

**Files:**
- Modify: `backend/src/Infrastructure/Kv/KvSchema.php`, `SettingsParser.php`, `KvSettingsRepository.php`,
  `backend/src/Domain/Settings.php`
- Create: `backend/src/Infrastructure/Kv/AccessParser.php`
- Test: `backend/tests/Unit/Infrastructure/Kv/AccessParserTest.php`, `SettingsParserTest.php`,
  `KvSettingsRepositoryTest.php`

**Interfaces:**
- Produces: `KvSchema::ACCESS_CATEGORY = 'access'`, `ACCESS_GROUPS = 'groups'`, `GROUP_ADMINS = 'admins'`,
  `GROUP_ID = 'groupId'`, `ACCESS_MACHINE_CLIENTS = 'machineClients'`. `SETTING_MACHINE_CLIENTS` is removed;
  `SETTING_ADMIN_USERS` stays until Task 5.
- Produces: `Settings` gains `public readonly ?int $adminGroupId` (named argument, default null); its machine clients
  now come from `access`. `adminUsers` and `isAdmin()` stay until Task 5 removes them, so admins keep working in
  this commit.
- Produces: `AccessParser::parse(?array $raw): ParsedAccess` with `?int $adminGroupId`, `array<string, MachineClient> $machineClients`,
  `list<string> $findings` (`null` raw = missing category or value). The machine-client rules move unchanged from
  `SettingsParser`.

- [ ] **Step 1: Failing tests:** AG-09 in `SettingsParserTest` (the extra fields don't change the result); AG-04 in
  `AccessParserTest` (missing → `adminGroupId` null, no clients, one finding naming `access`; `groupId` `0`, `-1`,
  `"12"`, `1.5` → null with a finding; a valid value → the ID and the clients); the moved machine-client cases.
- [ ] **Step 2: Run** them → FAIL.
- [ ] **Step 3: Implement.** `KvSettingsRepository::settings()` reads `settings` and `access` (own cache entry
  `access`, same TTL and failure memory as the settings). A missing `access` category or value is `null` for the
  parser, not an exception. Findings of both are logged as `warning` and returned by `findings()`.
- [ ] **Step 4:** Move the machine-client tests to `access` (`MachineTokens` reads `Settings::$machineClients` as
  before). Run `composer check` → PASS.
- [ ] **Step 5: Commit:** `"Backend: admin group and machine clients from the access category (AG-04, AG-09)"`.

### Task 5: Admin claim at login and in authorization

**Files:**
- Modify: `backend/src/Domain/PersonPrincipal.php`, `AccessPolicy.php`,
  `backend/src/Application/Port/IdentityProvider.php`, `Login.php`, `IssuedToken.php`, `Auth/UserTokens.php`,
  `backend/src/Infrastructure/ChurchTools/ChurchToolsIdentityProvider.php`,
  `backend/src/Http/Controller/AuthController.php`, `SelfCheckController.php`, `backend/src/Kernel.php`
- Test: `backend/tests/Unit/Application/Auth/UserTokensTest.php`, `backend/tests/Api/LoginApiTest.php`,
  `AuthorizationApiTest.php`, `SelfCheckApiTest.php`

**Interfaces:**
- Consumes: `ChurchToolsClient::activeGroupIds()` (Task 3), `Settings::$adminGroupId` (Task 4).
- Produces: `PersonPrincipal::__construct(PersonId $id, string $username, bool $admin = false)`.
- Produces: `IdentityProvider::authenticate(string $code, string $codeVerifier, string $redirectUri, ?int $adminGroupId): PersonPrincipal`.
- Produces: `IssuedToken::__construct(string $token, int $expiresIn, bool $admin)`.
- Produces: `AccessPolicy::mayRead(Principal $principal, PersonId $target): bool` and `mayChange(…)` without
  `Settings`. `Settings::$adminUsers`, `Settings::isAdmin()`, `KvSchema::SETTING_ADMIN_USERS` and the parser's
  `adminUsers` rule are removed in this task.
- Produces: login response `{"accessToken", "tokenType": "Bearer", "expiresIn": 900, "admin": <bool>, "version": "<x.y.z…>"}`.

- [ ] **Step 1: Failing tests:** AG-07 (`UserTokensTest`: issue → verify round trip keeps `admin` true and false;
  tokens signed without `admin` or with `"true"`/`1` → `InvalidTokenException`); AG-02, AG-03, AG-05 (`LoginApiTest`
  with the fake: memberships with each status; groups call answering `404`, `403`, `500`); AG-06
  (`AuthorizationApiTest`: replace the admin set-up via `adminUsers` with admin tokens; a person still listed in an old
  `adminUsers` gets `403` on another entry); `/v1/test` admin gate by claim.
- [ ] **Step 2: Run** them → FAIL.
- [ ] **Step 3: Implement.** `Login` gets the `SettingsRepository` and passes `settings()->adminGroupId`; a
  `ConfigurationException` from the settings fails the login as today. The identity provider asks for groups only
  when `adminGroupId` isn't null and only after the `view` check; `404`/`403` → `admin: false` plus `warning`
  ("Login: the admin group can't be read with the user's token; user N is treated as a user."). The controller adds
  `admin` and `version` (inject `Version::current()` through `Kernel`, as the self-check gets it).
- [ ] **Step 4: Run** `composer check` → PASS. Also run the existing `AX-*` login cases unchanged.
- [ ] **Step 5: Commit:** `"Backend: admin role from the admin group, signed into the token (AG-02, AG-03, AG-05–AG-07)"`.

### Task 6: Self-check and cleanup without `adminUsers`

**Files:**
- Delete: `backend/src/Infrastructure/SelfCheck/AdminUsersCheck.php`, `backend/src/Application/GoneAdmins.php` and
  their tests
- Create: `backend/src/Infrastructure/SelfCheck/AccessCheck.php`, test `AccessCheckTest.php`
- Modify: `backend/src/Kernel.php`, `backend/src/Application/Cleanup/CleanupOrphans.php` (+ its report),
  `backend/src/Cli/CleanupCommand.php`, `backend/src/Infrastructure/SelfCheck/ServiceUserRightsCheck.php` (expects
  read on `access`), `backend/docs/setup.md`, `backend/README.md` (login response), `backend/CHANGELOG.md`

**Interfaces:**
- Produces: check name `access` with messages: ok "The service user can read access; the admin group is N." /
  fail "The service user can't read the category access; grant it view custom category and view custom data on
  access." / fail "access.groups.admins.groupId is missing or not a positive integer; nobody is admin until the
  extension's setup fixes it."

- [ ] **Step 1: Failing test AG-08** (`AccessCheckTest` and `SelfCheckApiTest`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the check, remove the gone-admins parts (report field, CLI lines, exit code 1 now only for
  failed deletes), update the docs and the CHANGELOG `0.1.0` section ("admins come from a ChurchTools group",
  "`access` category", "login answer has `admin` and `version`").
- [ ] **Step 4: Run** `composer check` → PASS; `composer test:contract` against the test instance where the
  extension's categories exist (the self-check contract cases).
- [ ] **Step 5: Commit:** `"Backend: self-check for access; gone-admins checks removed (AG-08)"`.

### Task 7: Release tags and shared `MAJOR.MINOR`

**Files:**
- Modify: `backend/bin/release-check.php`, its test, `.github/workflows/backend-release.yml`, `backend/docs/testing.md`
  (or wherever the release steps are described)

- [ ] **Step 1: Failing test AG-12:** tag `backend-v0.1.0` with `VERSION` 0.1.0 and `extension/package.json` 0.1.x
  passes; tag `v0.1.0` fails; `extension/package.json` 0.2.0 fails with "MAJOR.MINOR 0.1 differs from the extension's
  0.2 (versioning.md)"; a missing `extension/package.json` fails.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**; the workflow triggers on `backend-v*.*.*`. (The extension's `package.json` goes to 0.1.0
  in extension plan Task 1; until then this check fails, which is correct: no backend release before the extension.)
- [ ] **Step 4: Run** `composer check` → PASS.
- [ ] **Step 5: Commit:** `"Backend: release tags backend-v*, shared MAJOR.MINOR with the extension (AG-12)"`.
