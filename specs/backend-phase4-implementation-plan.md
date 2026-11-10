# Backend Phase 4 (Operations and Release) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement items 4.1–4.5 of [`backend-plan.md`](backend-plan.md): the settings and ID cache, the per-address
limit, the full self-check, hardening, deployment and the first release of the new API.

**Architecture:** The layers stay as they are (`Domain`, `Application`, `Infrastructure`, `Http`, wired only in
`src/Kernel.php`; the architecture test guards the direction). New persistence reuses the signing scheme of
`SignedFileStore`; the self-check moves onto application ports so `Http` no longer imports `Infrastructure`.

**Tech Stack:** PHP ^8.3, Slim 4, Monolog 2, Guzzle 7, firebase/php-jwt, PHPUnit 12, PHPStan 2, PHP-CS-Fixer (PER).

**Spec:** [`backend-spec.md`](backend-spec.md) — every rule marked **⏳ 4.x** there belongs to this plan. Test cases
come from [`backend-test-catalog.md`](backend-test-catalog.md); tick a case (`[x]`) in the same commit that proves it.
A case added during implementation goes into the catalog first (plan "How we work").

## Global Constraints

- Branch: all of phase 4 is built on `feature/backend-cleanup` (decided 2026-11-10); one commit per task.
- Every commit passes `composer check` (code style, PHPStan, unit and API tests) in `backend/`.
- Cite spec sections as "spec 6.1" / "spec 5.3.10" in comments and test docblocks, like the existing code.
- No new runtime dependency. Monolog's `RotatingFileHandler` is already available.
- Never `serialize`/`unserialize`, `rand`/`mt_rand`, `str_shuffle`, `eval`, shell calls (`phpstan-security.neon`).
- Secrets (`JWT_SECRET`, tokens, passwords, codes, client secret, ciphertexts) never appear in logs, problem details,
  `/v1/test` output or exception messages (spec 4.1, 6.3).
- `REMOTE_ADDR` only; forwarding headers are ignored (spec 6.3).
- Cache folder: files `600`, folder `700`; JSON only; HMAC keyed from `JWT_SECRET` (spec 6.1).
- TTLs: module/category IDs **3600 s**, settings and public key **60 s**; `passwordStore` values are never cached.
- Per-address limit (Q26): `POST /v1/auth/token` **30**/min, rejected tokens **60**/min, **256** buckets, IPv6 per
  `/64`; the block lasts until the 60-second window has passed.
- `/v1/test` fails above **10,000** files in the cache folder.
- Logs rotate daily, **14** files kept (spec 6.4).
- Version string `x.y.z`, `x.y.z+<sha>`, `x.y.z+<sha>-dirty` (spec 6.5). Version after 4.5:
  **`0.1.0`** (decided 2026-11-10).
- After any spec change (new problem type, new rule), update `backend/docs/problems.md` and the spec in the same commit.

## Review Focus

1. **Settings changed by the test helper after the cache exists.** `ApiTestCase::setSettings()` called after a first
   request must still take effect, or dozens of existing API tests silently test stale settings. Pinned in Task 3.
2. **A cached settings file planted by another webspace user** (`adminUsers: [99]` with a guessed or missing HMAC) must
   never grant admin. Pinned in Task 2 (CA-08) and Task 3 (API test `testAPlantedSettingsCacheGrantsNothing`).
3. **One parish behind one NAT address.** 25 legitimate logins within a minute from one address must all succeed;
   only the 31st is refused. Pinned in Task 6 (`testThirtyLoginsFromOneAddressPass`).
4. **A proxy/host that never sets `HTTPS`.** The HTTPS check must use exactly the `.htaccess` condition, so a host
   where the redirect works never gets `400` from PHP. Pinned in Task 11 (`testHttpsOnIsAccepted`, `testHttpsMissingIsRejected`).
5. **`HEAD` on a `GET` route.** Slim may route `HEAD` to the `GET` handler; the spec requires `405`. Pinned in Task 11
   (HP-02).

---

## Item 4.1 – Cache (spec 6.1, 5.3.10, 5.4.2)

### Task 1: Extract the signing scheme from `SignedFileStore`

Behavior-neutral refactoring so the cache (Task 2) can reuse the exact format.

**Files:**
- Create: `backend/src/Infrastructure/Store/RecordSigner.php`, `backend/src/Infrastructure/Store/OpenedRecord.php`
- Modify: `backend/src/Infrastructure/Store/SignedFileStore.php` (constructor, `verified()`, `mac()`, the sealing in `update()`)
- Test: `backend/tests/Unit/Infrastructure/Store/RecordSignerTest.php`

**Interfaces:**
- Produces:
  - `RecordSigner::__construct(#[\SensitiveParameter] string $jwtSecret, string $purpose)` — key =
    `hash_hmac('sha256', $purpose, $jwtSecret, true)`, key ID = first 16 hex chars of `sha256(key)`, as today.
  - `RecordSigner::seal(string $name, array $data): string` — the file content `{format, keyId, data, mac}` as today.
  - `RecordSigner::open(string $name, string $raw): OpenedRecord`
  - `final readonly class OpenedRecord { public OpenedStatus $status; public array $data; }` with
    `enum OpenedStatus { case Valid; case OldKey; case Tampered; }` (same file). Empty `$raw` → `Valid` with `[]`.
  - `SignedFileStore::PURPOSE = 'ctpassstore security store v1'` — must stay byte-identical so existing files verify.

