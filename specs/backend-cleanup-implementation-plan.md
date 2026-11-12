# Backend Cleanup of Deleted and Archived Persons – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A cron job `php bin/cleanup.php [--apply]` deletes the `passwordStore` entries of persons who are deleted or
archived in ChurchTools; `PUT` refuses such persons; gone `adminUsers` are reported.

**Architecture:** One existence decision: `ChurchToolsClient::personStatus()` (Infrastructure) behind the Application
port `PersonDirectory`. `SetPassword`, the use case `CleanupOrphans`, and the self-check (through `GoneAdmins`) all
use it. A thin `Cli\CleanupCommand` (options, lock, output, exit code) is wired in `Kernel` and started by
`bin/cleanup.php`. The fake ChurchTools passes the same person contract cases as the real instance.

**Tech Stack:** PHP ^8.3, Slim 4, Monolog 2, Guzzle 7, PHPUnit 12, PHPStan 2, PHP-CS-Fixer (PER).

**Spec:** [`backend-cleanup-design.md`](backend-cleanup-design.md) (cited as "design n.n"). Task 8 folds it into
[`backend-spec.md`](backend-spec.md). Test cases go into a new catalog section **18. Cleanup (design 3–4)** with the
prefix `CL-`, plus new IDs in existing sections (named in each task) of
[`backend-test-catalog.md`](backend-test-catalog.md). Add a case to the catalog before its test, and tick it in the
commit that proves it.

**Deviation from design 6.4, agreed in this plan:** the CLI tests run `CleanupCommand` **in-process** with the fake
ChurchTools, because a separate PHP process can't share the in-memory fake. Only what needs a real process (missing
`credentials.php`, unknown arguments) runs `bin/cleanup.php` through `PhpProcess`. Task 7 updates design 6.4.

## Global Constraints

- Branch `feature/backend-cleanup`; one commit per task. Every commit passes `composer check` in `backend/`.
- Layer rules of `tests/Unit/Security/ArchitectureTest.php` hold. The new top-level namespace `Cli` may use `Domain`
  and `Application` only (not `Infrastructure`, `Http`, `Kernel`); Task 7 adds that rule.
- Errors follow the existing pattern: an exception extends `ApplicationException` (or `ChurchToolsException`) with a
  `Reason`; `ProblemMapping` maps every `Reason` exhaustively; `docs/problems.md` documents every `ProblemType`
  (enforced by `ProblemTypeTest`).
- Shipped files name no `church.tools` host except `example.church.tools` and `your.church.tools` (deploy check).
- No new runtime dependency.
- Output and log lines name **person IDs only**, never names or other personal data (design 4.3).
- Person lookups run **one after another**, never in parallel (design 3.5).
- **Nothing is deleted unless every lookup of the run succeeded** (design 3.5). `403` is never "gone" (design 3.1).
- Exit codes: `0` done, `1` done with warnings, `2` aborted before deleting anything (design 4.4).
- Lock file `cache/cleanup.lock`, exclusive non-blocking `flock` (design 4.5).
- Message texts are copied verbatim from the design where it gives them (3.6, 3.7, 4.2, 4.3).

## Review Focus

1. **An orphan stored with a string person ID (`"56"`) or as duplicates:** the cleanup finds the person once and
   removes every value of them. Test in Task 6 (`testStringIdsAndDuplicatesAreRemovedCompletely`).
2. **ChurchTools answers `429` halfway through a long run:** the run aborts with exit 2 and deletes nothing, also for
   persons looked up before the `429`. Test in Task 6 (`testRateLimitHalfwayDeletesNothing`).
3. **The settings are invalid or unreadable while the cleanup runs:** abort with exit 2 before any delete, because the
   admin warnings can't be computed. Test in Task 6 (`testInvalidSettingsAbortBeforeDeleting`).
4. **A gone admin who also has an entry:** the entry is deleted, and the admin warning is still printed (exit 1). Test
   in Task 6 (`testGoneAdminWithAnEntryIsDeletedAndReported`).
5. **An empty `passwordStore`:** exit 0 with `checked 0 persons, deleted 0 entries`; no lookup. Test in Task 7
   (`testEmptyStoreExitsZero`).

---

### Task 1: Probe ChurchTools (design 8)

