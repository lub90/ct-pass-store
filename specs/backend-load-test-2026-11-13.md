# Backend load test, 2026-11-13

Load test of the PHP backend against a real ChurchTools instance, with up to 500 entries in `passwordStore`. Suite:
`backend/tests/Load/LoadTest.php`, run with `composer test:load` (see `backend/docs/testing.md`, "Load test").

## Summary

| Target | 50 entries | 200 entries | 500 entries |
| --- | --- | --- | --- |
| RADIUS read, uncached: p95 < 1 s | **pass** (0.97 s) | fail (1.61 s) | fail (2.33 s) |
| RADIUS read, cached: p95 < 0.5 s | fail (0.70 s) | fail (1.54 s) | fail (2.39 s) |
| Password write (PUT): p95 < 3 s | pass (1.07 s) | pass (2.13 s) | pass, barely (2.92 s) |
| Self-check: < 10 s | pass (1.6 s) | pass (2.4 s) | pass (1.4 s) |

| Cleanup target (500 entries, 20 gone persons) | Result |
| --- | --- |
| Web cron: each call ≤ 30 s (budget 20 s) | **pass**: dry run 7.0 s; apply 15.4 s, complete in 1 call |
| CLI: dry run and apply < 5 min each | **pass**: 3.3–5.3 s |
| Only the entries of gone persons removed | **pass**: 20 by the web cron, 4 by the CLI, 0 others |

Reads get slower as the store grows: the backend lists the **whole** `passwordStore` on every read. At 500 entries
that list is 400 KB, and the read time grows with it. The 0.5 s cached-read target misses even at 50 entries. A
ChurchTools round trip from this network takes 100–400 ms, and a read always needs at least one.

## Environment

- **Instance:** the test instance (a dedicated ChurchTools test instance; never production). 625 persons. At the
  start, `passwordStore` held 1 value (the baseline).
- **Client:** a Linux developer machine (8 cores), PHP 8.3.6 CLI, OPcache **off** for the CLI (the PHP default).
  The test ran over the internet to the hosted instance.
- **Backend under test:** a temporary sandbox folder holding copies of `public/index.php` and `bin/cleanup.php`, the
  `VERSION` file, a symlinked `vendor/`, and its own empty `cache/` and `logs/`. `config/credentials.php` was generated
  from the real one, with three changes:
  - `CT_API_TOKEN` is the minimal service user's token (persons right and extension rights; no admin rights).
  - `CLEANUP_TOKEN` is a random 64-hex token.
  - The OAuth fields hold dummy values. The local `credentials.php` has no `OAUTH_CLIENT_ID` or
    `OAUTH_CLIENT_SECRET`, and nothing in the test uses them.
- **Server:** PHP's built-in server with one worker, behind a test router that sets `HTTPS=on` (as a TLS front end
  would). Without the router, the backend answers `400 https-required`.
- **Backend tokens** were minted directly with `JWT_SECRET`, as `LiveEntriesTest` does (no browser OAuth).
- **Admin:** the fixture admin is **not** in the instance's `adminUsers`, which is empty. The run did not change the
  settings in ChurchTools. Instead, it put the real settings plus this admin into the **sandbox's own** settings
  cache before each phase. This is the same object the backend caches after loading it from ChurchTools.
  - Effect: settings loads are cached in all measurements. With steady traffic, a real deployment reloads them only
    every 300 s.
  - The self-check reloads the real settings itself, so its timing includes that load.

## Method

> **Run this suite only against a dedicated TEST instance, never against a production instance.** It creates,
> archives and deletes persons, writes and deletes entries, and runs the cleanup job.

All requests were strictly sequential. Direct calls to ChurchTools were paced to at most about 400 per minute.
On a `429` or a timeout, the run would wait and record the event; none occurred.

1. **Baseline:** recorded the IDs and contents of all values in `passwordStore`. These values were never touched.
2. **Load persons:** created 20 persons "CtPassStore Load 01…20" with the admin token (department, campus, status).
   The instance requires the privacy fields, so the first `400` was answered by retrying with the first `validOptions`
   of each field and today's date.
3. **Entries:** gave one value each to the 20 load persons and to randomly chosen existing persons. Those had no
   entry, were not archived, and were not fixture users, admins or the service user (618 candidates). The values
   were written directly with the service user, in three stages: 50, 200 and 500 entries in total.
4. **At each stage,** against the sandbox backend:
   - Read uncached: `GET /v1/entries/{id}` as admin for a random sample of 50 persons with an entry. The sandbox's
     persons cache was cleared first, so every read includes the existence check (`GET /persons/{id}`). The settings
     cache and the module/category ID cache were warm.
   - Read cached: the same 50 persons again, within 600 s, so "exists" comes from the cache.
   - Write: `PUT /v1/entries/{id}` with a custom password for 20 random entries this run created (existing persons
     only). No primary password was needed: the instance doesn't require one.
   - Self-check: `GET /v1/test` once.
   - Reference points, measured the same way:
     - the bare KV list (`GET …/customdatavalues` as the service user), 5 times
     - one person lookup (`GET /persons/{id}`), 5 times
     - an unauthenticated request to the backend (`401`, no ChurchTools call), 5 times
