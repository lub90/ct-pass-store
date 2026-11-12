# CtPassStore Backend – Gone Persons: Read Check, Cleanup Job and Web Cron (Design)

> **Status: Folded into [`backend-spec.md`](backend-spec.md) (sections 4.11, 4.12, 5.8, D7, D8 and the rules named in
> [section 10](#10-placement-in-the-spec)); implemented.** The spec is the reference. This document stays as the
> record of the reasoning and of the measurements in section 9. Where the code refined the design, the text below was
> updated to match. It answers open question Q16. Agreed on 2026-11-12, extended the same day by the read check (C8),
> the batch pre-filter (C5) and the web-cron endpoint (C4).

## 1. Goal

Password entries in `passwordStore` remain after their person has left ChurchTools. Nothing removes them today, so
an old secondary password still works (e.g. for RADIUS) after the person is gone.

This design adds:

1. **A read check.** A machine client (or an admin) that fetches the entry of a deleted or archived person gets
   `404 person-not-found`. The password stops working within at most 10 minutes of the deletion, whenever the cleanup
   runs.
2. **An existence check on `PUT`.** An admin can't create an entry for a person who doesn't exist or is archived.
3. **A cleanup job** that deletes the `passwordStore` entries of deleted and archived persons. It runs from server
   cron (`php bin/cleanup.php`) or from an external web-cron service (`POST /v1/cleanup`).
4. **Reports on `adminUsers`.** IDs in the settings whose person is gone are reported. They aren't changed.

Success means:

- A gone person's password stops working within 10 minutes, without the cleanup.
- An entry is deleted **only** after ChurchTools confirmed, for that single person, that they're deleted or archived.
  An unclear answer never deletes anything.
- The cleanup finishes in one web-cron call for a typical parish (a few hundred entries), within 20 seconds.
- The web-cron endpoint gives an attacker nothing: without the token it does nothing, and with a stolen token it can
  only start the same harmless cleanup, at most once per 10 minutes.
- The behavior the tests assume about ChurchTools is checked against a real instance (contract tests).

## 2. Decisions

| # | Decision | Reason |
| --- | --- | --- |
| C1 | The **service user may read persons**: `churchdb` `view`, `view alldata` for every department, `view archive` and `view hidden persons` (measured, section 9.1). | Without it the backend can't tell "deleted" from "not visible". A separate admin token in `credentials.php` would put a much more powerful credential on the server. |
| C2 | **Deleted and archived persons count as gone.** | Archiving means the person has left, and their secondary password should stop working. If an archived person is restored, they or an admin set a new password. |
| C3 | **`adminUsers` is only reported**, never changed. | The service user only reads the settings. Write access to them would let a leaked service token make anyone an admin. Deleted and archived persons can't log in to ChurchTools, so a gone admin can do nothing. |
| C4 | **Two triggers: a CLI script and a web-cron endpoint.** The endpoint is off unless `CLEANUP_TOKEN` is set, and it's protected as in section 5. | Most hosts of the target audience have no server cron. A web-cron service (e.g. cron-job.org) can send a `POST` with a header. |
| C5 | **Batch pre-filter, single confirmation.** A batch query (`GET /persons?ids[]=…`) only ever *confirms* persons as active. Every person it doesn't confirm is looked up on its own (`GET /persons/{id}`), and only that answer can make a person gone. | Single lookups take about 230 ms each (measured), so 300 persons would take 70 s, which is too long for a web call. A batch of 100 takes about 0.5 s. A batch can't tell "deleted" from "filtered" or "invisible", so it never decides "gone". |
| C6 | **Dry run by default**; deleting needs `--apply` (CLI) or `?apply=1` (web). | A wrong cron line or a manual test can't delete anything. |
| C7 | **The fake ChurchTools follows the real instance**: the person cases are shared contract cases. | The tests mustn't rely on assumptions about ChurchTools that a real instance contradicts. |
| C8 | **Read check with a short positive cache.** `GET` of another person's entry checks that the person exists. "Exists" is cached for 10 minutes; "gone" is never cached. | It closes the security gap at once, independent of how often the cleanup runs. The cache keeps RADIUS logins from costing a ChurchTools call each. |
| C9 | **Time budget instead of fixed batches.** A web run stops confirming new persons after 20 seconds; the next run continues. The CLI has no budget. | With the pre-filter, a typical run is far below the budget; the budget only protects very large installations from PHP's and the cron service's time limits. |

## 3. Components

The layers stay as they are. Everything is wired in `Kernel` (composition root).

### 3.1 Infrastructure: the ChurchTools calls

**`personStatus(int $personId): PersonStatus`**, `GET /persons/{id}` with the service user's credential.

| ChurchTools answer | Result |
| --- | --- |
| `404` | `Gone` |
| `200`, `data.isArchived` is `true` | `Archived` |
| `200`, `data.isArchived` is `false` | `Active` |
| anything else (`401`, `403`, `429`, `5xx`, timeout, no `data`, `isArchived` missing or not a boolean) | throws a `ChurchToolsException` subclass, as in spec 5.6 |

A `403` is **never** read as "gone". It means the service user lacks the right, and that is an error.

**`activePersonIds(list<int> $personIds): list<int>`**, `GET /persons?ids[]=…&ids[]=…&limit=<n>` with the service
user's credential, at most **100** IDs per call (`limit` equal to the number of IDs; ChurchTools' default page size is
10, measured).

- Returns the IDs of the returned persons whose `isArchived` is exactly `false`. A returned person with
  `isArchived: true`, or without the field, isn't in the result.
- Missing persons simply aren't in the result. The method never says why.
- The answer is checked like the KV values (spec 5.3.9): `meta.pagination.total` must equal the number of returned
  persons, and every returned ID must be one that was asked for. Otherwise `InvalidResponseException`.
- More than 100 IDs → `\InvalidArgumentException` (a programming error; callers chunk).

### 3.2 Application port: `PersonDirectory`

```php
interface PersonDirectory
{
    /** True only for an active person; the authoritative single lookup. @throws Failure if ChurchTools can't answer clearly */
    public function exists(PersonId $person): bool;

    /** The persons among $persons that are confirmed active; may leave out active ones, never includes others. */
    public function confirmedActive(array $persons): array; // list<PersonId> → list<PersonId>

    /** @throws PersonsNotReadableException if the service user lacks the persons right */
    public function assertReadable(): void;
}
```

- `ChurchToolsPersonDirectory` implements it on the client: `exists()` maps `Active` to true and `Archived`/`Gone` to
  false; `confirmedActive()` chunks into calls of 100.
- `CachedPersonDirectory` wraps another `PersonDirectory`. `exists()` answers true from the cache if the person was
  confirmed within the last **600 seconds**, else asks the inner directory and caches a true answer. False is never
  cached. The other two methods pass through. The cache is **one** record in the signed file cache (spec 6.1, fail
  open), a map from person ID to expiry; expired IDs are dropped whenever the record is written. Its size is bounded by
  the number of real persons read in the last 10 minutes, because only confirmed persons get in.
- The application layer knows only "exists or not". It knows nothing about archiving.

### 3.3 Application: `PasswordRepository::personIds()`

Every person ID that has at least one entry in `passwordStore`, each once, ascending. It follows spec 5.3: IDs are
normalized, broken values are skipped and logged, and the reserved person ID 0 (self-test) is never returned.

### 3.4 Application: `GonePersons` and `GoneAdmins`

**`GonePersons::find(list<PersonId> $persons, ?\DateTimeImmutable $deadline = null): GoneResult`** is the only code that decides
who is gone:

1. `confirmedActive()` on all of them (the batch pre-filter).
2. For every person not confirmed: `exists()`, one after another (never in parallel; parallel calls showed connection
   timeouts at ChurchTools, see TODO.md). False → gone.
3. If `$deadline` has passed (by the `Clock` port) before a single lookup starts, the remaining persons go to
   `unchecked` instead.

`GoneResult` has `list<PersonId> $gone` and `list<PersonId> $unchecked`. Any failure propagates.

**`GoneAdmins::find(Settings $settings): list<PersonId>`** is `GonePersons::find($settings->adminUsers)->gone`, in
`adminUsers` order. The cleanup and the self-check use it.

### 3.5 Application: `CleanupOrphans`

`run(bool $apply, ?\DateTimeImmutable $deadline = null): CleanupReport`

1. `assertReadable()`.
2. Read the person IDs with entries (`personIds()`) and the settings.
3. `GonePersons::find($personIds, $deadline)` and `GoneAdmins::find($settings)`.
4. **Only after steps 1–3 succeeded**, and only with `$apply`: delete the entries of the gone persons with the
   existing `PasswordRepository::delete()`. That method removes duplicates and broken entries of the person too.
   Persons in `unchecked` are left for the next run; since deleted entries leave the store, every run makes progress.
5. Return a `CleanupReport`: number of persons checked, the gone IDs (deleted, or to be deleted in a dry run), the
   `unchecked` IDs, the IDs whose delete failed, the gone admins.

If any lookup in step 3 fails, the use case throws and **nothing is deleted**. A delete that fails in step 4 is
logged and recorded in the report; the job continues with the other persons, and the next run retries.

The cleanup uses the **uncached** directory: it must never act on a cached answer. (A cached true would only make it
skip a person, which is safe, but the uncached directory keeps that reasoning out of the picture.)

### 3.6 Changed: `GetPassword` and `SetPassword`

- **When:** the caller isn't a person reading or changing their own entry. That is: every machine client, and every
  person whose ID differs from the target. A person's own ID comes from their verified login.
- **Order:**
  - `GET`: authorization → existence check (cached directory) → read the entry.
  - `PUT`: authorization → primary password (if required) → existence check (cached directory) → store.
  - Callers who may not read or change the entry are rejected before the lookup, so they learn nothing about which
    persons exist. An admin with a wrong primary password gets `403` as before, without a lookup.
- **Gone person:** a new `PersonNotFoundException` → problem type `person-not-found`, `404`, title "Person not found",
  detail "Person 56 doesn't exist in ChurchTools or is archived." Nothing is read or stored.
- **Lookup fails:** the existing mappings of ChurchTools errors apply (`502 upstream-unavailable`,
  `502 upstream-invalid`, `503 upstream-rate-limited`).
- `DELETE` is unchanged. An admin must still be able to delete an orphaned entry by hand.
- For ct-radius, `person-not-found` means "reject the login", like `entry-not-found` (plan 5.2).

### 3.7 Changed: self-check (`GET /v1/test`)

- **`ServiceUserRightsCheck`:** it **requires** the persons right from C1 (and, as before, `view custom category` on the
  extension's categories, section 9.1) and fails without it: "The service user can't
  read persons (missing: …); the cleanup job and the existence checks need it (see docs/setup.md)." All other rules stay; in
  particular, `administer persons` and every other administrative right still fail the check.
- **New `AdminUsersCheck`:** uses `GoneAdmins`. It fails if the list isn't empty: "adminUsers contains person 56, who
  is deleted or archived; remove them in the extension settings." A failed lookup fails the check with a generic
  message; the details go to the log.
- **`CleanupTokenCheck`:** if `CLEANUP_TOKEN` is set, it must have at least 43 characters, else the check fails (and
  the endpoint stays off, 5.1). Not set → ok, "The web-cron endpoint is off."
- The self-check keeps its two states, ok and fail.

## 4. CLI: `bin/cleanup.php`

### 4.1 Call

```
php bin/cleanup.php            # dry run: reports, deletes nothing
php bin/cleanup.php --apply    # deletes the entries of gone persons
```

Any other argument: usage message on stderr, exit 2. Outside the CLI the script answers `404` and stops, like
`bin/check-deploy.php`. Example cron line (in `docs/setup.md`):

```
0 3 * * * php /path/to/backend/bin/cleanup.php --apply
```

### 4.2 Order of steps

1. Load the configuration. A missing or broken `credentials.php` → message on stderr, exit 2.
2. Take the lock (6.3). Already held → "Another cleanup is running." on stderr, exit 2. The lock file can't be opened →
   its own message on stderr, exit 2.
3. Run `CleanupOrphans` without a deadline. Missing persons right → "The service user can't read persons (missing: …); see
   docs/setup.md." on stderr, exit 2. A failed lookup → a message naming the error on stderr, exit 2. An unexpected error →
   "Aborted with an unexpected error; see the log.", exit 2. Nothing was deleted.
4. Print the report and exit with the code from 4.4.

### 4.3 Output

- **stdout:** one line per gone person, then a summary line:

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

- Output names **person IDs only**, never names or other personal data. Everything printed is also logged
  (`logs/app-*.log`, spec 6.4): the stdout lines at `info`, a gone admin or a failed delete at `warning`, aborts at `error`.

### 4.4 Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Done: nothing to do, or everything was deleted (or, in a dry run, would have been). |
| 1 | Done with warnings: `adminUsers` contains gone persons, or a delete failed. |
| 2 | Aborted before deleting anything: wrong arguments, configuration, lock held, missing right, failed lookup. |

## 5. Web cron: `POST /v1/cleanup`

### 5.1 Request

```
POST /v1/cleanup            dry run
POST /v1/cleanup?apply=1    deletes
Authorization: Bearer <CLEANUP_TOKEN>
```

- **Off by default.** Without `CLEANUP_TOKEN` in `credentials.php`, or with one shorter than 43 characters, the route is
  not registered at all, so every method answers `404 not-found`, exactly like an unknown path.
- `CLEANUP_TOKEN` is generated by the admin, e.g. `php -r 'echo bin2hex(random_bytes(32)), "\n";'` (64 characters).
  It's a separate credential: it opens only this endpoint, and this endpoint accepts nothing else (no backend JWT,
  no machine token).
- The route is registered **outside** the JWT authentication group. Its controller checks the header itself with
  `hash_equals`.
- Only `POST`; other methods get `405` like every route. Link previews, crawlers and prefetchers never send `POST`.
- A `token` query parameter is rejected with `400 invalid-body` ("send the token in the Authorization header"), so the
  secret doesn't end up in URLs and access logs. `apply` accepts only `1`; any other value → `400`.

### 5.2 Safeguards

| Threat | Safeguard |
| --- | --- |
| Anyone calls the URL | Off by default (`404`). With a token set: missing or wrong token → `401 invalid-token`. |
| Guessing the token | 32 random bytes (256 bits); constant-time compare. Wrong tokens count against the existing per-address limit (spec 6.3), which only throttles noise: it doesn't slow the guessing of the right token, and a blocked address with the right token still gets `200` (deliberate, so a shared cron-service address can't be locked out). The security rests on the random token, so admins generate it with the documented command and never choose one. |
| Token leaks through URLs or logs | Header only; `token` in the query string is refused; HTTPS is enforced for every route (spec 4.1). |
| A stolen token hammers ChurchTools or the backend | **Cooldown:** a run may start at most once per **600 seconds**; earlier calls get `429 cleanup-too-soon` with `Retry-After`. The start time is kept in the security store (`SignedFileStore`, fail closed). Plus the lock: a call during a run gets `409 cleanup-running`. A holder can also starve `?apply=1` runs with dry runs inside the cooldown, so the token is rotated if it may have leaked. |
| A stolen token deletes data | It can't delete more than a normal run would: only persons ChurchTools confirms one by one as deleted or archived. It gives no access to entries, settings or anything else. |
| The response leaks data to the cron service | The response contains **counts only**, no person IDs. The IDs go only to the backend log; gone admins also show in `/v1/test`. |