Interactive. It needs the test instance, the service token from `config/credentials.php`, and the human partner to
archive one person and delete another in ChurchTools. **No product code.**

**Files:**
- Create: `backend/tests/Contract/fixtures/person_status.json` (private, ignored like the other fixtures; check
  `.gitignore` covers it)
- Modify: `specs/backend-cleanup-design.md` (section 8: add the findings under each question, dated)

**Produces:** the values later tasks use, recorded in design 8:
- `PERSONS_RIGHT`: the module and key(s) in `GET /permissions/global` that make up the narrowest persons right, and
  the condition under which it counts as granted (e.g. a boolean `true`, or a list containing a given value).
- `ARCHIVED_FIELD`: the JSON path in the `GET /persons/{id}` `data` object that marks an archived person, and its
  value for archived and for active persons.
- The status code for a deleted person, for an ID that was never used, and for an existing person without the right.

- [ ] **Step 1:** Ask the human partner to archive one test person and delete another on the test instance, and to
  note one active person. Write the three IDs to `person_status.json` as `{"active": n, "archived": n, "deleted": n}`
  and `chmod 600` it.
- [ ] **Step 2:** With the service token (`Authorization: Login <token>`, `X-OnlyAuthenticated: 1`), call
  `GET /api/persons/{id}` for each of the three IDs and for `2147483647`, without the new right. Record status and
  body (no personal data in the notes, only field names and statuses).
- [ ] **Step 3:** Ask the human partner to grant the service user the narrowest persons right that seems to fit (start
  with "view persons" at the lowest security level). Repeat step 2. Record `GET /permissions/global` for the service
  user before and after.
- [ ] **Step 4:** If the archived person isn't visible, ask for the next broader right (e.g. archive access) and repeat.
  Record the minimal combination as `PERSONS_RIGHT`.
- [ ] **Step 5: Stop check.** If a deleted person and an existing but invisible person get the **same** status, stop and
  report to the human partner (design 8, last paragraph). Otherwise continue.
- [ ] **Step 6:** Write the findings into design 8 and commit.

```bash
git add specs/backend-cleanup-design.md
git commit -m "Plan: findings of the persons probe on the test instance (cleanup)"
```

---

### Task 2: `personStatus()` in the client and the fake, with shared contract cases

**Files:**
- Create: `backend/src/Infrastructure/ChurchTools/PersonStatus.php`
- Create: `backend/src/Infrastructure/ChurchTools/ServiceUserPersonsRight.php`
- Modify: `backend/src/Infrastructure/ChurchTools/ChurchToolsClient.php`,
  `backend/src/Infrastructure/ChurchTools/GuzzleChurchToolsClient.php`
- Modify: `backend/tests/Support/FakeChurchToolsClient.php`,
  `backend/tests/Support/ChurchToolsClientContractTestCase.php`,
  `backend/tests/Unit/Infrastructure/ChurchTools/FakeChurchToolsClientContractTest.php`,
  `backend/tests/Contract/ChurchToolsClientContractTest.php`,
  `backend/tests/Contract/Helpers/ContractPrerequisites.php`
- Test: `backend/tests/Unit/Infrastructure/ChurchTools/GuzzleChurchToolsClientTest.php` (existing; add cases)
- Modify: `backend/docs/testing.md` (fixture `person_status.json`), `specs/backend-test-catalog.md`

**Interfaces:**
- Consumes: Task 1's `PERSONS_RIGHT` and `ARCHIVED_FIELD`.
- Produces:
  - `enum PersonStatus: string { case Active = 'active'; case Archived = 'archived'; case Gone = 'gone'; }`
  - `ChurchToolsClient::personStatus(int $personId): PersonStatus`, service user credential, `GET persons/{id}`.
  - `final class ServiceUserPersonsRight { public static function isGrantedIn(Permissions $permissions): bool;
    public const DESCRIPTION = '<human name of the right from Task 1>'; }`. Fail closed like `Permissions`: anything
    but the exact granted form is "no".
  - Fake: `addPerson(int $personId, bool $archived = false): void`. `personStatus()` records the call; if
    `ServiceUserPersonsRight::isGrantedIn()` is false for the fake's service permissions, it throws what the real
    client throws for the status Task 1 measured (`403` → `ServiceCredentialRejectedException`); an unknown ID is
    `Gone`.
  - Contract base: `abstract protected function personIds(): array` returning
    `array{active: int, archived: int, deleted: int}`.