- [ ] **Step 1: Write the failing tests** — `testSealedRecordOpensAsValid`, `testOtherKeyOpensAsOldKey`,
  `testChangedDataOpensAsTampered`, `testMissingMacOpensAsTampered`, `testSerializedPhpObjectOpensAsTampered`
  (`O:8:"stdClass":0:{}` as raw content; CA-09), `testRecordNameIsPartOfTheMac` (sealed as `a`, opened as `b` → Tampered),
  `testFormatIsUnchanged` (a file sealed by the signer equals one written by the current `SignedFileStore` for the same
  name, data and secret — decode both and compare `keyId`, `data`, `mac`).
- [ ] **Step 2: Run** `vendor/bin/phpunit --filter RecordSignerTest` — expect FAIL (class not found).
- [ ] **Step 3: Implement `RecordSigner`, `OpenedRecord`, `OpenedStatus`; make `SignedFileStore` delegate to them.**
  `SignedFileStore` keeps its public API and its log/exception texts.
- [ ] **Step 4: Run** `composer check` — expect PASS, including the unchanged `SignedFileStoreTest`.
- [ ] **Step 5: Security-store part of CA-10 and CA-11:** check that `SignedFileStoreTest` proves "current key ID,
  wrong or missing MAC → `ConfigurationException`, never an empty record" and "old key ID → record starts over, no
  exception". Add `testTamperedRecordFailsClosed` / `testOldKeyRecordStartsOver` where missing; tick CA-10 and the
  security-store half of CA-11.
- [ ] **Step 6: Commit** `Backend: RecordSigner, the signing scheme of the security store on its own (4.1)`

### Task 2: `SignedFileCache`, a fail-open cache with TTL

**Files:**
- Create: `backend/src/Infrastructure/Store/SignedFileCache.php`
- Test: `backend/tests/Unit/Infrastructure/Store/SignedFileCacheTest.php`

**Interfaces:**
- Consumes: `RecordSigner` (Task 1), `Application\Port\Clock`.
- Produces:
  - `SignedFileCache::PURPOSE = 'ctpassstore cache v1'`
  - `__construct(string $directory, RecordSigner $signer, Clock $clock, LoggerInterface $logger)`
  - `get(string $name): ?array` — `null` when missing, expired, unreadable, signed with an old key, or tampered.
  - `put(string $name, array $data, int $ttlSeconds): void` — never throws; a failure is logged as `warning`.
  - `forget(string $name): void`
  - File name: `cache-<sha256($name)>.json`; content = `seal($name, ['expires' => int, 'data' => array])`.
    (Security records keep their `sec-` prefix, so the two never collide.)
  - Writes go through a temporary file and `rename`, created `600`; the folder is created `700`.