### 5.3 Run and response

- The order of checks: route on → query (`token`, `apply`) → token → address limit (wrong tokens only) → cooldown →
  lock → run. The cooldown starts before the lock check, so a call that finds the lock held or that later fails also
  starts the 600 seconds, and a failing ChurchTools isn't hit every minute either.
- The run uses `CleanupOrphans` with a deadline of **20 seconds** after the request started (C9).
- `200` with:

  ```json
  {"applied": true, "complete": true, "checked": 143, "gone": 1, "deleted": 1, "failedDeletes": 0, "goneAdmins": 0}
  ```

  `complete` is false when persons were left `unchecked`; the next run continues. A dry run reports `"applied": false`
  and `"deleted": 0`. Gone admins and failed deletes still give `200`; the admin sees them in `/v1/test` and the log.
- Abort before deleting: the existing problem mappings (`500 misconfigured` for a missing persons right,
  `502`/`503` for ChurchTools, a generic `500` if the lock file can't be opened). Web-cron services usually alert on these.
- New problem types: `cleanup-running` (`409`), `cleanup-too-soon` (`429`, with `Retry-After`).

### 5.4 Setup

`docs/setup.md` gets an example for cron-job.org (and a warning that the server cron line must run as the same OS user
as PHP, or the CLI creates `logs/` and `cache/` files the web app can't write): URL `https://<backend>/v1/cleanup?apply=1`, method `POST`, header
`Authorization: Bearer <token>`, every 10 minutes to once a day. Having the setup wizard generate the token is noted for
plan 5.1, not built now.

## 6. Shared rules

### 6.1 Problem types and API changes

- New: `person-not-found` (`404`), `cleanup-running` (`409`), `cleanup-too-soon` (`429`), documented in
  `backend/docs/problems.md`.
- `GET` and `PUT /v1/entries/{id}` can now answer `404 person-not-found`.
- New route `POST /v1/cleanup` (section 5).

### 6.2 Configuration

`CLEANUP_TOKEN` (optional) in `credentials.php` and `credentials-example.php` (commented out, with the generation
command).

### 6.3 Lock

An exclusive, non-blocking `flock` on `cache/cleanup.lock` keeps two runs from overlapping, CLI and web alike. `cache/`
is created if missing. "Cannot open the lock file" is told apart from "lock held". The OS releases the lock when the
process ends. The CLI ignores the web cooldown.

## 7. Testing

### 7.1 Contract: the fake and ChurchTools agree

New shared cases in `tests/Support/ChurchToolsClientContractTestCase.php`:

- `personStatus()`: active → `Active`; archived → `Archived`; deleted → `Gone`; never used (`2147483647`) → `Gone`
- `activePersonIds()`: returns the active person, leaves out the deleted and the never-used ID, and leaves out the
  archived person; returns all of 100 active IDs in one call
- the service user, with only the persons right, sees the archived person (single lookup)

`FakeChurchToolsClient` gets `addPerson(int $id, bool $archived = false)` and answers like ChurchTools.
`ChurchToolsClientContractTest` runs the cases against the test instance with a new private fixture,
`tests/Contract/fixtures/person_status.json`:

```json
{ "active": 12, "archived": 34, "deleted": 56 }
```

An admin prepares it once on the test instance (archive one person, delete another, note the IDs);
`docs/testing.md` describes it. A missing fixture fails the person cases with a clear message; they are never
skipped (spec 6.6).

### 7.2 Unit, API and CLI tests

- `GonePersons`: pre-filter confirms most; only the rest get single lookups; a failure in either step propagates; the
  deadline moves the rest to `unchecked`.
- `CachedPersonDirectory`: true cached for 600 s, then asked again; false never cached; a broken cache record is a
  miss.
- `CleanupOrphans`: dry run, apply, abort on failed lookup, failed delete, gone admins, person 0, string IDs and
  duplicates, invalid settings, missing right, deadline.
- `GET`/`PUT` read and existence checks, including "no lookup for one's own entry" and "no lookup before
  authorization".
- Self-check: the persons right, gone admins, the token length.
- `POST /v1/cleanup`: off without token; `401`; query token refused; cooldown with `Retry-After`; `409` while
  locked; counts only, no IDs in the body; `?apply=1` deletes, without it nothing is deleted.
- CLI: the command runs **in-process** with the fake (a separate process can't share it); only "missing
  `credentials.php`" and "unknown argument" run `bin/cleanup.php` as a process.

Each case gets an ID in [`backend-test-catalog.md`](backend-test-catalog.md).

## 8. Documentation and project files

| File | Change |
| --- | --- |
| `specs/backend-spec.md` | Fold this design in (section 10); answer Q16; service user glossary entry: "may read persons". |
| `specs/backend-plan.md` | A new item for this work; remove Q16 from "Deliberately not in step 1". Add to 5.1: the wizard grants the persons right and may generate `CLEANUP_TOKEN`; the admin UI shows `person-not-found`. Add to 5.2: ct-radius treats `person-not-found` as "reject". |
| `specs/backend-test-catalog.md` | The new cases. |
| `backend/docs/setup.md` | Grant the persons right (as a table of the service user's rights);  server cron line; web cron (5.4); dry run vs. apply; exit codes. |
| `backend/docs/testing.md` | The `person_status.json` fixture. |
| `backend/docs/problems.md` | The three new problem types. |
| `backend/README.md` | `GET`/`PUT` can answer `404 person-not-found`; `POST /v1/cleanup`; the CLI. |
| `backend/CHANGELOG.md` | The read check, the `PUT` check, the cleanup (CLI and web); **breaking for existing installations:** the service user needs the persons right, otherwise `/v1/test` fails and every read of another person's entry fails (RADIUS logins included). |
| `TODO.md` | Tick "Clean up entries of deleted users". |

No extension or ct-radius code is part of this work.

## 9. Probe findings (test instance, 2026-11-12)

Measured read-only with the token in `config/credentials.php`. **That token belongs to a full admin (person 1)**, so
these findings say nothing about narrow rights or invisible persons; Task 1 of the plan measures those with a
dedicated service user.

| Question | Finding |
| --- | --- |
| Archived marker | `data.isArchived`, a boolean, on `GET /persons/{id}` and in list answers. |
| Deleted person | `GET /persons/{id}` → `404`, same as a never-used ID (IDs 2, 5, 57 on the test instance; 2147483646). |
| Batch query | `GET /persons?ids[]=…` works. It returns only existing persons; deleted and never-used IDs are left out without an error. |
| Batch page size | Default `limit` is 10 (the rest is paginated); with `limit=100` or `limit=200`, all requested persons come in one page. `meta.pagination.total` equals the number of requested persons found. |
| Timing | Single lookup ~230 ms; batch of 100 ~550 ms; batch of 200 ~490 ms. |
| Archived filter | `?isArchived=true` is **ignored** (it returns ordinary persons). The test instance seems to have no archived persons, so whether the batch includes archived persons is **open**. |

### 9.1 With a dedicated service user (plan Task 1, 2026-11-12)

Set up on the test instance: test persons "CtPassStore Probe Active" (2849), "… Archived" (2852, archived with
`POST /api/persons/{id}/archive` → `204`) and "… Deleted" (2855, `DELETE /api/persons/{id}` → `204`, then `404`), and
a service user "CtPassStore API Probe" (2858, `cmsUserId` `ctpassstore-api-probe`). The IDs are in the private
fixture `tests/Contract/fixtures/person_status.json`. Rights are granted per person with
`PUT /api/permissions/person/{id}` and `{"authId": n, "dataId": [ids]}` (`dataId` must be a list); the auth IDs come
from the legacy catalog (`churchauth/ajax`, `getMasterData`).

| Rights of the service user | Active person | Archived person | Deleted / never used | Batch of all of them |
| --- | --- | --- | --- | --- |
| none | `403 Forbidden to see Person[…]` | `403` | `404 Person […] not found.` | only persons visible otherwise (here person 1, through a shared group) |
| `view` (101) | `403` | `403` | `404` | same |
| + `view alldata` (102) for department 1 | `200`, `isArchived: false` | `403` | `404` | + the active person |
| + `view archive` (116) | `200` | `200`, `isArchived: true` | `404` | + the archived person, with `isArchived: true` |

Answers to the open questions:

1. **The right:** module `churchdb`: `view` = `true`, `view alldata` containing **every** department ID of the
   instance (`GET /api/person/masterdata` → `data.departments[].id`, readable by the service user), `view archive` =
   `true`, and `view hidden persons` = `true`. The last one couldn't be measured (setting a person to hidden needs
   "edit person visibility", which the admin doesn't have), but without it a hidden person would answer `403`, which
   would turn into `500 misconfigured` on every read of their entry, so it's required as a precaution. The default
   `security level person` (`[1]`) suffices to read `isArchived`. None of these is an administrative right.
2. **Archived persons in the batch:** returned, with `isArchived: true`, once the service user has `view archive`.
3. **Invisible vs. deleted:** `403` vs. `404`. They can be told apart, so the design holds. A `403` from
   `personStatus()` is a configuration error (`ServiceCredentialRejectedException`), never "gone". A person in a
   department the service user can't see gives `403`, so the cleanup aborts and the self-check names the missing
   departments.

**The service user's extension rights** for the contract tests (spec 4.8): `ctpassstore` `view` (2050),
`view custom category` (2051) and `view custom data` (2055) for all four categories, and `create`/`edit`/`delete
custom data` (2056–2058) for `passwordStore` only. Without `view custom category`, the category list is empty
(`200 []`), so it's needed too; spec 4.8 doesn't forbid it. With these rights the whole client contract suite passes
(17 cases, 2 skipped as with the admin token). The local `phpunit.xml` now uses this service user's token.

## 10. Placement in the spec

Section numbers in `backend-spec.md` are stable; new parts go at the end of their section:

| Part | Place in `backend-spec.md` |
| --- | --- |
| Existence checks on `GET` and `PUT` | new rules at the end of 4.5 and 4.6 |
| Rights check, `AdminUsersCheck`, `CleanupTokenCheck` | 4.8 |
| New problem types | 4.9 |
| Cleanup job (CLI, exit codes) | new section **4.11** |
| Web cron `POST /v1/cleanup` | new section **4.12** |
| `PersonDirectory`, `GonePersons`, `GoneAdmins`, `CleanupOrphans` | new section **5.8** |
| `personIds()` | new rule at the end of 5.3 |
| `personStatus()`, `activePersonIds()` | 5.6 |
| The person cache (600 s, positive only) | 6.1 |
| `CLEANUP_TOKEN` | 3.1 |
| C1 (service user reads persons), C5 (batch pre-filter) | decisions **D7** and **D8** in section 8 |
| Q16 | moved to the answered questions in section 7 |
