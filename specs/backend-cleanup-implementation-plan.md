# Backend Gone Persons: Read Check, Cleanup Job and Web Cron – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deleted or archived person's password stops working within 10 minutes (read check), `PUT` refuses such
persons, and a cleanup job (CLI `php bin/cleanup.php [--apply]` or web cron `POST /v1/cleanup[?apply=1]`) deletes their
entries; gone `adminUsers` are reported.

**Architecture:** One existence decision: `GonePersons` (Application) on the port `PersonDirectory`, implemented by
`ChurchToolsPersonDirectory` (batch pre-filter `activePersonIds()`, single confirmation `personStatus()`) and wrapped
by `CachedPersonDirectory` for the read/write checks. `CleanupOrphans` is driven by a thin `Cli\CleanupCommand` and a
`CleanupController` (own token check, cooldown, lock). The fake ChurchTools passes the same person contract cases as
the real instance.

**Tech Stack:** PHP ^8.3, Slim 4, Monolog 2, Guzzle 7, PHPUnit 12, PHPStan 2, PHP-CS-Fixer (PER).

**Spec:** [`backend-cleanup-design.md`](backend-cleanup-design.md) (cited as "design n.n"). Task 10 folds it into
[`backend-spec.md`](backend-spec.md). Test cases go into a new catalog section **18. Gone persons (design 3–5)** with
the prefix `GP-`, plus new IDs in existing sections named in each task, in
[`backend-test-catalog.md`](backend-test-catalog.md). Add a case to the catalog before its test, and tick it in the
commit that proves it.

## Global Constraints

- Branch `feature/backend-cleanup`; one commit per task. Every commit passes `composer check` in `backend/`.
- Layer rules of `tests/Unit/Security/ArchitectureTest.php` hold. The new top-level namespace `Cli` may use `Domain`
  and `Application` only; Task 8 adds that rule.
- Errors follow the existing pattern: an exception extends `ApplicationException` (or `ChurchToolsException`) with a
  `Reason`; `ProblemMapping` maps every `Reason` exhaustively; `docs/problems.md` documents every `ProblemType`
  (enforced by `ProblemTypeTest`).
- Shipped files name no `church.tools` host except `example.church.tools` and `your.church.tools` (deploy check).
- No new runtime dependency.
- Output, responses and log lines name **person IDs only**, never names or other personal data; the web response
  names **no IDs at all** (design 5.2).
- Single lookups run **one after another**, never in parallel (design 3.4).
- **Only a single lookup (`personStatus()`) can make a person gone**; the batch only confirms (design C5). `403` is
  never "gone".
- **Nothing is deleted unless every lookup of the run succeeded** (design 3.5).
- Numbers: batch size **100**; person cache TTL **600 s**; web deadline **20 s**; web cooldown **600 s**;
  `CLEANUP_TOKEN` minimum **43** characters. Lock file `cache/cleanup.lock`.
- Exit codes: `0` done, `1` done with warnings, `2` aborted before deleting anything (design 4.4).
- Message texts are copied verbatim from the design where it gives them.

## Review Focus

1. **An orphan stored with a string person ID (`"56"`) or as duplicates:** found once, every value removed. Test in
   Task 7 (`testStringIdsAndDuplicatesAreRemovedCompletely`).
2. **ChurchTools answers `429` halfway through the single lookups:** the run aborts and deletes nothing, also for
   persons confirmed gone before the `429`. Test in Task 7 (`testRateLimitHalfwayDeletesNothing`).
3. **The batch answer is truncated or contains an ID that wasn't asked for:** `upstream-invalid`, never "everyone
   else is gone". Test in Task 2 (`testTruncatedBatchIsInvalid`, `testUnaskedIdInBatchIsInvalid`).
4. **A machine client reads a person deleted 5 minutes after the last successful read:** still served from the cache
   until 600 s after that read, then `404`. Test in Task 4 (`testCacheExpiresAfter600Seconds`).
5. **Web cron hits a ChurchTools outage:** `502`, and the next call within 600 s gets `429 cleanup-too-soon` instead of
   hitting ChurchTools again. Test in Task 9 (`testFailedRunStillStartsTheCooldown`).

---

### Task 1: Probe the open questions (design 9) — DONE 2026-11-12, findings in design 9.1

Interactive; needs the human partner. **No product code.** The admin-token findings are already in design 9.

**Files:**
- Create: `backend/tests/Contract/fixtures/person_status.json` (private; check `.gitignore` covers it; `chmod 600`)
- Modify: `specs/backend-cleanup-design.md` (section 9: answer the three open questions, dated)

**Produces:** `ServiceUserPersonsRight` facts for Task 2: the module and key(s) in `GET /permissions/global` that
make up the narrowest persons right, and the condition under which it counts as granted.