5. **Cleanup at 500:**
   - Archived 10 load persons and deleted the other 10 (admin token).
   - Web cron: a dry run, then `POST /v1/cleanup?apply=1` until `complete: true`. Before each call, the cooldown
     record (`sec-<sha256("cooldown:cleanup:web-cron")>.json`) was removed from the sandbox's `cache/`.
   - CLI, a dry run first: it should find nothing left.
   - Gave 4 gone persons (2 archived, 2 deleted) an entry again, so the CLI had work.
   - CLI again: a dry run, then `--apply`, each timed.
   - After each apply, compared the store with the expected state.
6. **Teardown** (in `tearDownAfterClass`, so it runs after a failure too):
   - Deleted every value the run created. This includes any value a PUT created for the run's persons; baseline
     values are excluded.
   - Deleted all 20 load persons. Each was confirmed by a `404` from `GET /persons/{id}`.
   - Stopped the server and removed the sandbox.
   - Checked that `passwordStore` equals the baseline: same IDs and same contents.

Statistics: min, median, p95 (nearest rank) and max of the wall time measured by the client. The 50 reads per stage
give a p95 that is the third-slowest read, so single slow ChurchTools answers move it.

## Results (run 3, the complete run)

Times in milliseconds.

### Reads and writes

| Stage | Measure | n | min | median | p95 | max | Target | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 50 | Read uncached | 50 | 378 | 608 | 968 | 1316 | p95 < 1000 | pass |
| 50 | Read cached | 50 | 277 | 383 | 698 | 817 | p95 < 500 | fail |
| 50 | PUT | 20 | 362 | 590 | 1073 | 1226 | p95 < 3000 | pass |
| 50 | Self-check | 1 | | 1636 | | | < 10000 | pass |
| 200 | Read uncached | 50 | 543 | 952 | 1606 | 2203 | p95 < 1000 | fail |
| 200 | Read cached | 50 | 363 | 670 | 1540 | 1659 | p95 < 500 | fail |
| 200 | PUT | 20 | 628 | 1382 | 2134 | 2141 | p95 < 3000 | pass |
| 200 | Self-check | 1 | | 2351 | | | < 10000 | pass |
| 500 | Read uncached | 50 | 729 | 1196 | 2328 | 3742 | p95 < 1000 | fail |
| 500 | Read cached | 50 | 457 | 982 | 2391 | 2798 | p95 < 500 | fail |
| 500 | PUT | 20 | 726 | 1219 | 2915 | 3135 | p95 < 3000 | pass (barely) |
| 500 | Self-check | 1 | | 1418 | | | < 10000 | pass |

The self-check answered `207` at every stage. Only the "OAuth client" check failed, because of the dummy OAuth
values. All other checks passed, including the service user's rights and persons right.

### Reference points

| Stage | KV list size | KV list median / p95 | Person lookup median / p95 | Unauthenticated `401` median |
| --- | --- | --- | --- | --- |
| 50 | 41 KB | 126 / 240 | 388 / 410 | 2.4 |
| 200 | 161 KB | 243 / 502 | 218 / 412 | 3.6 |
| 500 | 401 KB | 417 / 1341 | 139 / 433 | 2.6 |

Writing the entries directly took 11.8 s for the first 50, 38.1 s for the next 150 and 77.7 s for the next 300. That
is about 240–260 ms per create, including the pacing.

### An earlier run (run 2) for comparison

Run 2 was stopped by Composer's 300-second process timeout during stage 500 (see "Incidents"). Its stages 50 and 200
were complete:

| Stage | Read uncached p95 | Read cached p95 | PUT p95 | Self-check |
| --- | --- | --- | --- | --- |
| 50 | 1004 (fail by 4 ms) | 787 (fail) | 1209 (pass) | 911 (pass) |
| 200 | 1309 (fail) | 1039 (fail) | 1004 (pass) | 1025 (pass) |

Both runs agree on the pattern: the medians and the minimums rise with the store size. The p95 values vary by several
hundred milliseconds between runs, because single ChurchTools answers are slow.

## Cleanup

Starting state: 501 values (500 from the run plus the baseline); 10 load persons archived, 10 deleted.