- [ ] **Step 1: Write the failing tests:**
  - `testPutThenGetWithinTtl`, `testGetAfterTtlIsNull` (FrozenClock `advance(61)` with TTL 60; CA-02)
  - `testTamperedEntryIsNullAndLogsError` (current key ID, wrong MAC, `adminUsers: [99]` in data; assert `null` and one
    `error` record; CA-08)
  - `testOldKeyEntryIsNullWithoutError` (written with another secret; CA-11)
  - `testUnwritableFolderNeverThrows` (folder `chmod 0500`; `put` returns, `get` is `null`; CA-05)
  - `testCorruptFileIsNull` (`"{"`; CA-05)
  - `testFilesAre600AndFolder700` (CA-08)
  - `testFileContainsNoSecret` (the `JWT_SECRET` string isn't in the file; CA-04)
- [ ] **Step 2: Run** `vendor/bin/phpunit --filter SignedFileCacheTest` — expect FAIL.
- [ ] **Step 3: Implement `SignedFileCache`.**
- [ ] **Step 4: Run** `composer check` — expect PASS.
- [ ] **Step 5: Tick CA-04, CA-05, CA-08, CA-09, CA-11 (cache part) in the catalog; commit**
  `Backend: SignedFileCache, a fail-open file cache with TTL (4.1)`

### Task 3: Cache settings, public key and IDs; re-resolve stale IDs

**Files:**
- Modify: `backend/src/Infrastructure/Kv/KvSettingsRepository.php`, `backend/src/Infrastructure/Kv/ExtensionData.php`,
  `backend/src/Kernel.php`, `backend/tests/Api/ApiTestCase.php` (`setSettings()`, the encryption seeding)
- Test: `backend/tests/Unit/Infrastructure/Kv/KvSettingsRepositoryTest.php`, `.../ExtensionDataTest.php`,
  `backend/tests/Api/CacheApiTest.php` (new)

**Interfaces:**
- Consumes: `SignedFileCache` (Task 2).
- Produces:
  - `KvSettingsRepository::__construct(ExtensionData $extension, LoggerInterface $logger, ?SignedFileCache $cache = null)`;
    `SETTINGS_TTL = 60`; cache names `settings` and `publicKey`. It caches the **decoded raw JSON** of the value (before
    `SettingsParser::parse`), so validation and findings run on every request exactly as today.
  - `ExtensionData::__construct(ChurchToolsClient $client, string $extensionKey = KvSchema::EXTENSION_KEY, ?SignedFileCache $cache = null)`;
    `IDS_TTL = 3600`; cache name `ids` with `{moduleId: int, categories: list<{id:int,name:string}>}`.
  - Stale IDs (spec 5.3.10): `values()` and `create()` catch `NotFoundException` **only when the IDs came from the
    cache**, forget `ids`, resolve once more and retry once. `update()`/`delete()` don't (their `404` means "value
    gone", spec 5.3.6). A second `404` propagates (→ `500 misconfigured`).
  - `ApiTestCase::setSettings()` and any test that changes the encryption value afterwards delete
    `glob($this->cacheDir . '/cache-*')`, so changed settings take effect at once.

- [ ] **Step 1: Write the failing unit tests:**
  - `KvSettingsRepositoryTest::testSettingsAreLoadedOnceWithinTtl` (two repository instances sharing one cache → the
    fake records **one** `getValues` for the settings category; CA-01)
  - `…::testSettingsAreReloadedAfterTtl` (`advance(61)`; CA-02)
  - `…::testInvalidCachedSettingsStillFailValidation` (cache holds `passwordLength: 3` → `ConfigurationException`)
  - `ExtensionDataTest::testIdsAreResolvedOnceWithinTtl`
  - `…::testStaleCachedIdsAreResolvedExactlyOnceMore` (fake answers `404` for the cached category ID, then knows the
    new one → success; one extra `getModuleByKey` + `getCategories`; ST-18)
  - `…::testPersistentNotFoundIsNoLoop` (fake answers `404` again → `NotFoundException`; exactly one re-resolution; ST-18)
  - `…::testFreshIdsAreNotReresolved` (IDs just resolved in this request, `404` → propagates without retry)
- [ ] **Step 2: Write the failing API tests** in `CacheApiTest`:
  - `testPasswordStoreIsNeverCached` (PUT then GET in two requests → GET returns the new value; CA-03)
  - `testAPlantedSettingsCacheGrantsNothing` (write a `cache-<sha256('settings')>.json` with `adminUsers: [10]` and a
    wrong MAC → user 10 still gets `403` on another person's entry; one `error` log record; Review Focus 2)
  - `testChangedSettingsApplyAfterSetSettings` (request, `setSettings(['allowCustomPassword' => false])`, request →
    `400 custom-password-not-allowed`; Review Focus 1)
  - `testCacheFolderIsOutsidePublic` (`Kernel`/`public/index.php` pass `__DIR__ . '/../cache'`; assert the resolved
    path doesn't start with the resolved `public/`; CA-04)
- [ ] **Step 3: Run** `composer test` — expect the new tests to FAIL.
- [ ] **Step 4: Implement the caching in both classes, wire one `SignedFileCache` in `Kernel::create()`, update
  `ApiTestCase`.**
- [ ] **Step 5: Run** `composer check` — expect PASS (all existing API tests too).
- [ ] **Step 6: Update spec: remove ⏳ 4.1 from 3.2, 4.3, 5.3.10, 5.4.2 and the 6.1 intro; tick CA-01–CA-03, ST-18;
  commit** `Backend: cache settings, public key and module/category IDs (4.1)`

### Task 4: Locking and bounded size of the security stores

**Files:**
- Modify: `backend/src/Infrastructure/Store/SignedFileStore.php` (add `probeLocking()`, `fileCount()`)
- Test: `backend/tests/Unit/Infrastructure/Store/SignedFileStoreTest.php`

**Interfaces:**
- Produces (used by the self-check, Task 9):
  - `SignedFileStore::probeLocking(): bool` — takes `LOCK_EX` on `probe.lock`, then a second handle on the same file
    tries `LOCK_EX | LOCK_NB`; `true` only if the second attempt is refused. Releases both.
  - `SignedFileStore::fileCount(): int` — number of entries in the folder (all files, `.lock` included).

- [ ] **Step 1: Write the failing tests** `testProbeLockingSucceedsOnLocalDisk`, `testFileCountCountsLockFiles`,
  `testManyPersonsKeepOneRecordEach` (100 persons with one attempt each → at most 200 files; RX-05 re-check).
- [ ] **Step 2: Run** — expect FAIL. **Step 3: Implement.** **Step 4: Run** `composer check` — expect PASS.
- [ ] **Step 5: Commit** `Backend: lock probe and file count for the security store (4.1)`

## Item 4.1a – ChurchTools call budget (spec 6.2, 6.3, Q26)

### Task 5: Per-address limiter

**Files:**
- Create: `backend/src/Application/Port/AddressLimiter.php`, `backend/src/Application/Auth/AddressLimit.php`,
  `backend/src/Infrastructure/Auth/FileAddressLimiter.php`
- Test: `backend/tests/Unit/Infrastructure/Auth/FileAddressLimiterTest.php`

**Interfaces:**
- Produces:
  - `enum AddressLimit: string { case Login = 'login'; case RejectedToken = 'rejected-token'; public function max(): int; }`
    with `max()` = 30 / 60 and `const WINDOW_SECONDS = 60`.
  - `interface AddressLimiter`:
    - `hit(AddressLimit $limit, string $remoteAddr): void` — if the bucket is blocked, throws
      `TooManyAttemptsException` (with `retryAfterSeconds`) **without** counting; otherwise counts the request.
    - `assertOpen(AddressLimit $limit, string $remoteAddr): void` — throws like `hit` but never counts.
  - `FileAddressLimiter::__construct(SignedFileStore $store, Clock $clock, #[\SensitiveParameter] string $jwtSecret)`;
    `BUCKETS = 256`; record name `addr:<limit>:<bucket>`; the record keeps the timestamps of the last 60 s (at most
    `max()` entries). Blocked = `count >= max()`; `Retry-After` = oldest timestamp + 60 − now (at least 1).
  - `FileAddressLimiter::network(string $remoteAddr): string` — IPv4 as is; IPv4-mapped IPv6 (`::ffff:a.b.c.d`) as
    IPv4; other IPv6 as its first 64 bits in hex plus `/64`; anything unparsable as `unknown`.
  - Bucket = `hexdec(substr(hash_hmac('sha256', network, key), 0, 8)) % 256` with
    key = `hash_hmac('sha256', 'ctpassstore address buckets v1', $jwtSecret)`, so nobody can aim at a victim's bucket.

- [ ] **Step 1: Write the failing tests:** `testThirtyLoginsPassAndTheThirtyFirstIsRefused`,
  `testRefusedAttemptsAreNotCounted` (31st, 32nd refused; after `advance(60)` from the first hit one passes),
  `testRetryAfterIsTheRemainingWindow`, `testRejectedTokenLimitIsSixty`, `testLimitsAreIndependent`,
  `testIpv6SameSlash64SharesTheCount` (`2001:db8::1` and `2001:db8::ffff`), `testIpv6OtherSlash64DoesNot`,
  `testIpv4MappedCountsAsIpv4`, `testBucketCountIsBounded` (1,000 random addresses → at most `2 × 256` files for one
  limit), `testAssertOpenNeverCounts`, `testUnusableStoreFailsClosed` (folder unwritable → `ConfigurationException`).
- [ ] **Step 2: Run** — expect FAIL. **Step 3: Implement.** **Step 4: Run** `composer check` — expect PASS.
- [ ] **Step 5: Commit** `Backend: per-address limiter in fixed buckets (4.1a)`

### Task 6: Wire the limit into login and authentication

**Files:**
- Modify: `backend/src/Http/Controller/AuthController.php`, `backend/src/Http/Middleware/AuthMiddleware.php`,
  `backend/src/Kernel.php`
- Test: `backend/tests/Api/AddressLimitApiTest.php` (new)

**Interfaces:**
- Consumes: `AddressLimiter`, `AddressLimit` (Task 5).
- Produces: `AuthController::__construct(Login $login, AddressLimiter $limiter)`;
  `AuthMiddleware::__construct(Authenticator $authenticator, AddressLimiter $limiter, LoggerInterface $logger)`.
- Behavior:
  - `AuthController::token()` calls `hit(Login, REMOTE_ADDR)` **first**, before parsing the body.
  - `AuthMiddleware` calls `assertOpen(RejectedToken, …)` after the header checks and before `authenticate()`; on
    `InvalidTokenException` it calls `hit(RejectedToken, …)` and rethrows. `missing-token` and `token-expired` don't count.
  - A refusal is logged as `warning` with the IP.

- [ ] **Step 1: Write the failing API tests:**
  - `testThirtyLoginsFromOneAddressPass` / `testTheThirtyFirstLoginGets429WithRetryAfter` (`429 too-many-attempts`,
    `Retry-After` = `retryAfter` member; Review Focus 3)
  - `testABlockedLoginCostsNoChurchToolsCall` (fake call count unchanged by the 31st request; RX-06)
  - `testForgedTokensCostNoChurchToolsCallWithWarmCache` (one valid request warms the cache, then a missing token, an
    HS256 token with a wrong signature and an EdDSA token with any `kid` → no new fake calls; RX-06)
  - `testSixtyRejectedTokensThenEvenAValidTokenIsRefused` (the 61st request from that address with a **valid** token
    gets `429`, from another address `200`)
  - `testOtherAddressesAreUnaffected`
- [ ] **Step 2: Run** — expect FAIL. **Step 3: Implement and wire.** **Step 4: Run** `composer check` — expect PASS.
- [ ] **Step 5: Update spec (remove ⏳ 4.1a in 4.9, 6.2, 6.3, 6.1); tick RX-06; commit**
  `Backend: per-address limit for logins and rejected tokens (4.1a)`

## Item 4.2 – Self-check (spec 4.8)

### Task 7: Version string

Needed by `/v1/test` and the logs; built now, released in Task 14.

**Files:**
- Create: `backend/VERSION` (content `0.1.0`), `backend/src/Infrastructure/Version.php`, `backend/bin/version.php`
- Test: `backend/tests/Unit/Infrastructure/VersionTest.php`

**Interfaces:**
- Produces:
  - `Version::format(string $base, ?string $exactTag, string $sha, bool $dirty): string` — `x.y.z` when
    `$exactTag === "v$base"` and not dirty; else `x.y.z+<sha>` plus `-dirty` when dirty. `$sha` is the 7-char short SHA.
  - `Version::current(string $backendDir): string` — reads `$backendDir/version.txt` (written by the build, Task 13)
    if present; otherwise asks git (`git describe --exact-match --tags`, `git rev-parse --short HEAD`,
    `git status --porcelain`) through `proc_open` **without a shell** and formats; if git isn't available,
    `<base>+unknown`. Allowed under `phpstan-security.neon` only via `proc_open` with an argument array — if the rule
    set forbids it, add a single, commented exception for this file.
  - `bin/version.php` prints `Version::current(dirname(__DIR__))`.

- [ ] **Step 1: Write the failing tests** for `format()`: tagged clean → `0.1.0`; tagged dirty → `0.1.0+abc1234-dirty`;
  untagged → `0.1.0+abc1234`; other tag (`v0.0.9`) → `0.1.0+abc1234`; and `current()` reads `version.txt` when present
  (DP-02).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** `composer check` — PASS.
- [ ] **Step 5: Tick DP-02; commit** `Backend: version string (4.2, spec 6.5)`

### Task 8: Self-check on ports, admins only, local checks

**Files:**
- Create: `backend/src/Application/SelfCheck/Check.php`, `.../CheckOutcome.php`, `.../SelfCheck.php`,
  `backend/src/Infrastructure/SelfCheck/CredentialsFileCheck.php`, `.../LogFolderCheck.php`, `.../CacheFolderCheck.php`,
  `.../OAuthConfigurationCheck.php` (configuration part only, see Task 9)
- Modify: `backend/src/Http/Controller/SelfCheckController.php` (rewrite), `backend/src/Kernel.php`,
  `backend/tests/Unit/Security/ArchitectureTest.php` (drop the `SelfCheckController` exception, if one exists)
- Test: `backend/tests/Unit/Application/SelfCheck/SelfCheckTest.php`, `backend/tests/Api/SelfCheckApiTest.php` (extend)

**Interfaces:**
- Produces:
  - `interface Check { public function name(): string; public function run(): CheckOutcome; }`
  - `final readonly class CheckOutcome { public bool $ok; public string $message; public static function ok(string $m): self; public static function fail(string $m): self; }`
  - `SelfCheck::__construct(iterable<Check> $checks)`; `SelfCheck::run(): array{passed: bool, tests: list<array{name: string, status: 'ok'|'fail', message: string}>}`.
    A `Throwable` from a check becomes `fail`; its message is used only for `ApplicationException`, otherwise
    `"The check failed unexpectedly; see the log."` and the exception is logged as `error`.
  - `Kernel::create(BackendConfig $config, ChurchToolsClient $churchTools, LoggerInterface $logger, ?Clock $clock = null, ?string $version = null)`
    — `$version` defaults to `Version::current(dirname(__DIR__))`; the API tests pass `'0.1.0+test'`.
  - `SelfCheckController::__construct(SettingsRepository $settings, SelfCheck $selfCheck, string $version)`; only a
    `PersonPrincipal` for whom `settings()->isAdmin($principal->id)` holds; others `403 forbidden` (machine clients too).
    Body `{"version", "summary", "tests"}`; `200` all ok, else `207`. Optional query `write=1` is passed on (Task 10).
  - Local checks (names are what the response shows):
    - `Credentials file` — readable by PHP, **not** readable/writable by "other" (`mode & 0o007 === 0`); group bits are
      allowed (spec 3.1). The message never contains the absolute path (only `config/credentials.php`).
    - `Log folder` — `logs/` exists and is writable.
    - `Cache folder` — writable, not writable by group/other, `probeLocking()` true, `fileCount() <= 10000`; the
      message reports the count.
    - `OAuth and token configuration` — `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET` present, `JWT_SECRET` ≥ 32 bytes.

- [ ] **Step 1: Write the failing unit tests** (`SelfCheckTest`): all ok → `passed`; one failing check → only that
  one `fail`; an unexpected exception → generic message, `error` logged.
- [ ] **Step 2: Write the failing API tests:** `testAdminGets200WithVersion` (TS-01), `testNormalUserGets403`,
  `testMachineClientGets403` (TS-05), `testCredentialsReadableByOthersFails`, `testGroupReadableCredentialsPass`,
  `testUnwritableLogFolderFails`, `testCacheFolderWritableByOthersFails`, `testCacheFileLimitFails` (create 10,001
  empty files in a temp cache folder), `testShortJwtSecretFails` — each asserts `207` with exactly that check `fail`
  (TS-02 local part); `testResponseHasNoSecretsOrAbsolutePaths` (search the body for `JWT_SECRET`,
  `OAUTH_CLIENT_SECRET`, the service token and `sys_get_temp_dir()`; TS-04).
- [ ] **Step 3: Run** — FAIL. **Step 4: Implement and wire.** **Step 5: Run** `composer check` — PASS (architecture
  test included).
- [ ] **Step 6: Commit** `Backend: self-check on ports, admins only, local checks (4.2)`

### Task 9: ChurchTools checks of the self-check

**Files:**
- Create: `backend/src/Infrastructure/SelfCheck/SettingsCheck.php`, `.../PublicKeyCheck.php`,
  `.../PasswordStoreReadCheck.php`, `.../ServiceUserRightsCheck.php`, `.../OAuthClientCheck.php`
- Modify: `backend/src/Kernel.php`, `backend/tests/Support/FakeChurchToolsClient.php` (service-user permissions
  settable), `backend/tests/Support/ChurchToolsClientContractTestCase.php`
- Test: `backend/tests/Api/SelfCheckApiTest.php`, `backend/tests/Unit/Infrastructure/SelfCheck/ServiceUserRightsCheckTest.php`

**Interfaces:**
- Consumes: `Check`, `CheckOutcome` (Task 8); `KvSettingsRepository::findings()`; `RsaPasswordCipher`;
  `ExtensionData::values()`; `ChurchToolsClient::serviceUserGlobalPermissions()`, `exchangeAuthorizationCode()`.
- Produces: `ExtensionData::categoryIdOf(string $name): int` (public wrapper of the private resolver), used by the
  rights check.
- Checks:
  - `Settings` — loads and validates; each finding (disabled client, unknown permission, empty key list) appears in
    the message **by client id** (TS-02).
  - `Public key` — loads and encrypts the string `self-check`; never prints the ciphertext.
  - `Password store readable` — `values(passwordStore)` succeeds.
  - `Service user rights` — fail if `churchcore` has `administer settings`, `administer persons` or
    `administer custom modules` = `true` (keys measured on the test instance 2026-11-10), or if in `ctpassstore`
    `create custom category` is `true`, `edit custom category`/`delete custom category` is non-empty, or
    `create/edit/delete custom data` contains any ID other than `passwordStore`'s. The message names the rights, not
    the person. (TS-03)
  - `OAuth client` — exchanges a made-up code (`self-check-` + 16 random hex chars, verifier of 43 `v`, the
    configured redirect URI): `OAuthCodeRejectedException` → ok; `OAuthClientRejectedException` → fail "client ID or
    secret rejected"; anything else → fail with the reason (measured 2026-11-10: wrong client `invalid_grant` vs.
    `invalid_client` vs. `404`).
- Contract case (CT-04): `testServiceUserPermissionsHaveTheExpectedShape` — `churchcore` is an object with boolean
  values for the three keys when present; `ctpassstore` lists are lists of integers.

- [ ] **Step 1: Write the failing tests** — the five checks each failing on its own (`207`, exactly that check),
  `ServiceUserRightsCheckTest` (admin, as measured: `churchcore` = `{"administer settings": true, "administer
  persons": true, "administer custom modules": true}` → fail naming all three; a minimal service user with
  `ctpassstore` = `{"view": true, "view custom category": [S, E, P], "view custom data": [S, E, P],
  "create custom data": [P], "edit custom data": [P], "delete custom data": [P], "create custom category": false,
  "edit custom category": [], "delete custom category": []}` → ok, where S/E/P are the settings, encryption and
  password category IDs; the same with `S` added to `edit custom data` → fail),
  and the contract case.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement and wire.** **Step 4: Run** `composer check` — PASS; run
  `composer test:contract -- --filter ServiceUserPermissions` against the test instance — PASS.
- [ ] **Step 5: Tick TS-02, TS-03, TS-04, CT-04; commit** `Backend: ChurchTools checks of the self-check (4.2)`

### Task 10: Write round trip with `?write=1`

**Files:**
- Modify: `backend/src/Infrastructure/Kv/KvPasswordRepository.php`
- Create: `backend/src/Infrastructure/SelfCheck/WriteRoundTripCheck.php`
- Test: `backend/tests/Unit/Infrastructure/Kv/KvPasswordRepositoryTest.php`, `backend/tests/Api/SelfCheckApiTest.php`

**Interfaces:**
- Produces on `KvPasswordRepository` (the only code that may touch `personId` `0`, spec 5.3.11):
  - `selfTestValueIds(): list<int>`
  - `createSelfTestValue(string $ciphertext): int`
  - `selfTestCiphertext(int $valueId): ?string`
  - `deleteSelfTestValue(int $valueId): void` (a `404` counts as done)
- `WriteRoundTripCheck` (named `Write round trip`): runs only when the controller got `write=1`; deletes leftovers,
  creates, reads back, then deletes in a `finally`. Without `write=1` it isn't run and isn't listed.

- [ ] **Step 1: Write the failing tests:** `testWriteUsesReservedPersonZeroAndCleansUp` (afterwards no value with
  `personId` 0; real entries unchanged; TS-06), `testWithoutWriteNothingIsWritten` (fake records no create),
  `testDeletedEvenWhenReadBackFails` (fake fails the read → value still deleted; TS-06),
  `testLeftoverIsRemovedByTheNextRun` (TS-07).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** `composer check` — PASS.
- [ ] **Step 5: Update spec 4.8 (remove the "Today …" paragraph and ⏳ 4.2 in 3.1, 4.8, 6.1); tick TS-01, TS-05,
  TS-06, TS-07; commit** `Backend: write round trip of the self-check (4.2)`

## Item 4.3 – Hardening (spec 4.1, 4.2, 6.4)

### Task 11: Security headers, CORS, HTTPS, methods

**Files:**
- Create: `backend/src/Http/Middleware/SecurityHeadersMiddleware.php`, `backend/src/Http/Middleware/HttpsOnlyMiddleware.php`
- Modify: `backend/src/Http/Middleware/CorsMiddleware.php`, `backend/src/Kernel.php`,
  `backend/src/Http/Problem/ProblemType.php`, `backend/docs/problems.md`, `specs/backend-spec.md` (4.9 table)
- Test: `backend/tests/Api/HttpHeadersApiTest.php` (new)

**Interfaces:**
- Middleware order (outermost first): `SecurityHeaders → CORS → HttpsOnly → Error → Routing → Auth → endpoint`.
  `SecurityHeaders` outermost so even the misconfigured app and preflights carry the headers; also add it to
  `Kernel::misconfigured()`.
- `SecurityHeadersMiddleware` sets `Cache-Control: no-store` and `X-Content-Type-Options: nosniff` on every response.
- `CorsMiddleware`: allowed origins get `Allow-Origin` (exact match), `Allow-Methods: GET, POST, PUT, DELETE, OPTIONS`,
  `Allow-Headers: Authorization, Content-Type`, `Max-Age: 600`; **no** `Allow-Credentials`; `Vary: Origin` on every
  response; preflight answers `204` (status currently `200`).
- `HttpsOnlyMiddleware`: rejects with `400` exactly when `.htaccess` would redirect: server param `HTTPS` missing,
  empty or `off` (case-insensitive). It runs on every request, so it also protects hosts that ignore `.htaccess`
  (decided 2026-11-10). New problem type **`https-required`** (400, title "HTTPS required"; accepted 2026-11-10) —
  add it to the 4.9 table of the spec and to `problems.md` in this task.
- `HEAD`, `PATCH`, `TRACE` on known routes → `405` with `Allow`, never the `GET` handler.

- [ ] **Step 1: Write the failing tests:** HT-02 (foreign, `null`, lookalike origin → no CORS headers), HT-03
  (preflight `204` with the method list and `Max-Age: 600`, no token needed), HT-04 (`no-store`/`nosniff` on `200`,
  `204`, `400`, `401`, `404`, `500` and the misconfigured app), HT-05 `testHttpsMissingIsRejected` and
  `testHttpsOnIsAccepted` (Review Focus 4), HT-06 (scheme, port, trailing slash, path, subdomain), HT-07 (foreign
  preflight: no headers, endpoint not run — fake call count 0), HT-08 (no `Allow-Credentials`, never `*`), HT-09
  (`Vary: Origin` everywhere), EP-06 (generated password response has `no-store`), HP-02 (`HEAD`/`PATCH`/`TRACE` →
  `405`, no fake write), RX-07 (64 KB `Authorization` header → `401`; 64 KB path → `404`; no PHP warning in the log).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** `composer check` — PASS (ER-02/ER-03 force the
  new problem type into `problems.md`).
- [ ] **Step 5: Update spec (remove ⏳ 4.3 in 4.1, 4.2; add `https-required`); tick the cases; commit**
  `Backend: security headers, exact CORS, HTTPS check, 405 for HEAD (4.3)`

### Task 12: Logging: rotation, version, no secrets

**Files:**
- Modify: `backend/src/Kernel.php` (`logger()`), `backend/public/index.php`
- Create: `backend/src/Infrastructure/Logging/AddVersionToErrors.php`
- Test: `backend/tests/Unit/LoggerTest.php`, `backend/tests/Api/LoggingApiTest.php` (new)

**Interfaces:**
- `Kernel::logger(string $logFile, string $level, string $version): Logger` — `RotatingFileHandler($logFile, 14, level)`
  (files `app-YYYY-MM-DD.log`), processors `EscapeControlCharacters` and `AddVersionToErrors($version)` (adds
  `version` to the context of records with level ≥ `error`).
- `Kernel::bootstrap()` passes `Version::current(dirname(__DIR__))`.

- [ ] **Step 1: Write the failing tests:** LG-04 (level `warning` drops `info`), LG-06 (handler is a
  `RotatingFileHandler` with max 14 files; a 15th dated file is removed on rotation), LG-07 (an `error` record carries
  `version`, an `info` record doesn't), LG-01 (run a login, PUT with primary and custom password, a generated PUT, GET
  and DELETE through the API with a capturing handler, then assert none of: the primary password, the custom and the
  generated password, the backend token, the OAuth code and verifier, `OAUTH_CLIENT_SECRET`, `JWT_SECRET`, any
  stored ciphertext appears in any record), LG-02 (denied access → `warning` with person ID and `ip`), LG-03 (login,
  change, delete → `info`).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** `composer check` — PASS.
- [ ] **Step 5: Update spec (remove ⏳ 4.3/4.5 in 6.4); tick LG-01–LG-04, LG-06, LG-07; commit**
  `Backend: log rotation, version on errors, no secrets in logs (4.3)`

## Item 4.4 – Deployment (spec 6.5, 6.6)

### Task 13: `setup.sh`, deploy check, setup docs

**Files:**
- Modify: `backend/setup/setup.sh`, `backend/docs/setup.md`
- Create: `backend/bin/check-deploy.php`
- Test: `backend/tests/Unit/Deploy/CheckDeployTest.php`

**Interfaces:**
- `bin/check-deploy.php <folder>` exits `0` or `1` and prints one line per problem. Fails when the folder contains:
  `config/credentials.php` (only `credentials-example.php` is allowed), `phpunit.xml*`, `tests/`, `.git/`,
  `composer.json`'s dev tools in `vendor/` (`phpunit`, `phpstan`, `friendsofphp`), any file containing `church.tools`
  outside `vendor/` or a string that looks like a login token (≥ 100 chars of `[A-Za-z0-9]`), or when `public/index.php`,
  `src/`, `vendor/autoload.php`, `version.txt` are missing.
- `setup.sh`: installs without dev, copies as today but **keeps** `config/credentials-example.php` (no rename), creates
  `cache/` (`700`) and `logs/` (`700`), sets files `640`/dirs `750` and `config/` `700`, writes `version.txt` via
  `php bin/version.php`, runs `php bin/check-deploy.php "$TARGET_DIR"` and aborts on failure. The closing hints name
  both hosting cases of spec 3.1.
- `docs/setup.md`: permissions for both hosting cases (spec 3.1), the cache folder on a local disk where `flock`
  works (spec 6.1), the OAuth application and the login right (spec 3.3), the rotation table (spec 6.3), log
  retention of 14 days and personal data (spec 6.4).

- [ ] **Step 1: Write the failing tests** (DP-01): a clean fixture folder passes; each forbidden item on its own fails
  with its line; a missing required file fails.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement the script, update `setup.sh` and `setup.md`.**
- [ ] **Step 4: Run** `composer check` — PASS; run `bash setup/setup.sh` into an empty temp folder — prints success,
  `check-deploy` passes, `stat` shows the modes above.
- [ ] **Step 5: Update spec (remove ⏳ 4.4); tick DP-01; commit** `Backend: setup.sh sets permissions and checks the deploy folder (4.4)`

## Item 4.5 – Release (spec 6.5, 6.6)

### Task 14: CHANGELOG, release check, release workflow, API docs

**Files:**
- Create: `backend/CHANGELOG.md`, `backend/bin/release-check.php`, `.github/workflows/backend-release.yml`
- Modify: `backend/README.md`
- Test: `backend/tests/Unit/Deploy/ReleaseCheckTest.php`

**Interfaces:**
- `CHANGELOG.md` in "Keep a Changelog" form; section `## [0.1.0] - YYYY-MM-DD` summarizing spec section 10.
- `bin/release-check.php <tag>` exits `1` unless tag = `v` + `VERSION`, and `CHANGELOG.md` has a section
  `## [<VERSION>] - <YYYY-MM-DD>` with a valid date; prints that section on success.
- Workflow on tags `v*.*.*`: checkout, PHP 8.3, `composer install`, `composer check`, `php bin/release-check.php
  "$GITHUB_REF_NAME"`, `bash setup/setup.sh` non-interactively (add a `TARGET_DIR` argument to `setup.sh` in this
  task), zip the folder, create the GitHub release with the CHANGELOG section as notes (`gh release create`).
- `README.md`: the API under `/v1/` (endpoints, problem types link to `docs/problems.md`, authentication for users and
  machine clients, `/v1/test`), replacing the old API description.

- [ ] **Step 1: Write the failing tests** (DP-03): matching tag/version/section passes; wrong tag, missing section,
  undated section each fail.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement script, CHANGELOG, workflow, README.**
- [ ] **Step 4: Run** `composer check` — PASS; `php bin/release-check.php v0.1.0` prints the section (the date may be
  a placeholder until release day — then expect FAIL and say so).
- [ ] **Step 5: Update spec (remove ⏳ 4.5), plan (tick 4.1–4.5); tick DP-03; commit**
  `Backend: CHANGELOG, release check and release workflow (4.5)`

The release itself (tag `v0.1.0`) waits for phase 5 (extension and ct-radius), as the plan says the new API is only
usable once they're done.