- [ ] **Step 1:** Ask the human partner to (a) create a dedicated service user (TODO.md already asks for one), (b)
  archive one test person and delete another, (c) note one active person. Write the three IDs to
  `person_status.json` as `{"active": n, "archived": n, "deleted": n}`.
- [ ] **Step 2:** With the dedicated user's token and **no** persons right: `GET /persons/{id}` for all three IDs and
  `2147483646`, and the batch `GET /persons?ids[]=…&limit=4`. Record statuses (field names only, no personal data).
- [ ] **Step 3:** Ask for the narrowest persons right (start with "view persons" at the lowest security level). Repeat
  step 2. Record `GET /permissions/global` before and after. If the archived person isn't visible singly, ask for the
  next broader right (e.g. archive access) and repeat.
- [ ] **Step 4: Stop check.** If step 2 gave `404` (not `403`) for the existing persons, tell the human partner
  (design 9, question 3) and wait for a decision before Task 2.
- [ ] **Step 5:** Write the findings into design 9 (incl. whether the batch returns archived persons) and commit.

```bash
git add specs/backend-cleanup-design.md
git commit -m "Plan: persons probe with a dedicated service user (gone persons)"
```

---

### Task 2: `personStatus()` and `activePersonIds()` in the client, the fake and the contract

**Files:**
- Create: `backend/src/Infrastructure/ChurchTools/PersonStatus.php`,
  `backend/src/Infrastructure/ChurchTools/ServiceUserPersonsRight.php`
- Modify: `backend/src/Infrastructure/ChurchTools/ChurchToolsClient.php`,
  `backend/src/Infrastructure/ChurchTools/GuzzleChurchToolsClient.php`
- Modify: `backend/tests/Support/FakeChurchToolsClient.php`,
  `backend/tests/Support/ChurchToolsClientContractTestCase.php`,
  `backend/tests/Unit/Infrastructure/ChurchTools/FakeChurchToolsClientContractTest.php`,
  `backend/tests/Contract/ChurchToolsClientContractTest.php`,
  `backend/tests/Contract/Helpers/ContractPrerequisites.php` (`FIXTURES` gains `person_status.json`)
- Test: the existing Guzzle client unit test in `backend/tests/Unit/Infrastructure/ChurchTools/`
- Modify: `backend/docs/testing.md` (the fixture), `specs/backend-test-catalog.md`

