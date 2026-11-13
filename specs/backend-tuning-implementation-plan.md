# Backend Tuning File Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an installation override six operational timing values in an optional `config/tuning.php`, validated against fixed ranges, without being able to loosen any security promise.

**Architecture:** A new immutable `CtPassStore\Config\Tuning` holds defaults, ranges and validation. `Kernel` loads `config/tuning.php` next to `credentials.php` and passes each value into the constructor of the class that uses it; the class constants named in the design go away. Broken tuning behaves like broken credentials: misconfigured app (web) or exit code 2 (CLI). A new self-check lists overrides.

**Tech Stack:** PHP 8.x, Slim 4, Guzzle, PHPUnit, PHPStan, php-cs-fixer (all existing).

**Spec:** [`specs/backend-tuning-design.md`](backend-tuning-design.md) (approved 2026-11-13). Threat model: [`docs/threat-model.md`](../docs/threat-model.md). Backend spec: [`specs/backend-spec.md`](backend-spec.md).

All paths below are relative to `backend/` unless they start with `specs/` or `docs/threat-model.md`.

## Global Constraints

- Keys, defaults and inclusive ranges (seconds, `int` only):

  | Key | Default | Min | Max |
  | --- | --- | --- | --- |
  | `CT_TIMEOUT_SECONDS` | 5 | 2 | 15 |
  | `SETTINGS_CACHE_SECONDS` | 300 | 30 | 3600 |
  | `KV_IDS_CACHE_SECONDS` | 3600 | 300 | 86400 |
  | `PERSON_CACHE_SECONDS` | 600 | 60 | 600 |
  | `CLEANUP_DEADLINE_SECONDS` | 20 | 5 | 20 |
  | `CLEANUP_COOLDOWN_SECONDS` | 600 | 600 | 3600 |

- Without `config/tuning.php` the backend behaves exactly as today. No default value changes.
- Locked values (design 4.2) stay constants in their classes; no task touches them.
- Domain, Application and Cli must not depend on `Config` or `Kernel` (`tests/Unit/Security/ArchitectureTest.php`). Application classes receive plain `int`s.
- Error messages name the key and the range; they never echo a value or other file content.
- `composer check` (cs, stan, Unit+Api tests) passes at the end of every task.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **`tuning.php` with a PHP syntax error or a thrown exception.** `require` raises `ParseError`/`Error`, not `ConfigurationException`; expected: `500 misconfigured` / exit 2, naming `tuning.php`, not `500 internal-error` or a white page. Test in Task 1 (`testAFileThatFailsToLoadIsAConfigurationError`) and Task 4.
2. **`tuning.php` that prints something** (BOM, blank line before `<?php`). Expected: output is discarded, it never reaches a response or breaks headers. Test in Task 1 (`testOutputOfTheFileIsDiscarded`).
3. **Keys in the wrong case or with junk** (`ct_timeout_seconds`, `CT_TIMEOUT_SECONDS ` with a space, a control character). Expected: unknown-key error; a key that isn't `^[A-Z_]{1,64}$` is not echoed. Test in Task 1 (`unknownKeys` provider).
4. **A list instead of a map** (`return [5];`) and an empty file returning `1`. Expected: unknown key / must-return-an-array errors. Test in Task 1.
5. **A class constructed with an unsafe value directly**, bypassing `Tuning` (e.g. a future caller). Expected: `CachedPersonDirectory` rejects > 600, `CleanupCooldown` rejects < 600, `CleanupController` rejects > 20. Test in Task 3.

---

### Task 1: `Tuning` value object, loader and template [security-critical]

