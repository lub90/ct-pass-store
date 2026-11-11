# Backend Setup Endpoint (4.6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement item 4.6 of [`backend-plan.md`](backend-plan.md): the backend configures itself through
`/v1/setup` from the extension's setup wizard, so an admin installs it with FTP only.

**Architecture:** `Kernel::bootstrap()` picks one of three apps from the state of `credentials.php`: setup app,
normal app, misconfigured app. The setup app has one controller on an Application port (`Installer`). The
Infrastructure implementation (`FileInstaller`) orchestrates five steps: address check, local pre-checks, service
token fetch, ChurchTools checks with the candidate values, and writing under a lock. It reuses the 4.2 self-check
classes. Outgoing calls during setup go through a pinned, size-limited Guzzle configuration.

**Tech Stack:** PHP ^8.3, Slim 4, Monolog 2, Guzzle 7 (cURL handler), PHPUnit 12, PHPStan 2, PHP-CS-Fixer (PER).

**Spec:** [`backend-spec.md`](backend-spec.md): 3.1, 4.2, 4.9, **4.10**, 6.3, 6.5, **D6**. Every rule marked
**⏳ 4.6** belongs to this plan. Test cases go into a new catalog section **17. Setup (spec 4.10)** with the prefix
`SU-` in [`backend-test-catalog.md`](backend-test-catalog.md). Add a case to the catalog before its test, and tick it
in the commit that proves it.

**Can start now:** 4.1–4.5 are done (2026-11-12). Task 7 changes the closing hints of their `setup.sh` and their
`docs/setup.md`. The release workflow (`.github/workflows/backend-release.yml`) keeps building its zip with
`setup.sh`.

## Global Constraints

- Branch `feature/backend-cleanup`; one commit per task. Every commit passes `composer check` in `backend/`.
- Layer rules of `tests/Unit/Security/ArchitectureTest.php` hold: `Http` and `Application` never import
  `Infrastructure`.
- Errors follow the existing pattern: an exception extends `ApplicationException` (or `ChurchToolsException`) with a
  `Reason`; `ProblemMapping` maps every `Reason` exhaustively; extension members come from `Failure::extensions()`
  (like `PasswordRejectedException`'s `violations`). Controllers don't catch them; `ErrorMiddleware` answers.
- The deploy check (`bin/check-deploy.php`) rejects any `church.tools` host in shipped files except
  `example.church.tools` and `your.church.tools`. Messages and comments in `src/` use only those two; tests may use
  others.
- No new runtime dependency. Banned calls stay banned (`phpstan-security.neon`); randomness only from `random_bytes`.
- `JWT_SECRET` = base64url (no padding) of **48** `random_bytes` (spec 4.10.4).
- `credentials.php` mode **`600`**; `cache/` and `logs/` mode **`700`** (spec 3.1, 4.10.7).
- Lock file `config/.setup.lock`. Temp file in `config/`, then `rename`.
- `CT_API_URL` = `<Origin>/api`, `CORS` = `[<Origin>]`, with the `Origin` header **exactly as received** (spec 4.10.4).
- `/v1/setup` CORS headers in every mode: `Access-Control-Allow-Origin: *`,
  `Access-Control-Allow-Methods: GET, POST, OPTIONS`, `Access-Control-Allow-Headers: Content-Type`; never
  `Access-Control-Allow-Credentials` (spec 4.2).
- Problem types: `409 already-configured`, `422 setup-check-failed` (extension member `tests`),
  `503 not-configured` (spec 4.9). Add each to `ProblemType` and `backend/docs/problems.md` in the same commit.
- Outgoing setup calls: no redirects, timeout `GuzzleChurchToolsClient::DEFAULT_TIMEOUT_SECONDS` (5 s), response body
  at most **1 MiB** (`1048576` bytes; the spec only says "limited", this plan fixes the value), connection pinned to
  the checked IP.
- `servicePassword`, `oauthClientSecret`, the fetched token and `JWT_SECRET` never appear in logs, responses,
  exception messages or `var_dump`. Use `#[\SensitiveParameter]` and redacting `__debugInfo`, like `Credential`.
- Required PHP extensions for the pre-check: `curl`, `json`, `openssl`, `sodium`.
- Check names shown to the admin (exact strings): `Instance address`, `PHP version and extensions`,
  `Config folder writable`, `Cache folder`, `Log folder`, `File locking`, `Service user login`,
  `Extension module`, `Service user rights`, `Service user write rights`, `Password store readable`, `OAuth client`.

## Review Focus

1. **`config/` exists but PHP can't traverse it.** `file_exists()` then returns `false`, and the backend enters setup
   mode although a `credentials.php` may be there. Expected: `GET` reports `Config folder writable` = fail, and `POST`
   writes nothing and answers `500 misconfigured`. A file that isn't there for PHP mustn't be overwritten blindly.
   Pinned in Task 5 (`testUntraversableConfigFolderFailsWithoutWriting`).
2. **The `Origin` isn't in its canonical form** (`https://Example.church.tools`, `https://x.church.tools:443`,
   `https://x.church.tools.`, a trailing `/`). It goes into `CORS` verbatim and must later match the browser's header
   exactly. Expected: rejected as `Instance address` = fail, never stored. Pinned in Task 2.
