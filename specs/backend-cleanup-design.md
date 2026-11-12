# CtPassStore Backend – Cleanup of Deleted and Archived Persons (Design)

> **Status: APPROVED DESIGN, not implemented.** Agreed on 2026-11-12. It answers open question Q16 in
> [`backend-spec.md`](backend-spec.md). The implementation plan folds it into `backend-spec.md` (section numbers
> under [Placement in the spec](#9-placement-in-the-spec)) and then implements it. Until then, this document is the
> reference.

## 1. Goal

Password entries in `passwordStore` remain after their person has left ChurchTools. Nothing removes them today, so
an old secondary password can still work (e.g. for RADIUS) after the person is gone.

This design adds:

1. **A cleanup job for cron**, `php bin/cleanup.php`. It deletes the `passwordStore` entries of persons who are
   deleted or archived in ChurchTools.
2. **An existence check on `PUT`.** An admin can no longer create an entry for a person who doesn't exist or is
   archived, so no new orphans appear.
3. **Reports on `adminUsers`.** IDs in the settings whose person is gone are reported. They aren't changed.

Success means:

- An entry is deleted **only** after ChurchTools confirmed the person is deleted or archived. An unclear answer
  never deletes anything.
- Cron can run the job unattended and can tell from the exit code whether it worked.
- The behavior the tests assume about ChurchTools is checked against a real instance (contract tests).

## 2. Decisions

| # | Decision | Reason |
| --- | --- | --- |
| C1 | The **service user may read persons**. It gets the narrowest right that lets it see that a person exists and whether they're archived. The probe (section 8) finds the exact right. | Without it the backend can't tell "deleted" from "not visible". A separate admin token in `credentials.php` would put a much more powerful credential on the server. |
| C2 | **Deleted and archived persons count as gone.** | Archiving means the person has left, and their secondary password should stop working. If an archived person is restored, they or an admin set a new password. |
| C3 | **`adminUsers` is only reported**, never changed. | The service user only reads the settings. Write access to them would let a leaked service token make anyone an admin. Deleted and archived persons can't log in to ChurchTools, so a gone admin can do nothing. |
| C4 | **Only a CLI script**, no HTTP endpoint for hosts without cron. | It keeps the backend lean, in case ChurchTools' new KV store makes the backend unnecessary (spec 9). An endpoint can be added later. |
| C5 | **One lookup per person**, `GET /persons/{id}`. | Every answer is unambiguous. A batch or "load all" query can't tell a missing person apart from a filtered or invisible one. `PUT` needs exactly this call too. |
| C6 | **Dry run by default**; deleting needs `--apply`. | A wrong cron line or a manual test can't delete anything. |
| C7 | **The fake ChurchTools follows the real instance**: the person cases are shared contract cases. | The tests mustn't rely on assumptions about ChurchTools that a real instance contradicts. |

## 3. Components

The layers stay as they are. Everything is wired in `Kernel` (composition root).

### 3.1 Infrastructure: `ChurchToolsClient::personStatus()`

- `personStatus(int $personId): PersonStatus` calls `GET /persons/{id}` with the service user's credential.
- `PersonStatus` is an enum with three cases:

  | ChurchTools answer | Result |
  | --- | --- |
  | `404` | `Gone` |
  | `200`, person marked archived (field from the probe) | `Archived` |
  | `200`, not archived | `Active` |
  | anything else (`401`, `403`, `429`, `5xx`, timeout, a body without the expected fields) | throws a `ChurchToolsException` subclass, as in spec 5.6 |

- A `403` is **never** read as "gone". It means the service user lacks the right, and that is an error.
- The call follows the client's existing rules (spec 5.6): central timeouts, and `429` becomes `RateLimitedException`.

### 3.2 Application port: `PersonDirectory`

```php
interface PersonDirectory
{
    /** True only for an active person. @throws ChurchToolsException if ChurchTools can't answer clearly */
    public function exists(PersonId $person): bool;
}
```

- The ChurchTools adapter (`ChurchToolsPersonDirectory`) maps `Active` to true, and `Archived` and `Gone` to false.
- The application layer knows only "exists or not". It knows nothing about archiving.
- **This is the only place that decides whether a person exists.** `PUT`, the cleanup and the self-check all use it.

### 3.3 Application: `PasswordRepository::personIds()`

- A new method returns every person ID that has at least one entry in `passwordStore`, each once, in ascending order.
- It follows the rules of spec 5.3: IDs are normalized, broken values are skipped and logged, and the reserved person
  ID 0 (self-test) is never returned.

### 3.4 Application: `GoneAdmins`

- `find(Settings $settings): list<PersonId>` returns the IDs in `adminUsers` for which `PersonDirectory::exists()`
  is false.
- It's the only code that checks `adminUsers` for gone persons. The cleanup and the self-check use it and only decide
  how to report the result.
- It throws if a lookup fails.

### 3.5 Application: `CleanupOrphans`

`run(bool $apply): CleanupReport`

1. Read the person IDs with entries (`PasswordRepository::personIds()`) and the settings.
2. Look up every person ID through `PersonDirectory`, **one after another**. The tests in parallel showed connection
   timeouts at ChurchTools (TODO.md), and a nightly job isn't in a hurry.
3. Find the gone admins (`GoneAdmins`).
4. **Only after every lookup succeeded**, and only with `$apply`: delete the entries of the gone persons with the
   existing `PasswordRepository::delete()`. That method removes duplicates and broken entries of the person too.
5. Return a `CleanupReport`: number of persons checked, the IDs deleted (or that would be deleted in a dry run), the
   IDs whose delete failed, the gone admins.

If any lookup in steps 2–3 fails, the use case throws and **nothing is deleted**.

A delete that fails in step 4 is logged and recorded in the report. The job continues with the other persons: the
deletes are independent of each other, and the next run retries the failed one.

### 3.6 Changed: `SetPassword` (`PUT /v1/entries/{id}`)

- **When:** the caller is a person, and the target isn't the caller.
  - A person's own ID comes from their verified login, so there's nothing to check.
  - Machine clients can't write (spec 4.3).
- **Order:** authorization → primary password (if required) → existence check → store.
  - Callers who may not change the entry are rejected before the lookup, so they learn nothing about which persons
    exist.
  - An admin with a wrong primary password gets `403` as before, without a lookup.
- **Gone person:** a new `PersonNotFoundException` → problem type `person-not-found`, `404`, title "Person not found",
  detail "Person 56 doesn't exist in ChurchTools or is archived." Nothing is stored.
- **Lookup fails:** the existing mappings of ChurchTools errors apply (`502 upstream-unavailable`,
  `502 upstream-invalid`, `503 upstream-rate-limited`). Nothing is stored.
- `GET` and `DELETE` are unchanged. An admin must still be able to delete an orphaned entry by hand.

### 3.7 Changed: self-check (`GET /v1/test`)

- **`ServiceUserRightsCheck`:**
  - It **requires** the persons right from C1 and fails without it: "The service user can't read persons; the cleanup
    job and the PUT check need it (see docs/setup.md)."
  - All other rules stay. In particular, `administer persons` and every other administrative right still fail the
    check.
- **New `AdminUsersCheck`:**
  - It uses `GoneAdmins`.
  - It fails if the list isn't empty: "adminUsers contains person 56, who is deleted or archived; remove them in the
    extension settings." Several IDs are listed in one message.
  - A failed lookup fails the check with a generic message. The details go to the log (as `SelfCheck` already does).
  - The self-check keeps its two states, ok and fail. There's no new "warning" state.

### 3.8 CLI entry point: `bin/cleanup.php`

- Outside the CLI it answers `404` and stops, like `bin/check-deploy.php`.
- It's wired through a new method, `Kernel::cleanup(...)`. That method uses the same `credentials.php`, cache folder
  and log file as `public/index.php`, and the same ChurchTools client.
- It parses the options, takes the lock, runs `CleanupOrphans`, prints the report and sets the exit code.

## 4. CLI behavior

### 4.1 Call

```
php bin/cleanup.php            # dry run: reports, deletes nothing
php bin/cleanup.php --apply    # deletes the entries of gone persons
```

- Any other argument: usage message on stderr, exit 2.
- Example cron line (in `docs/setup.md`):

  ```
  0 3 * * * php /path/to/backend/bin/cleanup.php --apply
  ```

### 4.2 Order of steps

1. Load the configuration. A missing or broken `credentials.php` → message on stderr, exit 2.
2. Take the lock (4.5). Already held → "Another cleanup is running." on stderr, exit 2.
3. Check the service user's rights (`serviceUserGlobalPermissions()`). Missing persons right → "The service user
   can't read persons; see docs/setup.md." on stderr, exit 2. This keeps a missing right from looking like "everyone
   is gone", in addition to `personStatus()` throwing on `403`.
4. Run `CleanupOrphans`. If a lookup fails → message naming the person ID and the error on stderr, exit 2. Nothing
   was deleted.
5. Print the report and exit with the code from 4.4.

### 4.3 Output

- **stdout:** one line per person found gone, then a summary line. Examples:

  ```
  deleted entry of person 56
  would delete entry of person 57 (dry run)
  checked 143 persons, deleted 1 entry
  ```

- **stderr:** warnings and errors, so cron mails them to the admin:

  ```
  adminUsers contains person 12, who is deleted or archived; remove them in the extension settings
  could not delete the entry of person 58: <error>; the next run retries it
  ```

- Output names **person IDs only**, never names or other personal data.
- Everything printed is also written to the backend log (`logs/app-*.log`, spec 6.4). Deletions are logged at
  `info` level, failures at `warning` or `error` level.

### 4.4 Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Done: nothing to do, or everything was deleted (or, in a dry run, would have been). |
| 1 | Done with warnings: `adminUsers` contains gone persons, or a delete failed. |
| 2 | Aborted before deleting anything: wrong arguments, configuration, lock held, missing right, failed lookup. |

### 4.5 Lock and concurrency

- An exclusive, non-blocking `flock` on `cache/cleanup.lock` keeps two runs from overlapping (e.g. a slow run and the
  next cron start). The OS releases it when the process ends.
- A user who saves a password between the lookup and the delete still exists, so the delete only hits persons
  ChurchTools confirmed as gone. If a gone person's entry is written again in between (only possible before the `PUT`
  check is deployed), the next run removes it.

## 5. Problem types and API changes

- New problem type `person-not-found` (`404`), documented in `backend/docs/problems.md`. The existing test keeps
  `ProblemType` and the documentation in sync.
- `PUT /v1/entries/{id}` can now answer `404 person-not-found`. The extension's admin UI shows it (plan 5.1).
- No new endpoint.

## 6. Testing

### 6.1 Contract: the fake and ChurchTools agree

- New shared cases in `tests/Support/ChurchToolsClientContractTestCase.php`:
  - an active person → `Active`
  - an archived person → `Archived`
  - a deleted person → `Gone`
  - an ID that was never used (e.g. `2147483647`) → `Gone`
  - the service user, with only the persons right, sees the archived person, so "archived" isn't hidden behind a
    `403`
- `FakeChurchToolsClient` gets `addPerson(int $id, bool $archived = false)` and answers like ChurchTools: `404` for an
  unknown ID, and the archived field from the probe. `FakeChurchToolsClientContractTest` runs the shared cases against
  it.
- `ChurchToolsClientContractTest` runs them against the test instance with a new private fixture,
  `tests/Contract/fixtures/person_status.json`:

  ```json
  { "active": 12, "archived": 34, "deleted": 56 }
  ```

  An admin prepares it once on the test instance: archive one person, delete another, note the IDs.
  `docs/testing.md` describes it. The file is private like the other fixtures (`chmod 600`).
- **A missing fixture fails the person cases with a clear message.** They are never skipped, in line with the rule
  that the contract suite is never reported as passed without its configuration (spec 6.6).

### 6.2 Unit tests

- `CleanupOrphans` against the fake:
  - a dry run deletes nothing and reports what it would delete
  - `--apply` deletes the entries of deleted and archived persons only
  - a failed lookup aborts before any delete, also when it's the last person
  - a failed delete is reported, and the other deletes still happen
  - gone admins are reported
  - person ID 0 is ignored
- `GoneAdmins`: empty list, some gone, a lookup that fails.
- `GuzzleChurchToolsClient::personStatus()`: `403` and a body without the expected fields throw. `404` is `Gone`.
- `KvPasswordRepository::personIds()`: duplicates once, broken values skipped, ID 0 left out, string IDs normalized.

### 6.3 API tests

- `PUT` by an admin for a deleted or archived person → `404 person-not-found`, nothing stored.
- `PUT` by an admin for an active person → stored as before.
- `PUT` by a person for their own entry → no person lookup (the fake counts calls).
- `PUT` by a caller who may not change the entry → `403` and no person lookup.
- `PUT` while the lookup fails → `502`/`503`, nothing stored.
- `/v1/test`: the rights check fails without the persons right and with administrative rights. `AdminUsersCheck` is
  ok, fails with gone admins, and fails generically when a lookup fails.

### 6.4 CLI tests

`bin/cleanup.php` runs as a separate process (like the existing `PhpProcess` helper) with the fake ChurchTools
wired in. They check:

- exit codes 0, 1 and 2, and the output on stdout and stderr for each case in 4.4
- the dry run is the default
- a second run while the lock is held exits 2
- unknown arguments exit 2 with the usage message

### 6.5 Test catalog

Each case gets an ID in [`backend-test-catalog.md`](backend-test-catalog.md), following its existing scheme.

## 7. Documentation and project files

| File | Change |
| --- | --- |
| `specs/backend-spec.md` | Fold this design in (section 9); answer Q16; service user glossary entry: "may read persons". |
| `specs/backend-plan.md` | A new item for this work; remove "Cleanup job for deleted persons (Q16)" from "Deliberately not in step 1". Add to 5.1: the setup wizard grants the persons right; the admin UI shows `person-not-found`. |
| `specs/backend-test-catalog.md` | The new cases (6.5). |
| `backend/docs/setup.md` | Grant the persons right to the service user; the cron line; dry run versus `--apply`; exit codes. |
| `backend/docs/testing.md` | The `person_status.json` fixture. |
| `backend/docs/problems.md` | `person-not-found`. |
| `backend/README.md` | `PUT` can answer `404 person-not-found`; the cleanup job. |
| `backend/CHANGELOG.md` | The cleanup job; the `PUT` check; **breaking for existing installations:** the service user needs the persons right, otherwise `/v1/test` fails and admin writes for other persons fail. |
| `TODO.md` | Tick "Clean up entries of deleted users". |

No extension code is part of this work. The extension changes go into plan item 5.1.

## 8. Probe before implementation

The first step of the implementation plan, on the test instance. Its findings go into the spec before any code
depends on them:

1. **The right:** the narrowest ChurchTools right that lets the service user read `GET /persons/{id}` for any person,
   archived ones included. Which name does it have in `GET /permissions/global`?
2. **Archived:** which field in the `GET /persons/{id}` answer marks an archived person, and what values it takes.
3. **Deleted:** does a deleted person give `404`, like an ID that was never used? Does ChurchTools keep deleted persons
   in a trash for a while, and if so, what does the API answer during that time?
4. **Not visible:** what does a service user without the right get for an existing person (`403`, or `404`)? This
   decides that the rights check in 4.2 step 3 is needed, and shows whether `personStatus()` must treat a
   `404` with caution.

If the probe shows that "deleted" and "not visible" can't be told apart by the answer alone, this design stops there and
is revisited. The cleanup must not rely on the rights check alone.

## 9. Placement in the spec

Section numbers in `backend-spec.md` are stable; new parts go at the end of their section:

| Part | Place in `backend-spec.md` |
| --- | --- |
| Existence check on `PUT` | new rule at the end of 4.6 |
| Rights check, `AdminUsersCheck` | 4.8 |
| `person-not-found` | 4.9 |
| Cleanup job (CLI, exit codes, safety) | new section **4.11** |
| `PersonDirectory`, `GoneAdmins`, `CleanupOrphans` | new section **5.8** |
| `personIds()` | new rule at the end of 5.3 |
| `personStatus()` | 5.6 |
| C1 (service user reads persons) | decision **D7** in section 8 |
| Q16 | moved to the answered questions in section 7 |