**Interfaces:**
- Consumes: Task 1's right.
- Produces:
  - `enum PersonStatus: string { case Active = 'active'; case Archived = 'archived'; case Gone = 'gone'; }`
  - `ChurchToolsClient::personStatus(int $personId): PersonStatus` (design 3.1 table).
  - `ChurchToolsClient::activePersonIds(list<int> $personIds): list<int>` (design 3.1; `MAX_BATCH = 100` as a public
    constant on the interface). Build the query string by hand (`ids[]=1&ids[]=2&limit=2`): Guzzle's `query` option
    would encode `ids[0]=`.
  - `ChurchToolsClient::personDepartmentIds(): list<int>`: `GET person/masterdata` as the service user →
    `data.departments[].id` (each an int, else `InvalidResponseException`).
  - `final class ServiceUserPersonsRight` (design 9.1), fail closed like `Permissions`:
    - `public static function missingIn(Permissions $permissions, list<int> $departmentIds): list<string>`: the
      missing parts, as `churchdb view`, `churchdb view archive`, `churchdb view hidden persons`, and
      `churchdb view alldata for department {id}` per missing department; `[]` when granted. Anything but exactly
      `true` (flags) or a list of ints (`view alldata`) counts as missing.
    - `public static function isGrantedIn(Permissions $permissions, list<int> $departmentIds): bool` =
      `missingIn(...) === []`.
    - `public const DESCRIPTION = 'Personen: "Personen" sehen, "Personen eines Bereiches sehen" for every department, "Personenarchiv sehen" and "Auch versteckte Personen sehen"';`
  - Fake: `addPerson(int $personId, bool $archived = false): void`, `setPersonDepartments(list<int> $ids)` (default
    `[1]`). All three new methods record their call. Without the right (per `ServiceUserPersonsRight::isGrantedIn()`
    on the fake's service permissions and departments), `personStatus()` of an existing person throws
    `ServiceCredentialRejectedException` (real ChurchTools: `403`), while an unknown ID is still `Gone` (real: `404`),
    and the batch leaves out every person (real: only otherwise visible persons). With the right, the batch returns
    archived persons with `isArchived: true` (design 9.1).
  - Contract base: `abstract protected function personIds(): array` → `array{active: int, archived: int, deleted: int}`.

Catalog: **CC-17** (Guzzle `personStatus` mapping), **CC-18** (Guzzle batch: query string, limit, validation) in
section 5; **CT-09** (single lookups), **CT-10** (batch), **CT-11** (the right suffices for archived persons) in
section 14, and add them to the CT-06 list.

- [ ] **Step 1: Write the failing tests**
  - Contract base: `testActivePersonIsActive`, `testArchivedPersonIsArchived`, `testDeletedPersonIsGone`,
    `testUnusedIdIsGone` (`2147483647`), `testBatchConfirmsOnlyTheActivePerson` (the three fixture IDs plus
    `2147483647` → exactly `[active]`), `testDepartmentsAreListed` (non-empty list of ints),
    `testServiceUserHasTheNarrowPersonsRight` (`missingIn(serviceUserGlobalPermissions(), personDepartmentIds())`
    is `[]`).
  - Fake contract test: persons 12 (active), 34 (archived); `personIds()` → `12, 34, 56`.
  - Real contract test: `personIds()` from `fixtures/person_status.json`.
  - Guzzle unit tests: `404` → `Gone`; `isArchived` `true`/`false`; `isArchived` missing or `"false"` →
    `InvalidResponseException`; `403` → `ServiceCredentialRejectedException`; the batch sends
    `GET …/api/persons?ids[]=7&ids[]=8&limit=2`; `testTruncatedBatchIsInvalid` (`total` 3, two returned);
    `testUnaskedIdInBatchIsInvalid`; a returned person with `isArchived: true` is left out; 101 IDs →
    `\InvalidArgumentException`; an empty list → `[]` without a call.
  - `ServiceUserPersonsRightTest` (unit): granted; each of the four parts missing on its own → its exact text;
    a department missing from `view alldata`; `view` as `"true"` or `1` counts as missing.
- [ ] **Step 2:** Run `composer test -- --filter 'Person|Batch|Department'`. Expected: FAIL.
- [ ] **Step 3:** Implement. `personStatus()`: `send('GET', "persons/{$this->positive($personId)}", $this->serviceUser, true)`,
  catch `NotFoundException` → `Gone`.
- [ ] **Step 4:** Run `composer check`. Expected: PASS.
- [ ] **Step 5:** Run `composer test:contract -- --filter 'Person|Batch|Department'`. The local `phpunit.xml` and
  `tests/Contract/fixtures/person_status.json` are already set up (Task 1). Expected: PASS. A failure means the fake or
  the mapping is wrong; fix before committing. Then run the whole `composer test:contract` once: every earlier case
  must still pass with the new service user.
- [ ] **Step 6:** Document the fixture in `docs/testing.md`, tick the catalog, commit.

```bash
git commit -am "Backend: personStatus() and activePersonIds() with contract cases (gone persons)"
```

---

### Task 3: `PersonDirectory`, `personIds()`, `GonePersons`, `GoneAdmins`

**Files:**
- Create: `backend/src/Application/Port/PersonDirectory.php`,
  `backend/src/Application/Exception/PersonsNotReadableException.php`,
  `backend/src/Infrastructure/ChurchTools/ChurchToolsPersonDirectory.php`,
  `backend/src/Application/GonePersons.php`, `backend/src/Application/GoneResult.php`,
  `backend/src/Application/GoneAdmins.php`
- Modify: `backend/src/Application/Port/PasswordRepository.php`, `backend/src/Infrastructure/Kv/KvPasswordRepository.php`
  (and any test double implementing `PasswordRepository`)
- Test: `backend/tests/Unit/Infrastructure/ChurchTools/ChurchToolsPersonDirectoryTest.php`,
  `backend/tests/Unit/Application/GonePersonsTest.php`, `backend/tests/Unit/Application/GoneAdminsTest.php`, the
  existing `KvPasswordRepository` unit test

**Interfaces:**
- Consumes: Task 2.
- Produces:
  - `PersonDirectory` as in design 3.2: `exists(PersonId $person): bool`;
    `confirmedActive(list<PersonId> $persons): list<PersonId>`; `assertReadable(): void`.
  - `PersonsNotReadableException extends ApplicationException`, `REASON = Reason::ServiceUserRejected`, message
    `The service user can't read persons (missing: {parts}); see docs/setup.md.`, thrown by `assertReadable()` when
    `ServiceUserPersonsRight::missingIn(serviceUserGlobalPermissions(), personDepartmentIds())` isn't empty
    (`{parts}` joined with `, `).
  - `PasswordRepository::personIds(): list<PersonId>` (design 3.3).
  - `GonePersons::__construct(PersonDirectory $persons, Clock $clock)`;
    `find(list<PersonId> $persons, ?\DateTimeImmutable $deadline = null): GoneResult`.
  - `final class GoneResult { /** @param list<PersonId> $gone @param list<PersonId> $unchecked */ public function __construct(public readonly array $gone, public readonly array $unchecked) {} }`
  - `GoneAdmins::__construct(GonePersons $gonePersons)`; `find(Settings $settings): list<PersonId>`.

Catalog: **ST-23** (`personIds()`) in section 3; **GP-01** (directory mapping and chunking), **GP-02**
(`GonePersons`), **GP-03** (`GoneAdmins`) in section 18.

- [ ] **Step 1: Write the failing tests**
  - `ChurchToolsPersonDirectoryTest`: `exists()` true/false/false for active/archived/unknown; a `RateLimitedException`
    propagates; `confirmedActive()` of 250 IDs makes 3 batch calls (100, 100, 50); `assertReadable()` passes with the
    right, throws with the exact message without it.
  - `testPersonIdsAreUniqueSortedAndSkipZero`: values for `9`, `"5"`, `5`, `0`, a broken one → `[5, 9]`.
  - `GonePersonsTest`: 5 persons, batch confirms 3 → exactly 2 single lookups, the unknown one gone, the archived one
    gone; a batch failure propagates with no single lookup; a single-lookup failure propagates; with a deadline that
    has passed (a `FrozenClock` moved forward in a `beforeNext('personStatus', …)` hook after the first lookup) the
    rest is `unchecked`; an empty input makes no call.
  - `GoneAdminsTest`: `[100, 101, 102]`, 101 archived, 102 unknown → `[101, 102]`; all active → `[]`.
- [ ] **Step 2:** Run `composer test -- --filter 'PersonDirectory|PersonIds|GonePersons|GoneAdmins'`. Expected: FAIL.
- [ ] **Step 3:** Implement. `personIds()` and `entriesOf()` share one private `allEntries()` that decodes all values,
  so the normalization rules exist once.
- [ ] **Step 4:** Run `composer check`. Expected: PASS.
- [ ] **Step 5:** Tick ST-23, GP-01–GP-03; commit.

```bash
git commit -am "Backend: PersonDirectory, GonePersons and GoneAdmins (gone persons)"
```

---

### Task 4: `CachedPersonDirectory` (design 3.2, C8)

**Files:**
- Create: `backend/src/Infrastructure/ChurchTools/CachedPersonDirectory.php`
- Test: `backend/tests/Unit/Infrastructure/ChurchTools/CachedPersonDirectoryTest.php`

**Interfaces:**
- Consumes: `PersonDirectory`; `SignedFileCache` (`get(string $name): ?array`, `put(string $name, array $data, int $ttlSeconds)`); `Clock`.
- Produces: `CachedPersonDirectory::__construct(PersonDirectory $inner, SignedFileCache $cache, Clock $clock)`;
  `public const TTL_SECONDS = 600`; cache record name `persons-active`, data `{"<personId>": <expiry unix time>, …}`,
  written with TTL 600.

Catalog: **GP-04** in section 18.

- [ ] **Step 1: Write the failing tests** (inner directory = `ChurchToolsPersonDirectory` on the fake; real
  `SignedFileCache` in a temp folder; `FrozenClock`):
  - `testExistingPersonIsCached`: two `exists(10)` → one `personStatus` call.
  - `testCacheExpiresAfter600Seconds` (Review Focus 4): `exists(10)`; advance 599 s → no call; person removed in the
    fake; advance to 600 s → call, false.
  - `testGoneIsNeverCached`: two `exists(56)` → two calls.
  - `testExpiredIdsAreDroppedOnWrite`: after 10 cached persons and 601 s, one new `exists()` leaves only that person in
    the record.
  - `testBrokenCacheIsAMiss`: corrupt the record file → a call, true, no exception.
  - `confirmedActive()` and `assertReadable()` pass through (no cache read).
- [ ] **Step 2:** Run `composer test -- --filter CachedPersonDirectoryTest`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `composer check`. Expected: PASS.
- [ ] **Step 5:** Tick GP-04; commit.

```bash
git commit -am "Backend: positive person cache for the existence checks (gone persons)"
```

---

### Task 5: `GET` and `PUT` refuse deleted and archived persons (design 3.6)

**Files:**
- Create: `backend/src/Application/Exception/PersonNotFoundException.php`
- Modify: `backend/src/Application/Failure/Reason.php`, `backend/src/Http/Problem/ProblemType.php`,
  `backend/src/Http/Problem/ProblemMapping.php`, `backend/docs/problems.md`
- Modify: `backend/src/Application/GetPassword.php`, `backend/src/Application/SetPassword.php`,
  `backend/src/Kernel.php`
- Modify: `backend/tests/Api/ApiTestCase.php`
- Test: `backend/tests/Api/EntriesApiTest.php`

**Interfaces:**
- Consumes: `PersonDirectory`, `ChurchToolsPersonDirectory`, `CachedPersonDirectory`, fake `addPerson()`.
- Produces:
  - `Reason::PersonNotFound = 'person-not-found'` → `ProblemType::PersonNotFound = 'person-not-found'`, `404`,
    title `Person not found`.
  - `GetPassword` and `SetPassword` take a `PersonDirectory $persons` as an additional constructor parameter, placed
    right after `PasswordRepository $passwords`. `Kernel` passes the `CachedPersonDirectory`.
  - `ApiTestCase::setUp()` adds every person in `NAMES` as active and grants the service user the persons right, so
    existing tests keep passing.

Rule (both use cases): look up when `!($principal instanceof PersonPrincipal && $principal->id->value === $target->value)`,
after the guard (and, for `PUT`, after the primary password), before touching the store. Gone → log `info`
(`"{principal} asked for person {id}, who doesn't exist or is archived."`) and throw `PersonNotFoundException` with
detail `Person {id} doesn't exist in ChurchTools or is archived.`

Catalog, section 8: **EG-04** (machine client reads a gone person → `404 person-not-found`), **EG-05** (own entry: no
lookup), **EG-06** (unauthorized: `403`, no lookup), **EG-07** (repeated reads within 600 s: one lookup);
**EP-14** (deleted), **EP-15** (archived), **EP-16** (own entry: no lookup), **EP-17** (unauthorized or wrong primary
password: `403`, no lookup), **EP-18** (lookup fails → `502`/`503`, nothing stored), **EP-19** (active other person →
stored). Use the next free EG number if EG-04 is taken.

- [ ] **Step 1: Write the failing tests** in `EntriesApiTest`, one per catalog case. Assert `type` ends with
  `#person-not-found`, the exact `detail`, `storedEntries()` unchanged, and lookups via
  `countCalls(['personStatus'])`.
- [ ] **Step 2:** Run `composer test -- --filter EntriesApiTest`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement. Add the `problems.md` section after `entry-not-found`, with **What to do:** "Check the
  person ID. Deleted and archived persons have no password." Reword `entry-not-found`'s sentence "This is the only
  `404` that means "no password"." so it stays true.
- [ ] **Step 4:** Run `composer check`. Expected: PASS.
- [ ] **Step 5:** Tick the cases; commit.

```bash
git commit -am "Backend: GET and PUT refuse deleted and archived persons (gone persons)"
```

---

### Task 6: Self-check: persons right, gone admins, cleanup token (design 3.7)

**Files:**
- Modify: `backend/src/Infrastructure/SelfCheck/ServiceUserRightsCheck.php`, `backend/src/Config/BackendConfig.php`,
  `backend/config/credentials-example.php`, `backend/src/Kernel.php`
- Create: `backend/src/Infrastructure/SelfCheck/AdminUsersCheck.php`,
  `backend/src/Infrastructure/SelfCheck/CleanupTokenCheck.php`
- Test: `backend/tests/Api/SelfCheckApiTest.php`, `backend/tests/Unit/Config/BackendConfigTest.php`

**Interfaces:**
- Consumes: `ServiceUserPersonsRight`, `GoneAdmins`, `SettingsRepository`.
- Produces:
  - `BackendConfig` gains `public readonly ?string $cleanupToken = null` (raw value of `CLEANUP_TOKEN`; absent or `''`
    → null; a non-string → `ConfigurationException`), `public const MIN_CLEANUP_TOKEN_LENGTH = 43`, and
    `cleanupTokenIfUsable(): ?string` (null when absent or shorter than 43).
  - `AdminUsersCheck(SettingsRepository $settings, GoneAdmins $goneAdmins)`, name `Admin users`.
  - `CleanupTokenCheck(BackendConfig $config)`, name `Web cron token`.
  - `credentials-example.php`: a commented-out `CLEANUP_TOKEN` line with the generation command from design 5.1.

Messages (verbatim):
- rights, right missing: `The service user can't read persons (missing: {parts}); the cleanup job and the existence checks need it (see docs/setup.md).`
  (`{parts}` from `ServiceUserPersonsRight::missingIn()`, joined with `, `.)
  With administrative rights too, both in one message.
- rights, ok: `The service user has no administrative rights, writes to passwordStore only and can read persons.`
- admins, fail: `adminUsers contains person 56, who is deleted or archived; remove them in the extension settings.`
  Several: `adminUsers contains persons 56, 57, who are deleted or archived; remove them in the extension settings.`
- admins, ok: `Every person in adminUsers exists.`
- admins, lookup failed: `The persons in adminUsers can't be checked right now; see the log.`
- token absent: ok, `The web-cron endpoint is off.`; too short: fail,
  `CLEANUP_TOKEN must have at least 43 characters; the web-cron endpoint stays off until it's fixed.`; ok:
  `The web-cron endpoint is on.`

Catalog, section 8: **TS-08** (persons right), **TS-09** (gone admins), **TS-10** (admin lookup fails), **TS-11**
(token check); section 4: **CF-** next free ID for `CLEANUP_TOKEN` parsing.

- [ ] **Step 1: Write the failing tests**: one per message above (using `assertOnlyFails()` for the fail cases);
  `testAdminGets200WithVersion` expects the two new checks `ok`; `BackendConfigTest` for absent, empty, short, valid
  and non-string tokens.
- [ ] **Step 2:** Run `composer test -- --filter 'SelfCheckApiTest|BackendConfigTest'`. Expected: new tests FAIL.
- [ ] **Step 3:** Implement. `AdminUsersCheck` catches the `Failure` interface, logs at `error` with the exception
  class only, returns the generic fail.
- [ ] **Step 4:** Run `composer check`. Expected: PASS.
- [ ] **Step 5:** Tick the cases; commit.

```bash
git commit -am "Backend: self-check for the persons right, gone admins and the cleanup token (gone persons)"
```

---

### Task 7: Use case `CleanupOrphans` (design 3.5)

**Files:**
- Create: `backend/src/Application/Cleanup/CleanupOrphans.php`, `backend/src/Application/Cleanup/CleanupReport.php`
- Test: `backend/tests/Unit/Application/Cleanup/CleanupOrphansTest.php`

**Interfaces:**
- Consumes: `PasswordRepository`, `SettingsRepository`, `PersonDirectory` (uncached), `GonePersons`, `GoneAdmins`.
- Produces:
  - `CleanupOrphans::__construct(PasswordRepository $passwords, SettingsRepository $settings, PersonDirectory $persons, GonePersons $gonePersons, GoneAdmins $goneAdmins, LoggerInterface $logger)`
  - `run(bool $apply, ?\DateTimeImmutable $deadline = null): CleanupReport`
  - `final class CleanupReport` with readonly `bool $applied`, `int $checked`, `list<PersonId> $gone`,
    `list<PersonId> $unchecked`, `array<int, string> $failedDeletes` (person ID → message),
    `list<PersonId> $goneAdmins`; `exitCode(): int` (`1` if `$failedDeletes` or `$goneAdmins` non-empty, else `0`);
    `deletedCount(): int` (`$applied ? count($gone) - count($failedDeletes) : 0`); `isComplete(): bool`
    (`$unchecked === []`).
  - Log: `info` `Deleted the password entries of person {id}; the person is deleted or archived.`; `warning` per
    failed delete; `info` summary.

Catalog: **GP-05**–**GP-13** in section 18, one per test.

Setup: real `KvPasswordRepository`, `KvSettingsRepository`, `ChurchToolsPersonDirectory` on a `FakeChurchToolsClient`,
`FrozenClock`, Monolog `TestHandler`.

- [ ] **Step 1: Write the failing tests**
  - `testDryRunDeletesNothing`: entries for 10 (active), 56 (unknown), 57 (archived); `run(false)` → `gone` `[56, 57]`,
    `writeCount()` 0.
  - `testApplyDeletesOnlyGonePersons`.
  - `testFailedLookupDeletesNothing` (failure in the batch, and in a single lookup).
  - `testRateLimitHalfwayDeletesNothing` (Review Focus 2): 4 unconfirmed persons, the 3rd single lookup throws
    `RateLimitedException` → propagates, no delete.
  - `testFailedDeleteIsReportedAndOthersContinue`: `exitCode()` 1.
  - `testGoneAdminWithAnEntryIsDeletedAndReported`: `exitCode()` 1.
  - `testPersonZeroIsIgnored`.
  - `testStringIdsAndDuplicatesAreRemovedCompletely` (Review Focus 1).
  - `testInvalidSettingsAbortBeforeDeleting`: `ConfigurationException`, `writeCount()` 0.
  - `testMissingRightAbortsBeforeAnyLookup`: `PersonsNotReadableException`, no person call.
  - `testDeadlineLeavesTheRestUnchecked`: deadline passes after the first single lookup → the first gone person
    deleted, the others `unchecked`, `isComplete()` false; a second run without a deadline deletes the rest.
- [ ] **Step 2:** Run `composer test -- --filter CleanupOrphansTest`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `composer check`. Expected: PASS.
- [ ] **Step 5:** Tick GP-05–GP-13; commit.

```bash
git commit -am "Backend: CleanupOrphans use case (gone persons)"
```

---

### Task 8: CLI `bin/cleanup.php` (design 4)

**Files:**
- Create: `backend/src/Cli/CleanupCommand.php`, `backend/bin/cleanup.php`
- Modify: `backend/src/Kernel.php`, `backend/tests/Unit/Security/ArchitectureTest.php`
- Modify: `backend/.htaccess`: the deny rule becomes `^(vendor|src|config|logs|bin|cache|setup|\.env)` (defense in
  depth; the first rewrite already sends everything to `public/`)
- Check: `backend/setup/setup.sh` copies `bin/cleanup.php` into the deploy folder, and `bin/check-deploy.php` accepts it
- Test: `backend/tests/Unit/Cli/CleanupCommandTest.php`, `backend/tests/Unit/Cli/CleanupScriptTest.php`

**Interfaces:**
- Consumes: `CleanupOrphans`, `CleanupReport`.
- Produces:
  - `CleanupLock` (in `src/Application/Cleanup/`): `__construct(string $lockFile)`; `tryAcquire(): bool`;
    `release(): void`. Uses `fopen($lockFile, 'c')` + `flock(LOCK_EX | LOCK_NB)`. (Plain file locking, no port; the
    web controller in Task 9 uses it too.)
  - `CleanupCommand::__construct(CleanupOrphans $cleanup, CleanupLock $lock, LoggerInterface $logger)`;
    `run(list<string> $arguments, resource $out, resource $err): int`. Accepted: `[]`, `['--apply']`; else
    `Usage: php bin/cleanup.php [--apply]` on `$err`, return 2.
  - `Kernel::cleanupServices(BackendConfig $config, ChurchToolsClient $churchTools, LoggerInterface $logger, ?Clock $clock = null): array{cleanup: CleanupOrphans, lock: CleanupLock}`
    (same cache and repository wiring as `create()`; lock file `$config->cacheDir . '/cleanup.lock'`). `create()`
    uses it too, for Task 9.
  - `Kernel::runCleanup(string $credentialsPath, string $cacheDir, string $logFile, list<string> $arguments): int`:
    on `ConfigurationException`, `Configuration error: <message>` to STDERR, return 2.
  - `bin/cleanup.php`: outside the CLI `http_response_code(404); exit(1);`; else
    `exit(Kernel::runCleanup(…/config/credentials.php, …/cache, …/logs/app.log, array_slice($argv, 1)))`.

Output formats (design 4.3, verbatim):
- stdout: `deleted entry of person {id}` / `would delete entry of person {id} (dry run)`; summary
  `checked {n} person(s), deleted {m} entr(y|ies)` / `checked {n} person(s), would delete {m} entr(y|ies) (dry run)`;
  singular for 1, plural otherwise.
- stderr: `adminUsers contains person {id}, who is deleted or archived; remove them in the extension settings`;
  `could not delete the entry of person {id}: {message}; the next run retries it`; on abort the exception's message
  (`PersonsNotReadableException`, `ConfigurationException`) or `Aborted, nothing was deleted: {message}`;
  `Another cleanup is running.`

Catalog: **GP-14** (exit codes and output), **GP-15** (dry run default), **GP-16** (lock), **GP-17** (arguments,
missing `credentials.php`, `.htaccess`) in section 18.

- [ ] **Step 1: Write the failing tests**
  - `CleanupCommandTest` (in-process, `php://memory` streams): `testEmptyStoreExitsZero` (stdout
    `checked 0 persons, deleted 0 entries`, no person call), `testDryRunIsTheDefault`,
    `testApplyDeletesAndExitsZero`, `testGoneAdminExitsOne`, `testFailedDeleteExitsOne`, `testFailedLookupExitsTwo`,
    `testMissingRightExitsTwo` (stderr starts with `The service user can't read persons (missing: `), `testHeldLockExitsTwo` (the test holds `flock` on the file),
    `testUnknownArgumentExitsTwo`, `testOutputNamesIdsOnly` (every line matches one of the formats above).
  - `CleanupScriptTest` (`PhpProcess`): missing credentials → exit 2, `Configuration error:`; `--force` → exit 2 with
    usage; `testHtaccessDeniesInternals` (`preg_match` the deny pattern against `bin/cleanup.php`,
    `cache/cleanup.lock`, `setup/setup.sh`).
  - `ArchitectureTest`: `yield 'Cli' => ['Cli', ['Infrastructure', 'Http', 'Kernel']];`
- [ ] **Step 2:** Run `composer test -- --filter 'CleanupCommand|CleanupScript|Architecture'`. Expected: FAIL.
- [ ] **Step 3:** Implement; catch the `Failure` interface and `ConfigurationException` for exit 2; log every printed
  line.
- [ ] **Step 4:** Run `composer check`. Then build a deploy folder with `setup/setup.sh` and run
  `php bin/check-deploy.php <folder>`. Expected: PASS, exit 0, `bin/cleanup.php` in the folder.
- [ ] **Step 5:** Tick GP-14–GP-17; commit.

```bash
git commit -am "Backend: bin/cleanup.php for server cron (gone persons)"
```

---

### Task 9: Web cron `POST /v1/cleanup` (design 5)

**Files:**
- Create: `backend/src/Http/Controller/CleanupController.php`,
  `backend/src/Application/Cleanup/CleanupCooldown.php`, `backend/src/Application/Port/CooldownStore.php`,
  `backend/src/Infrastructure/Store/FileCooldownStore.php`,
  `backend/src/Application/Exception/CleanupRunningException.php`,
  `backend/src/Application/Exception/CleanupTooSoonException.php`
- Modify: `Reason.php`, `ProblemType.php`, `ProblemMapping.php`, `docs/problems.md`, `backend/src/Kernel.php`
- Test: `backend/tests/Api/CleanupApiTest.php`

**Interfaces:**
- Consumes: `CleanupOrphans`, `CleanupLock` (Tasks 7–8), `AddressLimiter` with `AddressLimit::RejectedToken`,
  `BackendConfig::cleanupTokenIfUsable()`, `SignedFileStore::update(string $name, \Closure $change): array`, `Clock`.
- Produces:
  - `CooldownStore` port: `startIfDue(string $name, int $seconds): ?int`: atomically records "now" and returns null
    if the last start is at least `$seconds` ago (or none); otherwise returns the seconds left and records nothing.
    `FileCooldownStore` implements it with `SignedFileStore::update()` (fail closed: a store error is
    `500 misconfigured`, as for the other security stores).
  - `CleanupCooldown::SECONDS = 600`, `CleanupController::DEADLINE_SECONDS = 20`.
  - `Reason::CleanupRunning` → `ProblemType::CleanupRunning = 'cleanup-running'`, `409`, title `Cleanup already running`;
    `Reason::CleanupTooSoon` → `ProblemType::CleanupTooSoon = 'cleanup-too-soon'`, `429`, title
    `Cleanup ran recently`, with `Retry-After` (reuse how `TooManyAttemptsException` sets it).
  - Route: `$app->post('/v1/cleanup', [$cleanup, 'run'])` registered **outside** the `AuthMiddleware` group, next to
    `/v1/auth/token`.

Controller order (design 5.3): token configured and usable, else `404 not-found` (same body as an unknown route) →
`token` query parameter present → `400 invalid-body` → `apply` other than absent or `1` → `400 invalid-body` →
`Authorization: Bearer <x>` with `hash_equals` → on mismatch count `AddressLimit::RejectedToken` and answer
`401 invalid-token` → cooldown (`429 cleanup-too-soon`) → lock (`409 cleanup-running`) → `run($apply, now + 20 s)` →
release the lock → `200` with the body of design 5.3 (`gone` = `count($report->gone)`, `failedDeletes` =
`count($report->failedDeletes)`, `goneAdmins` = `count($report->goneAdmins)`, `complete` = `isComplete()`). Failures
propagate to `ErrorMiddleware`.

Catalog: **WC-01**–**WC-10** in a sub-section "Web cron" of section 18, one per test.

- [ ] **Step 1: Write the failing tests** (`CleanupApiTest extends ApiTestCase`; the credentials file gains a 64-char
  `CLEANUP_TOKEN` unless a test says otherwise):
  - `testOffWithoutTokenLooksLikeAnUnknownRoute`: no token, and a 42-char token → `404`, body equal to that of
    `POST /v1/nope`.
  - `testWrongOrMissingTokenIs401` and `testWrongTokensHitTheAddressLimit` (enough wrong calls → `429 too-many-attempts`).
  - `testBackendJwtIsNotAccepted`: an admin's backend token as bearer → `401`.
  - `testTokenInQueryIsRefused` and `testInvalidApplyIsRefused` → `400`.
  - `testDryRunDeletesNothing` / `testApplyDeletes`: body as design 5.3; nothing deleted / gone entries deleted.
  - `testBodyHasCountsOnly`: the raw body contains none of the person IDs involved.
  - `testCooldown`: second call → `429 cleanup-too-soon`, `Retry-After: 600`; after `FrozenClock` +600 s → `200`.
  - `testFailedRunStillStartsTheCooldown` (Review Focus 5): `failNext('activePersonIds', UnavailableException)` →
    `502`; the next call → `429`, no ChurchTools call.
  - `testRunningIs409`: hold the lock file → `409 cleanup-running`. The cooldown is checked before the lock (design
    5.3), so this call starts the cooldown: the next call within 600 s gets `429`.
  - `testDeadlineGivesIncomplete`: a `beforeNext('personStatus', …)` hook advances the clock 21 s → `complete: false`.
- [ ] **Step 2:** Run `composer test -- --filter CleanupApiTest`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `composer check`. Expected: PASS.
- [ ] **Step 5:** Tick WC-01–WC-10; commit.

```bash
git commit -am "Backend: web-cron endpoint POST /v1/cleanup (gone persons)"
```

---

### Task 10: Documentation and spec

No code. Every statement must match Tasks 2–9.

**Files:** as listed in design 8, plus `specs/backend-cleanup-design.md` (status: "Folded into `backend-spec.md`;
implemented.").

- [ ] **Step 1:** Fold the design into `backend-spec.md` per design 10; update `backend-plan.md`, `docs/setup.md`
  (persons right; cron line; cron-job.org example; exit codes), `README.md`, `CHANGELOG.md` (with the breaking note),
  `TODO.md`.
- [ ] **Step 2:** Run `composer check` and `grep -n "Q16" specs/backend-spec.md`. Expected: PASS; Q16 only among the
  answered questions.
- [ ] **Step 3:** Commit.

```bash
git commit -am "Docs: read check, cleanup job and web cron for gone persons (Q16)"
```