Catalog: **CC-17** (Guzzle mapping), **CT-09** (active/archived/deleted/unused), **CT-10** (the right suffices for
archived persons), **CT-11** (missing right is an error, not "gone"), in sections 5 and 14. Add `CT-09`–`CT-11` to the
CT-06 list.

- [ ] **Step 1: Write the failing tests**
  - Contract base (runs on fake and real):
    - `testActivePersonIsActive`: `personStatus(personIds()['active'])` is `PersonStatus::Active`
    - `testArchivedPersonIsArchived`: … `['archived']` is `Archived`
    - `testDeletedPersonIsGone`: … `['deleted']` is `Gone`
    - `testUnusedIdIsGone`: `personStatus(2147483647)` is `Gone`
    - `testServiceUserHasTheNarrowPersonsRight`: `ServiceUserPersonsRight::isGrantedIn(client()->serviceUserGlobalPermissions())`
      is true (CT-10; the archived case above shows it suffices)
  - Fake contract test: `setUp` adds persons 12 (active), 34 (archived), service permissions include the right;
    `personIds()` returns `['active' => 12, 'archived' => 34, 'deleted' => 56]`.
  - Real contract test: `personIds()` reads `fixtures/person_status.json`; `ContractPrerequisites::FIXTURES` gains
    `person_status.json`.
  - Fake unit test `testPersonStatusWithoutTheRightThrows` (CT-11, fake side): permissions without the right →
    `ServiceCredentialRejectedException`.
  - Guzzle unit tests (CC-17): `404` → `Gone`; `200` with `ARCHIVED_FIELD` archived → `Archived`; `200` active →
    `Active`; `403` → `ServiceCredentialRejectedException`; `200` without `data` or without the archived field →
    `InvalidResponseException`; the request goes to `…/api/persons/7` with `Authorization: Login`.
- [ ] **Step 2:** Run `composer test -- --filter 'PersonStatus|ArchivedPerson|ActivePerson|DeletedPerson|UnusedId|PersonsRight'`.
  Expected: FAIL (`personStatus` undefined).
- [ ] **Step 3:** Implement `PersonStatus`, `ServiceUserPersonsRight`, the interface method, the Guzzle method (use
  `send('GET', "persons/{$this->positive($personId)}", $this->serviceUser, true)`, catch `NotFoundException` →
  `Gone`, read `ARCHIVED_FIELD` from `expectObject($this->data(...))`), and the fake.