| Step | Wall time | Answer / output | Check |
| --- | --- | --- | --- |
| Web cron, dry run | 7.0 s | `checked 501, gone 20, deleted 0, complete true` | nothing deleted |
| Web cron, `?apply=1`, call 1 | 15.4 s | `checked 501, gone 20, deleted 20, failedDeletes 0, goneAdmins 0, complete true` | 20 entries of gone persons removed, 0 others, none left |
| CLI dry run | 3.3 s | `checked 481 persons, would delete 0 entries (dry run)`, exit 0 | nothing left after the web cron |
| (4 gone-person entries written again) | | | |
| CLI dry run | 5.3 s | 4 × `would delete …`, `checked 485 persons, would delete 4 entries (dry run)`, exit 0 | |
| CLI `--apply` | 4.9 s | 4 × `deleted entry of person …`, `checked 485 persons, deleted 4 entries`, exit 0 | exactly the 4 removed, 0 others |

- The web cron needed **one** apply call. At 15.4 s, that call is under the 20-second budget and the 30-second limit.
- The cooldown record was found in the sandbox's `cache/` and removed before the apply call.
- The dry run costs about half as much as the apply. The difference is the 20 deletes (plus their KV calls).
- The CLI is much faster than the web cron here, mainly because of the number of gone persons (4 vs. 20). It also
  has no deadline.

## Rate limits and timeouts

No `429` from ChurchTools and no timeout, neither in the direct calls nor in the backend (`502`/`503`). The pacing
held about 4 requests per second.

## Teardown verification

| Run | Values deleted | Already gone (404) | Persons deleted | `passwordStore` = baseline |
| --- | --- | --- | --- | --- |
| 3 | 480 | 24 (deleted by the cleanup) | 20 of 20 | **yes** (1 value, same ID and content) |

A separate check after the run found the same: only the baseline value in `passwordStore`, no "CtPassStore Load"
person, no sandbox folder, no server process.

## Incidents

- **Run 1** stopped at the first backend request: `400 https-required`. PHP's built-in server sets no `HTTPS`
  variable. Fixed in the test helper (`BackendSandboxManager` now starts the server with a router that sets
  `HTTPS=on`). Its teardown verified the baseline.
- **Run 2** was killed by Composer's default process timeout (300 s) during stage 500.
  - Composer reported the failure, but the PHPUnit process kept running.
  - The sandbox server was stopped and a manual teardown was started. It deleted every non-baseline value and the 20
    persons, and verified the baseline.
  - The orphaned PHPUnit run then ran its own teardown, in parallel for a short time. Both ignore `404`, and both
    verified the baseline.
  - Fixed: `composer test:load` now disables the process timeout.
- `LiveEntriesTest` (Contract) uses the same `BackendSandboxManager`, so it would also have got `400 https-required`.
  On this machine it is **skipped** before it starts the server: `config/credentials.php` lacks
  `OAUTH_CLIENT_ID`, which it needs. The router fix now applies to it too, but it couldn't be run end to end here.

## Conclusions

- **What dominates a read: the KV list.** Every `GET /v1/entries/{id}` loads the whole `passwordStore` category,
  because the KV store can't filter by person.
  - Its size grows linearly: 41 → 161 → 401 KB.
  - Its time grows with it: median 126 → 243 → 417 ms when measured alone.
  - The cached read's median grows the same way: 383 → 670 → 982 ms.
  - The cached read stays above the bare list by 260–560 ms. That gap is the backend's work around the list (receiving and
    JSON-decoding it, finding the person's entry) plus request overhead. It also grows with the size, so handling
    the list matters too, not only ChurchTools' time to produce it.
- **The existence check costs one person lookup.** Uncached minus cached is about 100–200 ms at the median. That
  matches one `GET /persons/{id}` (139–388 ms median). It doesn't depend on the store size.
- **PHP itself is cheap:** an unauthenticated request takes 2–4 ms (median), even without OPcache.
- **Writes** list the store too, and also update or create a value and encrypt with RSA-4096. At 500 entries the p95
  is just under 3 s. Somewhat more entries, or a slower ChurchTools, will cross it.
- **Which targets are realistic:**
  - Self-check < 10 s and cleanup (web ≤ 30 s, CLI < 5 min): clearly met at 500 entries. The web cron needed one
    call; at 20 gone persons, 15.4 s leaves 4.6 s to the 20-second budget. Many more gone persons on one day would
    need a second call, which the design allows (`complete: false`).
  - PUT p95 < 3 s: met up to 500 entries, without margin.
  - Uncached read p95 < 1 s: met only for small stores (about 50 entries).
  - Cached read p95 < 0.5 s: not met even at 50 entries from this network. At 500 entries the median is already
    about 1 s. Reaching it needs fewer bytes per read: a per-person category or a filter in the new KV store (see the
    pending ChurchTools KV rework), or a short-lived server-side copy of the list. Caching the list conflicts with
    spec 6.1 ("`passwordStore` values are never cached"), so that would be a design decision, not a tuning step.
- **Caveats:**
  - One run on one network. The p95 values vary by several hundred milliseconds between runs.
  - OPcache was off; on a production host with OPcache, the PHP share is smaller. The ChurchTools share is not.
  - The admin was granted only in the sandbox's settings cache, so settings loads are not part of the read times.