3. **Secrets with special characters** (`'`, `\`, `?>`, `$x`, multi-byte UTF-8, a newline) in `oauthClientSecret`.
   Expected: written by `var_export`, loaded back identical, no code runs. Pinned in Task 5.
4. **The wizard retries after a timeout, but the first `POST` succeeded.** The second one gets `409`, and the wizard
   would raise a false takeover warning. The backend can't tell the two apart. Task 7 adds the 5.1 rule: on `409`,
   try the OAuth login first; if it works, the setup was ours. Pinned in Task 6 (`testSecondPostAfterSuccessIs409`)
   for the backend side.
5. **ChurchTools (or a host posing as it) answers with a redirect, a huge body or slowly.** Expected: no redirect
   followed, the transfer aborted above 1 MiB, the 5-second timeout, each reported as a failed check or `502`.
   Pinned in Task 2 (`testPinnedOptionsAbortAboveOneMebibyte`, `testRedirectIsNotFollowed`).

---

### Task 1: Modes, setup routes, CORS and problem types

**Files:**
- Create: `backend/src/Application/Port/Installer.php`, `backend/src/Application/Setup/SetupValues.php`,
  `backend/src/Application/Setup/SetupReport.php`, `backend/src/Application/Exception/AlreadyConfiguredException.php`,
  `backend/src/Application/Exception/SetupCheckFailedException.php`, `backend/src/Http/Controller/SetupController.php`,
  `backend/src/Http/Middleware/SetupCorsMiddleware.php`
- Create also: `backend/src/Application/Exception/NotConfiguredException.php`
- Modify: `backend/src/Kernel.php`, `backend/src/Http/Problem/ProblemType.php`,
  `backend/src/Application/Failure/Reason.php`, `backend/src/Http/Problem/ProblemMapping.php`,
  `backend/docs/problems.md`, `specs/backend-test-catalog.md` (new section 17)
- Test: `backend/tests/Api/SetupModesApiTest.php`, `backend/tests/Unit/Http/ProblemTypeTest.php` (extend)

**Interfaces:**
- Produces:
  - `final readonly class SetupValues(string $serviceLogin, #[\SensitiveParameter] string $servicePassword, string $oauthClientId, #[\SensitiveParameter] string $oauthClientSecret)`;
    `__debugInfo()` redacts both secrets.
  - `final readonly class SetupReport(string $version, list<array{name: string, status: 'ok'|'fail', message: string}> $tests, ?string $instanceUrl = null, ?string $oauthClientId = null)`;
    `passed(): bool`.
  - `interface Installer { public function precheck(): SetupReport; public function install(string $origin, SetupValues $values, string $clientIp): SetupReport; }`.
    `$clientIp` is `REMOTE_ADDR`, used only for the log (spec 4.10.9).
    `install` throws `AlreadyConfiguredException`, `SetupCheckFailedException` (public `SetupReport $report`),
    `ConfigurationException` (writing failed), and `ChurchToolsException` subclasses unchanged (they become `502`
    through the existing error middleware).
  - New reasons `Reason::AlreadyConfigured`, `Reason::SetupCheckFailed` and `Reason::NotConfigured`, mapped in
    `ProblemMapping` to the three new problem types, each with a fixed detail. The three exceptions extend
    `ApplicationException` with those reasons. `SetupCheckFailedException::extensions()` returns
    `['tests' => $this->report->tests]`.
  - `SetupController::__construct(Installer $installer)`:
    - `get` answers `200 {"state": "unconfigured", "version", "tests"}`.
    - `post` reads the `Origin` header line and `REMOTE_ADDR`, then `JsonBody::parse` with the four string fields `serviceLogin`,
      `servicePassword`, `oauthClientId` and `oauthClientSecret`. If any is missing or empty: `400 invalid-body` naming
      the field.
    - `201 {"instanceUrl", "oauthClientId", "version", "tests"}` on success. Exceptions pass through to
      `ErrorMiddleware`.
  - `SetupCorsMiddleware`: for the path `/v1/setup` only, it answers `OPTIONS` with `204` and adds the three headers
    of the Global Constraints to every response; other paths pass through untouched. It sits **outside**
    `CorsMiddleware` (added after it), so the normal CORS never sees this route.
  - `Kernel::bootstrap()`:
    - `!file_exists($credentialsPath)` → `Kernel::setup(...)`;
    - else unreadable or invalid → `misconfigured()`, as today;
    - else `create()`.
  - `Kernel::setup(string $credentialsPath, string $cacheDir, string $logFile, Installer $installer, string $version): App`
    (Task 6 adds a factory that builds the real installer):
    - routes `GET`/`POST /v1/setup`; every other path and method throws `NotConfiguredException`
      (`503 not-configured`, "The backend isn't set up yet. Run the setup wizard in the CtPassStore extension.");
    - middleware: security headers, `SetupCorsMiddleware`, `HttpsOnlyMiddleware`, error middleware.
  - `create()` adds `GET`/`POST /v1/setup` → `AlreadyConfiguredException` (`409 already-configured`), outside the authentication group, with no
    detail about the instance. `misconfigured()` adds `SetupCorsMiddleware` so its `500` on `/v1/setup` is readable.

- [ ] **Step 1: Add catalog section 17** with SU-01…SU-05 (modes, CORS in three modes, 503 elsewhere, 409, body
  validation).
- [ ] **Step 2: Write the failing API tests** (`SetupModesApiTest`, with a stub `Installer` returning fixed reports):
  `testMissingCredentialsGivesSetupMode` (`GET /v1/setup` 200, `state` = `unconfigured`);
  `testOtherRoutesInSetupModeAre503` (`GET /v1/entries/1`, `POST /v1/auth/token` → `not-configured`);
  `testUnreadableCredentialsIsMisconfiguredNotSetup` (chmod `000`; skip when running as root);
  `testBrokenCredentialsIsMisconfiguredNotSetup` (file returns `42`);
  `testConfiguredBackendAnswers409` (GET and POST);
  `testPreflightOnSetupHasWildcardInAllModes` (three modes, `Origin: https://evil.example`: `204`, `*`, no
  `Allow-Credentials`);
  `testSetupResponsesCarryWildcardInAllModes`; `testPostWithoutServicePasswordIs400`;
  `testCheckFailureIs422WithTests` (stub throws `SetupCheckFailedException`; body has `tests`).
- [ ] **Step 3: Run** `vendor/bin/phpunit tests/Api/SetupModesApiTest.php` — FAIL (classes missing).
- [ ] **Step 4: Implement** the interfaces above; problem types with titles `Already configured`,
  `Setup check failed`, `Not configured`; `problems.md` entries with cause and fix (409: "delete
  `config/credentials.php` over FTP and run the wizard again").
- [ ] **Step 5: Run** `composer check` — PASS (architecture test included).
- [ ] **Step 6: Tick SU-01…SU-05; commit** `Backend: setup mode, /v1/setup routes and problem types (4.6)`

### Task 2: Instance address and pinned outgoing calls

**Files:**
- Create: `backend/src/Infrastructure/Setup/InstanceAddress.php`
- Modify: `backend/src/Infrastructure/ChurchTools/GuzzleChurchToolsClient.php`
- Test: `backend/tests/Unit/Infrastructure/Setup/InstanceAddressTest.php`,
  `backend/tests/Unit/Infrastructure/ChurchTools/GuzzleChurchToolsClientTest.php` (extend)

**Interfaces:**
- Produces:
  - `final readonly class InstanceAddress(string $origin, string $host, int $port, string $ip)`;
    `apiUrl(): string` = `$origin . '/api'`;
    `static fromOrigin(string $origin, ?\Closure $lookup = null): self`, where `$lookup` is
    `\Closure(string $host): list<string>` (the IPs). The default uses `dns_get_record($host, DNS_A | DNS_AAAA)`.
    Throws `\InvalidArgumentException` with an admin-readable message.
  - Rules (spec 4.10.5.1):
    - the origin must match `^https://[a-z0-9.-]+(:[0-9]{1,5})?\z`; no uppercase, no trailing dot, no `:443`, no path;
    - the host isn't an IP literal;
    - at least one IP is found;
    - **every** IP passes `filter_var(FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)`,
      and IPv6 additionally isn't in `fc00::/7`, `fe80::/10` or `::ffff:0:0/96`;
    - the first IP is pinned.
  - `GuzzleChurchToolsClient::guzzleOptions(string $apiUrl, float $timeoutSeconds = self::DEFAULT_TIMEOUT_SECONDS, ?InstanceAddress $pin = null): array`.
    With `$pin`, it adds:
    - `'curl' => [CURLOPT_RESOLVE => ["{$host}:{$port}:{$ip}"]]` (IPv6 in brackets);
    - a `RequestOptions::PROGRESS` callback that throws once the downloaded bytes exceed `MAX_PINNED_RESPONSE_BYTES = 1048576`.
    
    The constructor gets a trailing `?InstanceAddress $pin = null` and passes it on.

- [ ] **Step 1: Write the failing tests** (catalog SU-06, SU-07). `InstanceAddressTest`, with a fake `$lookup`:
  - accepted, IP pinned: `https://example.church.tools` → `93.184.216.34`; `https://x.church.tools:8443`;
  - rejected:
    - `http://x.church.tools`;
    - `https://Example.church.tools`;
    - `https://x.church.tools:443`;
    - `https://x.church.tools.`;
    - `https://x.church.tools/`;
    - `https://user@x.church.tools`;
    - `https://127.0.0.1`;
    - `https://[::1]`;
    - a host resolving to `10.0.0.5`, to `169.254.1.1`, to `fd00::1`, or to `::ffff:127.0.0.1`;
    - a host resolving to one public and one private IP;
    - a host that resolves to nothing;
    - an empty origin.
  - `GuzzleChurchToolsClientTest`:
    - `testPinnedOptionsResolveToTheCheckedIp` (the `curl` option is present and exact);
    - `testPinnedOptionsAbortAboveOneMebibyte` (call the progress callback with `1048577`, expect an exception);
    - `testRedirectIsNotFollowed` (MockHandler `302` with `Location` → `InvalidResponseException` or the existing
      mapping, never a second request);
    - `testOptionsWithoutPinAreUnchanged`.
- [ ] **Step 2: Run** the two test files — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `composer check` — PASS.
- [ ] **Step 5: Tick SU-06, SU-07; commit** `Backend: instance address check and pinned setup calls (4.6)`

### Task 3: Fetch the service user's token

**Files:**
- Create: `backend/src/Infrastructure/ChurchTools/ServiceTokenFetcher.php` (interface),
  `backend/src/Infrastructure/ChurchTools/GuzzleServiceTokenFetcher.php`,
  `backend/src/Infrastructure/ChurchTools/FetchedToken.php`,
  `backend/src/Infrastructure/ChurchTools/Exception/ServiceLoginRejectedException.php`
- Modify: `backend/tests/Support/FakeChurchToolsClient.php` (implements the interface; `setLoginToken(int $personId, string $token)`)
- Test: `backend/tests/Unit/Infrastructure/ChurchTools/GuzzleServiceTokenFetcherTest.php`,
  `backend/tests/Contract/ChurchToolsClientContractTest.php` (one case)

**Interfaces:**
- Produces:
  - `interface ServiceTokenFetcher { public function fetch(string $login, #[\SensitiveParameter] string $password): FetchedToken; }`
  - `final readonly class FetchedToken(int $personId, #[\SensitiveParameter] string $token)`, with a redacting `__debugInfo`.
  - `GuzzleServiceTokenFetcher::__construct(InstanceAddress $address, ?ClientInterface $http = null)`. It uses
    `guzzleOptions($address->apiUrl(), pin: $address)` plus a **fresh `CookieJar` per `fetch`**, never shared. The
    steps:
    1. `POST login` with `{"username", "password"}`. `400`, `401` and `403` → `ServiceLoginRejectedException`
       ("ChurchTools rejected the service user's login name or password.").
    2. `data.status` must be `success`. `totp` or `twoFactorSetup` → `ServiceLoginRejectedException`
       ("ChurchTools asks the service user for a second factor. Turn off two-factor login for this person.").
    3. `GET persons/{personId}/logintoken` → `data` must be a non-empty string.
    
    Other failures use the existing `ChurchToolsException` subclasses.
  - `ServiceLoginRejectedException extends ChurchToolsException` with `REASON = Reason::ServiceUserRejected` (exists);
    its message never contains the login or the password.

- [ ] **Step 1: Write the failing tests** (SU-08). With MockHandler and history middleware:
  - the happy path: the second request carries the cookie of the first, and the result has the person ID and token;
  - wrong password `401` → rejected;
  - `totp` → rejected with the second-factor message;
  - the token is missing or empty → `InvalidResponseException`;
  - `testTwoFetchesDoNotShareCookies`;
  - `testExceptionMessagesContainNoPasswordOrToken`.
  
  Contract case `testServiceTokenCanBeFetchedWithLoginAndPassword`: with the fixture user from `normal_users.json`,
  `fetch` returns a token, and `whoami` with that token returns the fixture's ID (measured 2026-11-11: a repeated
  `GET` returns the same token, so the fixture user isn't disturbed).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**; the fake's `fetch` uses `addLogin` data and `setLoginToken`.
- [ ] **Step 4: Run** `composer check` — PASS; `composer test:contract -- --filter ServiceTokenCanBeFetched` — PASS.
- [ ] **Step 5: Tick SU-08; commit** `Backend: fetch the service user's token with login and password (4.6)`

### Task 4: Self-check for the service user's write rights

The spec's "enough rights for the extension's categories" (4.10.5.3) has no check yet. 4.8 only checks for *too
many* rights, plus read access to `passwordStore`.

**Files:**
- Create: `backend/src/Infrastructure/SelfCheck/ServiceUserWriteRightsCheck.php`
- Modify: `backend/src/Kernel.php` (add to `/v1/test`), `specs/backend-spec.md` 4.8 (one bullet, **⏳ 4.6**: "the
  service user may create, edit and delete values in `passwordStore`")
- Test: `backend/tests/Unit/Infrastructure/SelfCheck/ServiceUserWriteRightsCheckTest.php`, `backend/tests/Api/SelfCheckApiTest.php`

**Interfaces:**
- Produces: `ServiceUserWriteRightsCheck::__construct(ChurchToolsClient $client, ExtensionData $data)`, named
  `Service user write rights`. It is ok when `ctpassstore` `create custom data`, `edit custom data` and
  `delete custom data` each contain `categoryIdOf('passwordStore')`; otherwise fail, naming the missing rights.

- [ ] **Step 1: Write the failing tests** (add a case with the next free `TS-` number to the catalog's `/v1/test`
  section first):
  - the minimal service user of Task 9 (phase-4 plan) → ok;
  - without `delete custom data` → fail naming it;
  - `testServiceUserWithoutWriteRightsFails` (API: `207`, exactly this check fails).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement and wire.** **Step 4: Run** `composer check` — PASS.
- [ ] **Step 5: Commit** `Backend: self-check for the service user's write rights (4.6)`

### Task 5: Local pre-checks and the credentials writer

**Files:**
- Create: `backend/src/Infrastructure/Setup/PhpRuntimeCheck.php`, `.../WritableFolderCheck.php`,
  `.../LockingCheck.php`, `.../CredentialsWriter.php`
- Test: `backend/tests/Unit/Infrastructure/Setup/PrechecksTest.php`, `.../CredentialsWriterTest.php`

**Interfaces:**
- Consumes: `Check`, `CheckOutcome` (phase-4 Task 8).
- Produces:
  - `PhpRuntimeCheck` (`PHP version and extensions`): `PHP_VERSION_ID >= 80300` and the four extensions are loaded.
    The constructor takes `?\Closure(string): bool $loaded = null` for tests.
  - `WritableFolderCheck::__construct(string $name, string $directory, bool $mayCreate)`. It is ok if the folder is
    writable, or if it's missing, `$mayCreate` holds and its parent is writable. It never creates anything. Used as
    `Config folder writable` (`$mayCreate = false`), `Cache folder` and `Log folder` (both `true`). Messages use the
    relative name (`config/`), never the absolute path.
  - `LockingCheck::__construct(string $directory)` (`File locking`): takes an exclusive `flock` on a probe file;
    a second non-blocking attempt through another handle is refused. If the folder is missing, it probes in the
    parent and reports that.
  - `CredentialsWriter::__construct(string $configDir)`:
    - `write(array $values): void`, where `$values` is `array<string, string|list<string>>` with exactly the keys of
      spec 3.1.
    - Steps:
      1. `fopen('.setup.lock', 'c')` and `flock(LOCK_EX)`;
      2. `file_exists('credentials.php')` → `AlreadyConfiguredException`;
      3. `tempnam` in `$configDir`;
      4. write `"<?php\n\nreturn " . var_export($values, true) . ";\n"`;
      5. `chmod 0600`;
      6. `rename`;
      7. unlock.
    - Any failure removes the temp file and throws `ConfigurationException` naming `config/` as not writable.
    - `ensureFolder(string $directory): void` creates it with mode `0700` if missing.

- [ ] **Step 1: Write the failing tests** (SU-09…SU-12):
  - **Pre-checks:** each one ok and failing on its own; for example, a missing extension via `$loaded`, a read-only
    `config/` (`chmod 0500`), a missing `cache/` with a writable parent → ok.
  - **`testUntraversableConfigFolderFailsWithoutWriting`:** `config/` with mode `0300`. The writer throws
    `ConfigurationException`, and afterwards no file except the lock exists, checked with `chmod 0700` first.
  - **Writer:**
    - **`testWrittenFileLoadsThroughBackendConfig`:** `BackendConfig::fromArray(require …)` equals the input.
    - **`testSpecialCharactersRoundTrip`:** the secret is
      `"a'b\\c?><?php echo 1; \$x\n\u{00e4}\u{1F511}"`; it loads back identical and the output contains no `echo 1`
      outside a string.
    - **`testFileModeIs600`.**
    - **`testExistingFileThrowsAlreadyConfigured`:** the file is unchanged afterwards.
    - **`testParallelWritesHaveOneWinner`:** two processes via `tests/Support/PhpProcess.php` write at once; exactly
      one succeeds and the other gets `AlreadyConfiguredException`.
    - **`testFailedWriteLeavesNoTempFile`.**
    - **`testEnsureFolderUses700`.**
  
  Skip the permission-based tests when running as root.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** `composer check` — PASS.
- [ ] **Step 5: Tick SU-09…SU-12; commit** `Backend: setup pre-checks and the credentials writer (4.6)`

### Task 6: `FileInstaller` and wiring

**Files:**
- Create: `backend/src/Infrastructure/Setup/FileInstaller.php`
- Modify: `backend/src/Kernel.php` (extract `Kernel::selfCheck(...)` from `create()`, add
  `Kernel::installer(...)`, call it from `bootstrap()`, add `Kernel::setupLogger()`)
- Test: `backend/tests/Unit/Infrastructure/Setup/FileInstallerTest.php`, `backend/tests/Api/SetupApiTest.php`

**Interfaces:**
- Consumes: Tasks 1–5; `ServiceUserRightsCheck`, `PasswordStoreReadCheck`, `OAuthClientCheck` and
  `ExtensionData::categoryIdOf(string $name): int` (phase-4 Task 9).
- Produces:
  - `FileInstaller implements Installer`. Constructor arguments:
    - `string $configDir`, `string $cacheDir`, `string $logDir`;
    - `CredentialsWriter $writer`;
    - `list<Check> $prechecks`;
    - `\Closure(string $origin): InstanceAddress $resolve`;
    - `\Closure(InstanceAddress): ServiceTokenFetcher $fetchers`;
    - `\Closure(InstanceAddress, Credential): ChurchToolsClient $clients`;
    - `\Closure(BackendConfig, ChurchToolsClient): SelfCheck $selfChecks`;
    - `LoggerInterface $logger`, `string $version`.
  - `precheck()`: if `credentials.php` exists → `AlreadyConfiguredException`; else runs `$prechecks`.
  - `install()`, in the order of spec 4.10.5–8. A failure stops the run, and every check that didn't run is reported
    as `fail` with the message `Not run, because an earlier check failed.`:
    1. `credentials.php` exists → `AlreadyConfiguredException`.
    2. `Instance address`: `$resolve($origin)`; `\InvalidArgumentException` → fail with its message.
    3. The pre-checks.
    4. `Service user login`: fetch the token, then `whoami(Credential::loginToken($token))` must return the
       fetched `personId` (spec 4.10.5.3). `ServiceLoginRejectedException` or a different person → fail with an
       admin-readable message. `UnavailableException` and the like propagate (`502`).
    5. Build the candidate `BackendConfig::fromArray([... 'JWT_SECRET' => <48 bytes base64url>], …)` and the client
       with the fetched token. Then run `Extension module` (ok when `categoryIdOf('passwordStore')` resolves; it needs `view` on the
       extension, measured 2026-11-10), `Service user rights`,
       `Service user write rights`, `Password store readable` and `OAuth client` through `SelfCheck` (so unexpected
       exceptions become generic fails).
    6. Any fail → `SetupCheckFailedException(new SetupReport($version, $tests))`.
    7. Write: `$writer->write(...)`, then `ensureFolder` for `cache/` and `logs/`.
    8. `($selfChecks)($config, $client)->run(false)` → report with `instanceUrl` = origin and the client ID.
    9. Log: success as `info` "Backend set up for {origin} from {ip}"; check failure as `warning` with the failed
       check names and `$clientIp`.
  - `Kernel::installer(string $credentialsPath, string $cacheDir, string $logFile, string $version, ?\Closure $resolve = null, ?\Closure $fetchers = null, ?\Closure $clients = null): FileInstaller`.
    The defaults: `InstanceAddress::fromOrigin`, `GuzzleServiceTokenFetcher`, and `GuzzleChurchToolsClient` with
    `pin:`. The API tests pass the fake ChurchTools for both closures and a fixed resolver.
  - `Kernel::setupLogger(string $logFile, string $version): LoggerInterface`: `Kernel::logger(...)` if `logs/`
    exists or can be created; otherwise Monolog with `ErrorLogHandler` (spec 4.10.9).

- [ ] **Step 1: Write the failing tests** (SU-13…SU-18):
  - **`FileInstallerTest`**, with temp folders, `FakeChurchToolsClient` and a Monolog `TestHandler`:
    - the happy path: `credentials.php` loads, `CT_API_URL` = `https://example.church.tools/api`, `CORS` =
      `['https://example.church.tools']`, `JWT_SECRET` decodes to 48 bytes, and the report has `instanceUrl` and
      `oauthClientId`;
    - each check failing on its own → `SetupCheckFailedException`, **no `credentials.php`, `cache/` or `logs/`**, and
      the later checks show `Not run…`:
      - a bad origin;
      - a wrong password;
      - a token whose `whoami` is another person;
      - `totp`;
      - a missing module;
      - an admin-rights service user;
      - missing write rights;
      - the OAuth client is rejected;
    - ChurchTools unavailable → the exception propagates and nothing is written;
    - `testPasswordAndTokenNeverLogged`: search every log record and the serialized report for the password, the
      token, the client secret and the `JWT_SECRET`;
    - `testSecondInstallIsAlreadyConfigured`.
  - **`SetupApiTest`**, through `Kernel::setup` with the real `FileInstaller`:
    - **`testFullSetupThenNormalApp`:** `POST` → `201`. A second `Kernel::bootstrap` on the same folder serves the
      normal app: `POST /v1/auth/token` with a fake code works, and `/v1/setup` answers `409`.
    - **`testSecondPostAfterSuccessIs409`.**
    - **`testOriginHeaderMissingIs422`.**
    - **`testResponseContainsNoSecrets`.**
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement and wire** `bootstrap()` → `setup(..., Kernel::installer(...), ...)`.
- [ ] **Step 4: Run** `composer check` — PASS. (A local `php -S` server can't pass the HTTPS check of spec Q17;
  the end-to-end path is covered by `SetupApiTest` and by Task 7's check on a real host.)
- [ ] **Step 5: Tick SU-13…SU-18; commit** `Backend: install from the setup wizard (4.6)`

### Task 7: Docs, build script, spec and plan

**Files:**
- Modify:
  - `backend/docs/setup.md` (rewrite);
  - `backend/setup/setup.sh` (closing hints only);
  - `backend/README.md` (the `/v1/setup` endpoint);
  - `specs/backend-spec.md`:
    - remove the **⏳ 4.6** markers;
    - fix 6.5: **`setup.sh` stays** as the build script the release workflow (phase-4 Task 14) and developers use;
      admins no longer run it;
  - `specs/backend-plan.md`:
    - tick 4.6;
    - add to 5.1's binding check: "on `409`, try the OAuth login first; if it works, the setup was ours (a retried
      `POST` after a timeout)";
    - change "Remove `setup/setup.sh`" accordingly.

**Interfaces:** none (docs and wording).

- [ ] **Step 1: Rewrite `setup.md`:**
  1. download the release zip;
  2. upload it by FTP;
  3. make `public/` the web root;
  4. **continue in the extension's setup wizard right after the upload, without a break**, and why.
  
  Troubleshooting: `409` and re-arm (delete `config/credentials.php`, run the wizard again), HTTPS and certificate
  errors, a web root that ignores `.htaccess`, a `config/` folder PHP can't write, two-factor login on the service
  user, a self-hosted ChurchTools reachable only internally (write `credentials.php` by hand; that section stays).
- [ ] **Step 2: `setup.sh`:** replace the closing "fill in `credentials.php`" steps with "upload, then run the setup
  wizard in the extension; writing `credentials.php` by hand stays possible (docs/setup.md)". Keep the modes and the
  deploy check.
- [ ] **Step 3: Spec and plan edits** as listed under Files.
- [ ] **Step 4: Manual end-to-end check on the test instance.** It needs:
  - a backend on a public HTTPS host without `credentials.php`;
  - a service user as 5.1 describes it ("CtPassStore API", `ctpassstore-api`, the service-user rights), its password
    set with `setPersonPassword` (see the API facts under 5.1 in `backend-plan.md`);
  - an OAuth client.

  `curl -X POST https://<backend>/v1/setup -H 'Origin: https://jeremia-090218c7.church.tools' -H 'Content-Type: application/json' -d '{…}'`
  must give `201`, and a second call `409`. If no public host is available, skip this step and say so; the
  extension's wizard (5.1) will exercise it.
- [ ] **Step 5: Run** `composer check` and `bash setup/setup.sh <temp>` — PASS.
- [ ] **Step 6: Commit** `Backend: setup docs and spec for the setup endpoint (4.6)`