**Files:**
- Create: `src/Config/Tuning.php`
- Create: `config/tuning-example.php`
- Modify: `../.gitignore` (add `/backend/config/tuning.php` next to the `credentials.php` line; match the existing line's form)
- Modify: `setup/setup.sh:58` (also copy `tuning-example.php`)
- Test: `tests/Unit/Config/TuningTest.php`, `tests/Unit/Config/TuningExampleTest.php`

**Interfaces:**
- Produces:
  - `final class Tuning` with `public readonly int` properties `ctTimeoutSeconds`, `settingsCacheSeconds`, `kvIdsCacheSeconds`, `personCacheSeconds`, `cleanupDeadlineSeconds`, `cleanupCooldownSeconds`.
  - `public const RANGES` : `array<string, array{default: int, min: int, max: int}>` keyed by the file keys, in the order of the Global Constraints table.
  - `public static function defaults(): self`
  - `public static function fromArray(mixed $values): self` — throws `ConfigurationException`
  - `public static function load(string $path): self` — throws `ConfigurationException`
  - `public function overrides(): array` — `array<string, array{value: int, default: int}>`, only keys whose value differs from the default, in `RANGES` order.

- [ ] **Step 1: Write the failing tests** in `TuningTest`:
  - `testDefaultsMatchTheTable`: `Tuning::defaults()` has 5, 300, 3600, 600, 20, 600; `overrides()` is `[]`.
  - `testEmptyArrayGivesDefaults`: `fromArray([])` equals `defaults()` property by property.
  - `testBoundsAreAccepted` (data provider over every key × {min, max}): `fromArray([$key => $bound])` sets the matching property; `overrides()` contains the key unless the bound equals the default.
  - `testOutOfRangeIsRejected` (provider over every key × {min − 1, max + 1}): `ConfigurationException` with message exactly `"$key in tuning.php must be between $min and $max (default $default)."`
  - `testNonIntegersAreRejected` (provider: `'300'`, `300.0`, `true`, `null`, `[]`): message `"$key in tuning.php must be a whole number of seconds."`
  - `testNonArrayIsRejected` (`1`, `'x'`, `null`): message `'tuning.php must return an array.'`
  - `unknownKeys` provider → `testUnknownKeysAreRejected`: `'ct_timeout_seconds'` and `'FOO'` → `"Unknown key FOO in tuning.php."` (the key echoed); `"CT_TIMEOUT_SECONDS "`, `"A\nB"`, `0` (from `[5]`) → `'Unknown key in tuning.php (not shown: it isn\'t an upper-case name).'`
  - `testOverridesListsChangedValues`: `fromArray(['PERSON_CACHE_SECONDS' => 300])->overrides()` is `['PERSON_CACHE_SECONDS' => ['value' => 300, 'default' => 600]]`.
  - `testMissingFileGivesDefaults`: `load('/nonexistent/tuning.php')` equals defaults.
  - `testUnreadableFileIsRejected` (skip when running as root): chmod 000 temp file → `'config/tuning.php is not readable by PHP.'`
  - `testAFileThatFailsToLoadIsAConfigurationError`: temp file `<?php return [` (parse error) and `<?php throw new RuntimeException('secret');` → message `'config/tuning.php could not be loaded (ParseError).'` / `(RuntimeException)`; message does not contain `secret`.
  - `testOutputOfTheFileIsDiscarded`: temp file `"\xEF\xBB\xBF\n<?php return [];"` → `load` returns defaults and `ob_get_level()`/output are unchanged (assert with `expectOutputString('')`).
  - `TuningExampleTest::testTheExampleReturnsAnEmptyArrayAndNamesEveryKey`: `require 'config/tuning-example.php'` is `[]`; its source contains every key of `Tuning::RANGES` and, for each, the string `"default {$default}, allowed {$min}–{$max}"`.

- [ ] **Step 2: Run them to see them fail**

Run: `vendor/bin/phpunit -c phpunit.xml.dist --filter 'TuningTest|TuningExampleTest'`
Expected: FAIL, class `CtPassStore\Config\Tuning` not found.

- [ ] **Step 3: Implement `Tuning`** in `src/Config/Tuning.php`. `load`: `file_exists` false → defaults; `is_readable` false → exception; `ob_start()`, `require` inside `try { } catch (\Throwable $e)` → `ConfigurationException` with `$e::class` only, `ob_end_clean()` in `finally`; then `fromArray`. `fromArray` checks unknown keys first, then type, then range, each in `RANGES` order so the first problem wins. Docblock lists the locked values of design 4.2 with `{@see}` links to their classes.

- [ ] **Step 4: Write `config/tuning-example.php`** in the form of design 4.3: every key commented out, one comment line per key with `default N, allowed MIN–MAX` and the trade-off from design 4.1. Add the `.gitignore` line and the `setup.sh` copy.

- [ ] **Step 5: Run the tests**

Run: `vendor/bin/phpunit -c phpunit.xml.dist --filter 'TuningTest|TuningExampleTest'`
Expected: PASS. Then `composer check` passes.

- [ ] **Step 6: Commit**

```bash
git add src/Config/Tuning.php config/tuning-example.php tests/Unit/Config/TuningTest.php tests/Unit/Config/TuningExampleTest.php ../.gitignore setup/setup.sh
git commit -m "Backend: Tuning value object and tuning-example.php"
```

---

### Task 2: Operational values as constructor parameters (timeout, settings and ID caches)

**Files:**
- Modify: `src/Infrastructure/ChurchTools/GuzzleChurchToolsClient.php:34,52,65` (remove `DEFAULT_TIMEOUT_SECONDS`)
- Modify: `src/Infrastructure/Kv/KvSettingsRepository.php:35,51-56,160` (remove `SETTINGS_TTL`)
- Modify: `src/Infrastructure/Kv/ExtensionData.php:25,37-41,202` (remove `IDS_TTL`)
- Test: `tests/Unit/Infrastructure/Kv/KvSettingsRepositoryTest.php`, `tests/Unit/Infrastructure/Kv/ExtensionDataTest.php`, the Guzzle client's existing unit test (find with `grep -rl guzzleOptions tests`)

**Interfaces:**
- Consumes: `Tuning::RANGES` (Task 1) for default parameter values.
- Produces:
  - `GuzzleChurchToolsClient::__construct(string $apiUrl, Credential $serviceUser, float $timeoutSeconds = Tuning::RANGES['CT_TIMEOUT_SECONDS']['default'], ?ClientInterface $http = null, ?\Closure $now = null)` and `guzzleOptions(string $apiUrl, float $timeoutSeconds = <same>)`
  - `KvSettingsRepository::__construct(ExtensionData $extension, LoggerInterface $logger, ?SignedFileCache $cache = null, Clock $clock = new SystemClock(), int $cacheSeconds = Tuning::RANGES['SETTINGS_CACHE_SECONDS']['default'])`
  - `ExtensionData::__construct(ChurchToolsClient $client, string $extensionKey = KvSchema::EXTENSION_KEY, ?SignedFileCache $cache = null, int $idsCacheSeconds = Tuning::RANGES['KV_IDS_CACHE_SECONDS']['default'])`

- [ ] **Step 1: Write the failing tests**
  - `KvSettingsRepositoryTest::testAConfiguredCacheTimeIsUsed`: repository with `cacheSeconds: 60`; after one read, `clock->advance(59)` → no new ChurchTools call; `advance(2)` → one new call. Replace the existing `assertSame(300, KvSettingsRepository::SETTINGS_TTL)` and `SETTINGS_TTL` references with `Tuning::RANGES['SETTINGS_CACHE_SECONDS']['default']`.
  - `ExtensionDataTest::testAConfiguredIdsCacheTimeIsUsed`: same pattern with `idsCacheSeconds: 400`, boundary 399 / 401. Replace `ExtensionData::IDS_TTL` references.
  - Guzzle client test `testGuzzleOptionsUseTheGivenTimeout`: `guzzleOptions($url, 12.0)` has `TIMEOUT` and `CONNECT_TIMEOUT` both `12.0`; with no argument both `5.0`.

- [ ] **Step 2: Run them to see them fail**

Run: `vendor/bin/phpunit -c phpunit.xml.dist --filter 'KvSettingsRepositoryTest|ExtensionDataTest|GuzzleChurchToolsClient'`
Expected: FAIL (unknown named parameters).

- [ ] **Step 3: Add the parameters, remove the three constants**, update docblocks that name them.

- [ ] **Step 4: Run the tests**

Run: same filter, then `composer check`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/Infrastructure tests/Unit/Infrastructure
git commit -m "Backend: ChurchTools timeout and settings/ID cache times as parameters"
```

---

### Task 3: Security-bound values as guarded parameters (person cache, cleanup deadline, cooldown) [security-critical]

**Files:**
- Modify: `src/Infrastructure/ChurchTools/CachedPersonDirectory.php:21,25-29,43,47,72` (remove `TTL_SECONDS`)
- Modify: `src/Application/Cleanup/CleanupCooldown.php:17,21,28,30` (replace `SECONDS`)
- Modify: `src/Http/Controller/CleanupController.php:33,35-44,48` (remove `DEADLINE_SECONDS`)
- Test: `tests/Unit/Infrastructure/ChurchTools/CachedPersonDirectoryTest.php`, the existing `CleanupCooldown` and `CleanupController` tests (find under `tests/Unit/Application/Cleanup` and `tests/Api/CleanupApiTest.php`)

**Interfaces:**
- Produces:
  - `CachedPersonDirectory::__construct(PersonDirectory $inner, SignedFileCache $cache, Clock $clock, int $ttlSeconds = 600)`; `public const MAX_TTL_SECONDS = 600`; throws `\InvalidArgumentException` if `$ttlSeconds < 1 || > MAX_TTL_SECONDS`.
  - `CleanupCooldown::__construct(CooldownStore $store, int $seconds = self::MIN_SECONDS)`; `public const MIN_SECONDS = 600`; throws `\InvalidArgumentException` if `$seconds < MIN_SECONDS`. Message of `CleanupTooSoonException` uses `$seconds`.
  - `CleanupController::__construct(string $token, CleanupOrphans $cleanup, CleanupLock $lock, CleanupCooldown $cooldown, AddressLimiter $limiter, Clock $clock, LoggerInterface $logger, int $deadlineSeconds = self::MAX_DEADLINE_SECONDS)`; `public const MAX_DEADLINE_SECONDS = 20`; throws `\InvalidArgumentException` if `< 1 || > MAX_DEADLINE_SECONDS`.
  - `Tuning::RANGES` maxima/minima for these three keys must equal these constants: add `TuningTest::testRangesMatchTheGuardsOfTheClasses` asserting `PERSON_CACHE_SECONDS.max === CachedPersonDirectory::MAX_TTL_SECONDS`, `CLEANUP_COOLDOWN_SECONDS.min === CleanupCooldown::MIN_SECONDS`, `CLEANUP_DEADLINE_SECONDS.max === CleanupController::MAX_DEADLINE_SECONDS` (Config/tests may reference these; Application must not reference Config).

- [ ] **Step 1: Write the failing tests**
  - `CachedPersonDirectoryTest::testAConfiguredTtlIsUsed`: `ttlSeconds: 120`; exists → `advance(119)` cached, `advance(2)` asks the inner directory again. Existing record-validation test (line ~119) uses the configured TTL for its upper bound: a record expiring at `now + 121` with `ttlSeconds: 120` is ignored.
  - `testTtlAboveTheSpecPromiseIsRejected`: `ttlSeconds: 601` and `0` → `\InvalidArgumentException`.
  - `CleanupCooldown` test `testAConfiguredCooldownIsPassedToTheStore`: fake store records `startIfDue('cleanup', 900)` for `seconds: 900`; message says `less than 900 seconds`. `testCooldownBelowTheSpecPromiseIsRejected`: `599` → `\InvalidArgumentException`.
  - `CleanupController` (Api or unit, wherever the deadline is tested today) `testAConfiguredDeadlineIsUsed`: `deadlineSeconds: 5` with a fake clock → the run stops confirming after 5 s (mirror the existing 20-second deadline test). `testDeadlineAboveTwentyIsRejected`: `21` and `0` → `\InvalidArgumentException`.
  - `TuningTest::testRangesMatchTheGuardsOfTheClasses` (above).

- [ ] **Step 2: Run them to see them fail**

Run: `vendor/bin/phpunit -c phpunit.xml.dist --filter 'CachedPersonDirectoryTest|CleanupCooldown|Cleanup|TuningTest'`
Expected: FAIL.

- [ ] **Step 3: Implement** the parameters and guards; update docblocks (`CachedPersonDirectory`'s "remembered for …" line names the parameter and the 600 s ceiling).

- [ ] **Step 4: Run the tests**

Run: same filter, then `composer check`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "Backend: person cache, cleanup deadline and cooldown as guarded parameters"
```

---

### Task 4: Load `tuning.php` in `Kernel` and wire the values [security-critical]

**Files:**
- Modify: `src/Kernel.php` (`create`, `cleanupServices`, `runCleanup`, `bootstrap`)
- Modify: `public/index.php`, `bin/cleanup.php` (pass `__DIR__ . '/../config/tuning.php'`)
- Test: `tests/Api/MisconfiguredApiTest.php`, `tests/Unit/Cli/KernelRunCleanupTest.php`, new `tests/Api/TuningApiTest.php`

**Interfaces:**
- Consumes: `Tuning::load`, `Tuning::defaults` (Task 1); constructor parameters of Tasks 2 and 3.
- Produces:
  - `Kernel::create(BackendConfig $config, ChurchToolsClient $churchTools, LoggerInterface $logger, ?Clock $clock = null, ?string $version = null, ?Tuning $tuning = null): App` (null → defaults)
  - `Kernel::cleanupServices(BackendConfig $config, ChurchToolsClient $churchTools, LoggerInterface $logger, ?Clock $clock = null, ?Tuning $tuning = null): array`
  - `Kernel::bootstrap(string $credentialsPath, string $cacheDir, string $logFile, ?string $tuningPath = null): App` (null → defaults, no file read)
  - `Kernel::runCleanup(string $credentialsPath, string $cacheDir, string $logFile, array $arguments, ?ChurchToolsClient $churchTools = null, $out = null, $err = null, ?string $tuningPath = null): int`

- [ ] **Step 1: Write the failing tests**
  - `MisconfiguredApiTest::testABrokenTuningFileIsMisconfigured` (provider: out of range `['PERSON_CACHE_SECONDS' => 601]`, unknown key, parse error): valid temp credentials (reuse the file's existing valid-credentials helper), broken temp tuning file → every request in `requests()` is `500 misconfigured`, `detail` contains `tuning.php`, no CORS header.
  - `MisconfiguredApiTest::testAMissingTuningFileIsFine`: valid credentials, tuning path to a nonexistent file → `GET /nothing` is `404`, not `500`.
  - `KernelRunCleanupTest::testABrokenTuningFileExitsTwo`: stderr is `Configuration error: CLEANUP_COOLDOWN_SECONDS in tuning.php must be between 600 and 3600 (default 600).\n` for `['CLEANUP_COOLDOWN_SECONDS' => 60]`; no ChurchTools call.
  - `TuningApiTest` (extends `ApiTestCase`, which must accept a `Tuning` for `Kernel::create`; add a protected `$tuning` property defaulting to null): `testTheConfiguredSettingsCacheTimeApplies` (`SETTINGS_CACHE_SECONDS` 60: settings change in the fake is visible after 61 s, not after 59 s) and `testTheConfiguredCooldownApplies` (`CLEANUP_COOLDOWN_SECONDS` 900: second `POST /v1/cleanup` after 601 s is still `429 cleanup-too-soon` with `Retry-After: 299`).

- [ ] **Step 2: Run them to see them fail**

Run: `vendor/bin/phpunit -c phpunit.xml.dist --filter 'MisconfiguredApiTest|KernelRunCleanupTest|TuningApiTest'`
Expected: FAIL.

- [ ] **Step 3: Implement.** `bootstrap` and `runCleanup` load tuning inside the existing `try` right after `BackendConfig::fromArray`, so errors take the existing paths. Pass `(float) $tuning->ctTimeoutSeconds` to `GuzzleChurchToolsClient`, the cache values in `cleanupServices`, the person TTL to `CachedPersonDirectory`, cooldown and deadline in `create`. Update `public/index.php` and `bin/cleanup.php`.

- [ ] **Step 4: Run the tests**

Run: same filter, then `composer check`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/Kernel.php public/index.php bin/cleanup.php tests
git commit -m "Backend: load config/tuning.php in web and CLI"
```

---

### Task 5: Self-check lists overrides

**Files:**
- Create: `src/Infrastructure/SelfCheck/TuningCheck.php`
- Modify: `src/Kernel.php` (add the check last, after `CleanupTokenCheck`)
- Test: `tests/Api/SelfCheckApiTest.php:67` and new tests there

**Interfaces:**
- Consumes: `Tuning::overrides()` (Task 1), `Kernel::create(..., ?Tuning $tuning)` and `ApiTestCase::$tuning` (Task 4).
- Produces: `TuningCheck implements Check`, `__construct(Tuning $tuning)`, `name()` = `'Tuning'`, `run()` always `CheckOutcome::ok`.

- [ ] **Step 1: Write the failing tests**
  - Line 67 list gets `'Tuning'` appended.
  - `testTuningCheckSaysAllDefaults`: message `'All values are defaults.'`
  - `testTuningCheckListsOverrides`: with `PERSON_CACHE_SECONDS` 300 and `CT_TIMEOUT_SECONDS` 10 → message `'Changed in tuning.php: CT_TIMEOUT_SECONDS=10 (default 5), PERSON_CACHE_SECONDS=300 (default 600).'` (RANGES order).

- [ ] **Step 2: Run them to see them fail**

Run: `vendor/bin/phpunit -c phpunit.xml.dist --filter SelfCheckApiTest`
Expected: FAIL.

- [ ] **Step 3: Implement `TuningCheck`** and wire it.

- [ ] **Step 4: Run the tests**

Run: same filter, then `composer check`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "Backend: self-check lists tuning overrides"
```

---

### Task 6: Documentation

**Files:**
- Modify: `docs/setup.md` (new section "Tuning (optional)" after the credentials section: how to copy the example, the table of design 4.1 with trade-offs, the worst case of design 4.1.1 and the hint on `max_execution_time` / web-cron timeout, then a "Fixed values" table from design 4.2)
- Modify: `specs/backend-spec.md` section 3.1 (optional `config/tuning.php`, errors like credentials errors), 4.8 (new check `Tuning`), the `cleanup-too-soon` row (`the configured cooldown (default and minimum 600 seconds)`), and each place that states 300 s settings cache, 3600 s ID cache, 600 s person cache, 20 s deadline or 5 s timeout as a fixed number → "default N s, see `config/tuning.php`". 4.12 item 9 stays unchanged.
- Modify: `CHANGELOG.md` (Unreleased: "Added: optional `config/tuning.php` …")
- Modify: `specs/backend-tuning-design.md` status line → "Implemented".

- [ ] **Step 1: Update the docs.** Find the numbers with `grep -nE '\b(300|3600|600|20|5) ?(s|seconds|minutes)' ../specs/backend-spec.md docs/setup.md`.
- [ ] **Step 2: Verify** `grep -n "tuning" docs/setup.md ../specs/backend-spec.md CHANGELOG.md` shows the new text and `composer check` still passes (some tests read docs, e.g. `CredentialsExampleTest`).
- [ ] **Step 3: Commit**

```bash
git add docs/setup.md ../specs/backend-spec.md CHANGELOG.md ../specs/backend-tuning-design.md
git commit -m "Docs: tuning file in setup guide, spec and changelog"
```