- [ ] **Step 4:** Run `composer check`. Expected: PASS.
- [ ] **Step 5:** Run `composer test:contract -- --filter 'Person'` against the test instance (needs the human
  partner's local config). Expected: PASS. If it fails, the fake or `ARCHIVED_FIELD` is wrong; fix before committing.
- [ ] **Step 6:** Document the fixture in `docs/testing.md` (what each ID is, how to prepare it, `chmod 600`), tick
  the catalog cases, commit.

```bash
git add -A backend/src backend/tests backend/docs/testing.md specs/backend-test-catalog.md
git commit -m "Backend: personStatus() in the ChurchTools client, fake and contract (cleanup)"
```

---

### Task 3: `PersonDirectory`, `personIds()` and `GoneAdmins`

**Files:**
- Create: `backend/src/Application/Port/PersonDirectory.php`
- Create: `backend/src/Application/Exception/PersonsNotReadableException.php`
- Create: `backend/src/Infrastructure/ChurchTools/ChurchToolsPersonDirectory.php`
- Create: `backend/src/Application/GoneAdmins.php`
- Modify: `backend/src/Application/Port/PasswordRepository.php`, `backend/src/Infrastructure/Kv/KvPasswordRepository.php`
  (and any other `PasswordRepository` implementation in `tests/`)
- Test: `backend/tests/Unit/Infrastructure/ChurchTools/ChurchToolsPersonDirectoryTest.php`,
  `backend/tests/Unit/Application/GoneAdminsTest.php`, the existing `KvPasswordRepository` unit test

**Interfaces:**
- Consumes: Task 2's `personStatus()`, `ServiceUserPersonsRight::isGrantedIn()`, fake `addPerson()`.
- Produces:
  - `interface PersonDirectory { public function exists(PersonId $person): bool; public function assertReadable(): void; }`
    `exists()` is true only for `Active`; it lets ChurchTools failures propagate (they implement `Failure`).
    `assertReadable()` throws `PersonsNotReadableException` with the message
    `The service user can't read persons; see docs/setup.md.` when the right is missing.
  - `PersonsNotReadableException extends ApplicationException`, `REASON = Reason::ServiceUserRejected`.
  - `PasswordRepository::personIds(): list<PersonId>`, ascending, each once, never person 0 (design 3.3).
  - `final class GoneAdmins { public function __construct(PersonDirectory $persons); public function find(Settings $settings): list<PersonId>; }`
    in `adminUsers` order.

Catalog: **ST-23** (`personIds()`) in section 3; **CL-01** (`exists()` mapping, `assertReadable()`), **CL-02**
(`GoneAdmins`) in the new section 18.

- [ ] **Step 1: Write the failing tests**
  - `ChurchToolsPersonDirectoryTest`: active → true; archived → false; gone → false; a `RateLimitedException` from the
    fake propagates; `assertReadable()` passes with the right and throws `PersonsNotReadableException` with the exact
    message without it.
  - `KvPasswordRepository` test `testPersonIdsAreUniqueSortedAndSkipZero`: values for persons `9`, `"5"`, `5`
    (duplicate), `0`, a broken value → `[5, 9]` (as `PersonId`s).
  - `GoneAdminsTest`: `adminUsers [100, 101, 102]`, 101 archived, 102 unknown → `[101, 102]`; all active → `[]`; a
    failing lookup throws.
- [ ] **Step 2:** Run `composer test -- --filter 'PersonDirectory|PersonIds|GoneAdmins'`. Expected: FAIL.
- [ ] **Step 3:** Implement. `personIds()` reuses the parsing of `entriesOf()`: extract the loop that decodes all
  values into a private `allEntries()` and build both on it, so the normalization rules exist once.
- [ ] **Step 4:** Run `composer check`. Expected: PASS.
- [ ] **Step 5:** Tick ST-23, CL-01, CL-02; commit.

```bash
git commit -am "Backend: PersonDirectory, personIds() and GoneAdmins (cleanup)"
```

---

### Task 4: `PUT` refuses deleted and archived persons (design 3.6)

**Files:**
- Create: `backend/src/Application/Exception/PersonNotFoundException.php`
- Modify: `backend/src/Application/Failure/Reason.php`, `backend/src/Http/Problem/ProblemType.php`,
  `backend/src/Http/Problem/ProblemMapping.php`, `backend/docs/problems.md`
- Modify: `backend/src/Application/SetPassword.php`, `backend/src/Kernel.php`
- Modify: `backend/tests/Api/ApiTestCase.php`
- Test: `backend/tests/Api/EntriesApiTest.php`

**Interfaces:**
- Consumes: `PersonDirectory`, `ChurchToolsPersonDirectory` (Task 3); fake `addPerson()` (Task 2).
- Produces:
  - `Reason::PersonNotFound = 'person-not-found'` → `ProblemType::PersonNotFound = 'person-not-found'`, status
    `404`, title `Person not found`.
  - `SetPassword::__construct(EntryGuard $guard, SettingsRepository $settings, PasswordPolicy $policy, PasswordCipher $cipher, PasswordRepository $passwords, PersonDirectory $persons, LoggerInterface $logger)`.
  - `ApiTestCase::setUp()` adds every person in `NAMES` as active and grants the service user the persons right, so
    existing tests keep passing. Tests that need a gone person call `$this->churchTools->addPerson($id, archived: true)`
    or use an ID that was never added.

Catalog: **EP-14** (deleted → `404`), **EP-15** (archived → `404`), **EP-16** (own entry: no lookup), **EP-17**
(unauthorized: `403`, no lookup; wrong primary password: `403`, no lookup), **EP-18** (lookup fails → `502`/`503`,
nothing stored), **EP-19** (active other person → stored, one lookup) in section 8.

- [ ] **Step 1: Write the failing tests** in `EntriesApiTest`:
  - `testAdminCantSetPasswordOfDeletedPerson` (EP-14): `PUT /v1/entries/555` as ADMIN, 555 never added → `404`,
    `type` ends with `#person-not-found`, `detail` is `Person 555 doesn't exist in ChurchTools or is archived.`,
    `storedEntries()` unchanged.
  - `testAdminCantSetPasswordOfArchivedPerson` (EP-15): same with an archived person.
  - `testOwnEntryNeedsNoLookup` (EP-16): `PUT` as USER for USER → stored; `countCalls(['personStatus'])` is 0. Same for
    ADMIN on ADMIN.
  - `testUnauthorizedCallerIsRejectedBeforeTheLookup` (EP-17): USER on OTHER → `403`, 0 lookups; with
    `requirePasswordForPasswordChange`, ADMIN with a wrong primary password on OTHER → `403`, 0 lookups.
  - `testFailedLookupStoresNothing` (EP-18, data provider): `failNext('personStatus', …)` with `UnavailableException` →
    `502 upstream-unavailable`; `RateLimitedException` → `503`; nothing stored.
  - `testAdminSetsPasswordOfActivePerson` (EP-19): ADMIN on OTHER → stored; exactly 1 lookup, for OTHER.
- [ ] **Step 2:** Run `composer test -- --filter EntriesApiTest`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement. In `SetPassword::execute()`, after `authorizeChange()`: if `$principal` is a
  `PersonPrincipal` whose `id` differs from `$target` and `!$this->persons->exists($target)`, log at `info`
  (`"{principal} tried to set the password of person {id}, who doesn't exist or is archived."`) and throw
  `PersonNotFoundException` with the detail from step 1. Add the `problems.md` section after `entry-not-found`, with
  **What to do:** "Check the person ID. Deleted and archived persons can't get a password." Also change that
  section's sentence "This is the only `404` that means "no password"." so it stays true.
- [ ] **Step 4:** Run `composer check`. Expected: PASS (incl. `ProblemTypeTest` and the exhaustive mapping test).
- [ ] **Step 5:** Tick EP-14–EP-19; commit.

```bash
git commit -am "Backend: PUT refuses deleted and archived persons (cleanup)"
```

---

### Task 5: Self-check requires the persons right and reports gone admins (design 3.7)

**Files:**
- Modify: `backend/src/Infrastructure/SelfCheck/ServiceUserRightsCheck.php`
- Create: `backend/src/Infrastructure/SelfCheck/AdminUsersCheck.php`
- Modify: `backend/src/Kernel.php` (add `AdminUsersCheck` after `ServiceUserRightsCheck`)
- Test: `backend/tests/Api/SelfCheckApiTest.php`

**Interfaces:**
- Consumes: `ServiceUserPersonsRight` (Task 2), `GoneAdmins` (Task 3), `SettingsRepository`.
- Produces: `AdminUsersCheck(SettingsRepository $settings, GoneAdmins $goneAdmins)`, `name()` = `Admin users`.

Messages (verbatim):
- rights check, right missing: `The service user can't read persons; the cleanup job and the PUT check need it (see docs/setup.md).`
  If administrative rights are present too, both are reported in one message.
- rights check, ok: `The service user has no administrative rights, writes to passwordStore only and can read persons.`
- admin check, fail: `adminUsers contains person 56, who is deleted or archived; remove them in the extension settings.`
  With several: `adminUsers contains persons 56, 57, who are deleted or archived; remove them in the extension settings.`
- admin check, ok: `Every person in adminUsers exists.`
- admin check, lookup failed: `The persons in adminUsers can't be checked right now; see the log.`

Catalog: **TS-08** (right missing → fail; with `administer persons` still fail), **TS-09** (gone admins one/several →
fail with message), **TS-10** (lookup fails → generic fail, details only in the log) in section 8.

- [ ] **Step 1: Write the failing tests** in `SelfCheckApiTest`: `testServiceUserWithoutPersonsRightFails`,
  `testAdministerPersonsStillFails`, `testOneGoneAdminIsReported`, `testSeveralGoneAdminsAreReported`,
  `testAdminLookupFailureIsGeneric` (assert the message above and that the log has the exception class),
  and extend `testAdminGets200WithVersion` to expect the `Admin users` check `ok`. Each fail case uses the existing
  `assertOnlyFails()`.
- [ ] **Step 2:** Run `composer test -- --filter SelfCheckApiTest`. Expected: new tests FAIL.
- [ ] **Step 3:** Implement. The admin check catches the `Failure` interface for the lookup case, logs it at `error`
  with the exception class only, and returns the generic fail.
- [ ] **Step 4:** Run `composer check`. Expected: PASS.
- [ ] **Step 5:** Tick TS-08–TS-10; commit.

```bash
git commit -am "Backend: self-check requires the persons right and reports gone admins (cleanup)"
```

---

### Task 6: Use case `CleanupOrphans` (design 3.5)

**Files:**
- Create: `backend/src/Application/Cleanup/CleanupOrphans.php`, `backend/src/Application/Cleanup/CleanupReport.php`
- Test: `backend/tests/Unit/Application/Cleanup/CleanupOrphansTest.php`

**Interfaces:**
- Consumes: `PasswordRepository::personIds()`/`delete()`, `PersonDirectory`, `GoneAdmins`, `SettingsRepository`.
- Produces:
  - `CleanupOrphans::__construct(PasswordRepository $passwords, SettingsRepository $settings, PersonDirectory $persons, GoneAdmins $goneAdmins, LoggerInterface $logger)`
  - `CleanupOrphans::run(bool $apply): CleanupReport`. Order: `assertReadable()` → `personIds()` → `settings()` →
    every `exists()` → `GoneAdmins::find()` → deletes (only if `$apply`). Any `Failure` before the deletes
    propagates.
  - `final class CleanupReport` with readonly `int $checked`, `list<PersonId> $gone`, `bool $applied`,
    `array<int, string> $failedDeletes` (person ID → error message), `list<PersonId> $goneAdmins`, and
    `exitCode(): int` = `1` if `$failedDeletes` or `$goneAdmins` is non-empty, else `0`.
  - Log lines: `info` `Deleted the password entries of person {id}; the person is deleted or archived.`; `warning`
    on a failed delete; `info` summary.

Catalog: **CL-03**–**CL-10** in section 18, one per test below.

Test setup: the real `KvPasswordRepository`, `KvSettingsRepository` and `ChurchToolsPersonDirectory` on a
`FakeChurchToolsClient` (as the other unit tests of these classes do), a Monolog `TestHandler`.

- [ ] **Step 1: Write the failing tests**
  - `testDryRunDeletesNothing` (CL-03): entries for 10 (active), 56 (unknown), 57 (archived); `run(false)` →
    `gone` = `[56, 57]`, `applied` false, `writeCount()` 0.
  - `testApplyDeletesOnlyGonePersons` (CL-04): same data, `run(true)` → entries of 56 and 57 gone, 10 kept.
  - `testFailedLookupDeletesNothing` (CL-05, data provider over position first/middle/last): `failNext('personStatus')`
    hits that position (use `beforeNext` to count) → the `Failure` propagates, `writeCount()` 0.
  - `testRateLimitHalfwayDeletesNothing` (CL-05, Review Focus 2): 4 gone persons, the 3rd lookup throws
    `RateLimitedException` → propagates, no delete.
  - `testFailedDeleteIsReportedAndOthersContinue` (CL-06): `failNext('deleteValue', UnavailableException)` → that
    person in `failedDeletes`, the other gone person deleted, `exitCode()` 1.
  - `testGoneAdminWithAnEntryIsDeletedAndReported` (CL-07, Review Focus 4): admin 100 archived with an entry →
    deleted, `goneAdmins` `[100]`, `exitCode()` 1.
  - `testPersonZeroIsIgnored` (CL-08): a self-test value with person 0 → no lookup for 0, value kept.
  - `testStringIdsAndDuplicatesAreRemovedCompletely` (CL-09, Review Focus 1): values `{"personId":"56"}` and
    `{"personId":56}` → one lookup for 56, both values deleted.
  - `testInvalidSettingsAbortBeforeDeleting` (CL-10, Review Focus 3): settings value unparsable →
    `ConfigurationException` propagates, `writeCount()` 0.
  - `testMissingRightAbortsBeforeAnyLookup` (CL-10): no persons right → `PersonsNotReadableException`, 0
    `personStatus` calls.
- [ ] **Step 2:** Run `composer test -- --filter CleanupOrphansTest`. Expected: FAIL (class missing).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `composer check`. Expected: PASS.
- [ ] **Step 5:** Tick CL-03–CL-10; commit.

```bash
git commit -am "Backend: CleanupOrphans use case (cleanup)"
```

---

### Task 7: `bin/cleanup.php` and `CleanupCommand` (design 3.8, 4)

**Files:**
- Create: `backend/src/Cli/CleanupCommand.php`, `backend/bin/cleanup.php`
- Modify: `backend/src/Kernel.php`, `backend/tests/Unit/Security/ArchitectureTest.php`
- Modify: `backend/bin/check-deploy.php` only if its required-layout list must name `bin/` (check: it must not
  reject `bin/cleanup.php`); `backend/setup/setup.sh` if it doesn't copy `bin/` into the deploy folder yet
- Modify: `backend/.htaccess`: the deny rule becomes `^(vendor|src|config|logs|bin|cache|setup|\.env)`. Defense in
  depth: the first rewrite already sends everything to `public/`, so `bin/` is never reachable over HTTP; this
  keeps it so if that rewrite breaks.
- Modify: `specs/backend-cleanup-design.md` (6.4: the in-process deviation above; 3.8: "no HTTP access: no route,
  outside `public/`, denied in `.htaccess`, and the `PHP_SAPI` guard")
- Test: `backend/tests/Unit/Cli/CleanupCommandTest.php`, `backend/tests/Unit/Cli/CleanupScriptTest.php`

**Interfaces:**
- Consumes: `CleanupOrphans`, `CleanupReport` (Task 6), `PersonsNotReadableException` (Task 3).
- Produces:
  - `CleanupCommand::__construct(CleanupOrphans $cleanup, string $lockFile, LoggerInterface $logger)`
  - `CleanupCommand::run(list<string> $arguments, resource $out, resource $err): int`. `$arguments` excludes the
    script name. Accepted: `[]` and `['--apply']`; anything else → usage on `$err`
    (`Usage: php bin/cleanup.php [--apply]`), return 2.
  - `Kernel::cleanupCommand(BackendConfig $config, ChurchToolsClient $churchTools, LoggerInterface $logger): CleanupCommand`
    (same cache, settings repository and `ExtensionData` wiring as `create()`; lock file `$config->cacheDir . '/cleanup.lock'`).
  - `Kernel::runCleanup(string $credentialsPath, string $cacheDir, string $logFile, list<string> $arguments): int`:
    loads the config like `bootstrap()`; on `ConfigurationException` writes
    `Configuration error: <message>` to STDERR and returns 2; else runs the command on STDOUT/STDERR.
  - `bin/cleanup.php`: outside the CLI `http_response_code(404); exit(1);` (as `check-deploy.php`); else
    `exit(Kernel::runCleanup(<backend>/config/credentials.php, <backend>/cache, <backend>/logs/app.log, array_slice($argv, 1)))`.

Output (design 4.3, verbatim formats):
- stdout per gone person: `deleted entry of person {id}` or `would delete entry of person {id} (dry run)`
- stdout summary: `checked {n} person(s), deleted {m} entr(y|ies)` / `checked {n} person(s), would delete {m}
  entr(y|ies) (dry run)`; singular for 1, plural otherwise (`checked 0 persons, deleted 0 entries`)
- stderr per gone admin: `adminUsers contains person {id}, who is deleted or archived; remove them in the extension settings`
- stderr per failed delete: `could not delete the entry of person {id}: {message}; the next run retries it`
- stderr on abort: the exception's message (`PersonsNotReadableException`, `ConfigurationException`) or, for a
  ChurchTools failure, `Aborted, nothing was deleted: {message}`; return 2
- stderr when locked: `Another cleanup is running.`; return 2

Catalog: **CL-11** (exit codes and output per case), **CL-12** (dry run is default), **CL-13** (lock), **CL-14**
(unknown arguments, missing `credentials.php`, via process) in section 18.

- [ ] **Step 1: Write the failing tests**
  - `CleanupCommandTest` (in-process, `php://memory` streams, command from `Kernel::cleanupCommand()` with a fake):
    - `testEmptyStoreExitsZero` (Review Focus 5): exit 0, stdout `checked 0 persons, deleted 0 entries\n` with
      `--apply`, no `personStatus` call.
    - `testDryRunIsTheDefault` (CL-12): one gone person, no arguments → exit 0, stdout lines
      `would delete entry of person 56 (dry run)` and `checked 2 persons, would delete 1 entry (dry run)`; nothing
      deleted.
    - `testApplyDeletesAndExitsZero` (CL-11): `--apply` → `deleted entry of person 56`, exit 0.
    - `testGoneAdminExitsOne` (CL-11): stderr line as above, exit 1.
    - `testFailedDeleteExitsOne` (CL-11).
    - `testFailedLookupExitsTwo` (CL-11): stderr starts with `Aborted, nothing was deleted: `, nothing deleted.
    - `testMissingRightExitsTwo` (CL-11): stderr `The service user can't read persons; see docs/setup.md.`
    - `testHeldLockExitsTwo` (CL-13): take `flock(LOCK_EX)` on the lock file in the test, run → exit 2,
      `Another cleanup is running.`, no `personStatus` call.
    - `testUnknownArgumentExitsTwo` (CL-14): `['--force']` → usage, exit 2.
    - `testOutputNamesIdsOnly`: every stdout and stderr line of a run with gone persons, a gone admin and a failed
      delete matches one of the formats below (`personStatus()` returns no names, so this pins the formats).
  - `CleanupScriptTest` (`PhpProcess`, CL-14): missing credentials path → exit 2, output starts with
    `Configuration error:`; `--force` → exit 2 with usage (needs a valid temp `credentials.php`, built as
    `ApiTestCase` does; the run must not reach ChurchTools, so assert on usage only).
  - `ArchitectureTest`: add `yield 'Cli' => ['Cli', ['Infrastructure', 'Http', 'Kernel']];`.
  - `CleanupScriptTest::testHtaccessDeniesBin`: the deny rule in `backend/.htaccess` matches `bin/cleanup.php`,
    `cache/cleanup.lock` and `setup/setup.sh` (apply the rule's pattern with `preg_match`).
- [ ] **Step 2:** Run `composer test -- --filter 'CleanupCommand|CleanupScript|Architecture'`. Expected: FAIL.
- [ ] **Step 3:** Implement. Take the lock before calling `run()` (`fopen($lockFile, 'c')`, `flock(LOCK_EX | LOCK_NB)`);
  catch the `Failure` interface for exit 2; every line written to stdout/stderr is also logged (design 4.3).
- [ ] **Step 4:** Run `composer check`. Expected: PASS. Then build a deploy folder with `setup/setup.sh` and run
  `php bin/check-deploy.php <folder>`. Expected: exit 0 and `bin/cleanup.php` present in the folder.
- [ ] **Step 5:** Update design 6.4; tick CL-11–CL-14; commit.

```bash
git commit -am "Backend: bin/cleanup.php for cron (cleanup)"
```

---

### Task 8: Documentation and spec

No code. Every statement must match the code of Tasks 2–7.

**Files:**
- Modify: `specs/backend-spec.md` per design 9 (new 4.11 and 5.8, rules at the end of 4.6, 4.8, 4.9, 5.3, 5.6,
  decision D7, Q16 answered "2026-11-12 by the cleanup design", glossary entry of the service user, section 9's Q16
  line removed)
- Modify: `specs/backend-cleanup-design.md` (status line: "Folded into `backend-spec.md`; implemented.")
- Modify: `specs/backend-plan.md` (new done item; remove Q16 from "Deliberately not in step 1"; 5.1 gains: the wizard
  grants `ServiceUserPersonsRight::DESCRIPTION`; the admin UI shows `person-not-found`)
- Modify: `backend/docs/setup.md` (grant the right; the cron line from design 4.1; dry run vs. `--apply`; exit codes)
- Modify: `backend/README.md` (`PUT` can answer `404 person-not-found`; the cleanup job)
- Modify: `backend/CHANGELOG.md` (unreleased section: the job, the `PUT` check, and **breaking**: the service user
  needs the persons right, otherwise `/v1/test` and admin writes for other persons fail)
- Modify: `TODO.md` (tick "Clean up entries of deleted users", with a pointer to the design)

- [ ] **Step 1:** Write the changes.
- [ ] **Step 2:** Run `composer check` (the release check reads the CHANGELOG) and
  `grep -rn "Q16" specs/backend-spec.md`. Expected: PASS; Q16 only among the answered questions.
- [ ] **Step 3:** Commit.

```bash
git commit -am "Docs: cleanup of deleted and archived persons (Q16)"
```
