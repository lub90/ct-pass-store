# Fix plan: findings of the final review on the merged `feature/backend-cleanup`

Source: the final reviews of `main..47c296e` (2026-11-15):
- Superpowers final review: 2 IMPORTANT (threat model, already fixed in 5a5562b) and 8 MINOR;
- security-reviewer: APPROVED, MINOR M1–M13 plus proposed risk #51;
- test-reviewer at full depth: CHANGES_REQUIRED, I1 and MINOR M1–M15.

Per `.claude/CLAUDE.md`, review point B: every CRITICAL and IMPORTANT finding becomes a task, and MINOR findings are fixed or justified. Each task follows TDD: write a failing test first, watch it fail, then fix. The base is `9ce999f`.

The tasks touch separate areas, so each runs in its own worktree and branch and is merged back afterwards.

---

## Task M1 [security-critical]: backend tests on the security paths

- **I1 (IMPORTANT):** `backend/src/Infrastructure/ChurchTools/CachedPersonDirectory.php:72` (`liveEntries()`, the `$expires > $now` check).
  - Add a test: cache person 10 at t0 and person 11 at t0+500, remove 10, then at t0+600 `exists(10)` must be false.
  - Also assert that the rewritten cache record no longer holds 10.
  - Deleting the `$expires > $now` check must make the test fail.
- **M1:** `MachineTokens.php:79`, pin the jti length bounds: 15 rejected, 16 accepted, 128 accepted (and 129 rejected if a maximum exists).
- **M2:** `Login.php:59`, pre-check for backslash, `%` and whitespace. Add cases with `%` or `\` in the path and with whitespace. Each case must fail if the pre-check is deleted. If the pre-check is truly redundant, say so and keep it as defence in depth with a test.
- **M3:** `Login.php:63`, reject `https://user@example.church.tools/` and `https://u:p@example.church.tools/`.
- **M4:** `ChurchToolsIdentityProvider.php:116`, an integer `sub` of 0 or -1 currently gives 500. It must be treated as an invalid upstream answer (the existing upstream-invalid problem). This is a code fix plus a test.
- **M5:** `RsaPublicKey.php:27`, reject a PEM that bundles a public key with a private key or a certificate.
- **M6:** `RsaPublicKey.php:36`, pin the "must be an RSA key" branch: assert the message, or use a non-RSA key such as EC.
- **M7:** `FirebaseTokenCodec.php:30`, a correctly signed token over 8192 bytes must answer 401.
- **M8:** `FileAddressLimiter.php:119`, test future-dated hits.
- **M9:** `SettingsParser.php:88`, test a `backendUrl` without a host.
- **M10:** `ErrorMiddleware.php:106`, test that logged traces carry no argument values.

## Task M2 [security-critical]: deploy and hosting hardening

- **Security M1:** `backend/public/.htaccess` gets its own `<FilesMatch "^\.">` deny and the `php.ini` deny, so both hold when `public/` is the web root. Fix the comment at line 11.
- **Security M2:** `backend/config/php.ini-example` adds `display_errors=Off`, `display_startup_errors=Off`, `log_errors=On` and `expose_php=Off`. Optionally add `opcache.validate_permission=1` and `opcache.validate_root=1`, with a comment on when they help.
- **Security M3:** drop the `phpinfo()` step from the template (line 8).
  - Instead, the admin-only `/v1/test` reports the OPcache status: enabled yes/no, and `validate_timestamps` (from `opcache_get_status(false)`/`ini_get`, when available).
  - It must not expose paths or other host details beyond those two values.
- **Security M5:** `backend/bin/check-deploy.php` allows only `index.php` and `.htaccess`, plus `php.ini` if present, in `public/`. `setup.sh` keeps copying `public/` as before; check-deploy catches extra files.
- **Test M11:** `PhpIniTemplateTest.php:22-34`, assert that no `RewriteCond` comes directly before the deny rule.
- **Test M12:** `PhpIniTemplateTest.php:40-46`:
  - pin `revalidate_freq`, `zend_extension` and the memory setting;
  - match the actual `cp` line in `setup.sh` instead of `assertStringContainsString` over the whole file, which a comment could satisfy.
- **Docs:** add the new hardening to `backend/docs/setup.md` and `backend/CHANGELOG.md` (Unreleased).

## Task M3 [security-critical]: cleanup guard and load-test safety

- **Proposed risk #51, deletion cap: dropped (maintainer decision, 2026-11-15).**
  - ChurchTools is trusted (proposed accepted risk #3).
  - The cleanup deletes an entry only after ChurchTools explicitly answers "not found" or "archived" for that person, one by one.
  - A fixed limit would block legitimate bulk cleanups by the office.
  - #51 stays a proposed accepted risk.
  - A TODO.md entry records an optional waiting period before deletion, against human mistakes in ChurchTools.
- **Security M6:** the load test needs an explicit opt-in.
  - `backend/phpunit-example.xml` and `phpunit.xml.dist` default to `Unit,Api` (`defaultTestSuite`).
  - `LoadTest` refuses to start unless the env var `CPS_LOAD_TEST=1` is set. It marks itself skipped with a clear message, and creates nothing.
  - Update the docs that describe how to run it.
- **Security M7:** `LoadTest.php:700` writes the results file through `tempnam()` (or a 0600 file with `O_EXCL`) and prints its path. It must not follow a planted symlink.
- **Test M13:** a unit test for the `BackendSandboxManager` HTTPS router logic, or a justification if it can't be unit-tested.
- **Test M14:** `LoadSandbox.php:80,86,96`:
  - use the cache-name constants from `src` (make them public constants if needed) instead of literal strings;
  - add a unit test for `Stats::of`.

## Task M4: docs, tooling and small leftovers

- **Security M4:** `backend/docs/setup.md`, rotation and incident section: after changing `credentials.php`, reset OPcache or restart PHP.
- **Security M9:** `.github/CODEOWNERS` also covers `.claude/`, `docs/threat-model.md`, `backend/.htaccess`, `backend/public/`, `backend/setup/` and `backend/bin/check-deploy.php`.
- **Security M10:** the root `.gitignore` also ignores `/.env`, `/.env.*`, `/*.log` and `/log-*.txt`.
- **Final review IMPORTANT 1, plan side:**
  - `specs/backend-tuning-design.md` and `specs/backend-tuning-implementation-plan.md` say at the top: "needs revision before implementation". The settings cache also holds `access`, so either limit it to at most 300 s or give `access` its own fixed cache time of at most 300 s.
  - Make the two status lines consistent: the design is "Draft", and the plan is "approved 2026-11-13, needs revision".
  - Add a TODO.md entry.
- **Final review MINOR 1:** TODO.md, update or remove the stale entries: line 116 (`adminUsers`), 29 (caching), 55 (rate limiting), 93 (setup.sh permissions), and 146 and 172 (subtree items that are obsolete after the rework).
- **Final review MINOR 2:** `backend-spec.md:448`, "remove the client … from the settings" should say `access`.
- **Final review MINOR 4:** `backend/phpunit.xml.dist:5`, "Three test layers" should say four.
- **Test M15:** `extension/e2e/renewal.spec.ts:135,174`, give the popup-login poll an explicit longer timeout, such as 15 s.
- **Round-3 leftovers:**
  - the filler assertion in `Duplicates.test`;
  - the `DuplicatesChooser` test unmounts outside a `finally`;
  - X1: an upper-case host in check-dist.
- **Rule:** after the e2e change, run `npm run test:browser -- --project='chromium-*'`.

## Justified, not changed here
- **Final review MINOR 3 and MINOR 6:** the threat-model heading is already fixed in 5a5562b. The `php.ini` deny gets a row from the security-reviewer during the re-review, since it owns that file.
- **Final review MINOR 5 (two HTTPS routers):** they serve different suites in different languages. Merging them would couple the backend and extension test setups. Accepted.
- **Final review MINOR 7 (`log-firefox.txt`):** covered by Task M4's `.gitignore` rule.
- **Final review MINOR 8 (memory):** the controller's own notes, updated outside the repo.
- **Phone dropdown and focus-visible browser tests, WebKit run:** these need WebKit on the maintainer's machine. They are already listed as release prerequisites.
- **Security M12 and M13:** maintainer actions: confirm the hosted probe script was removed, and rotate the historic `.env` password. Listed in the final report.

## After the tasks
Run review point B again on `main..HEAD`, with the test-reviewer at full depth and the security-reviewer. Then the maintainer runs `/security-review`.

---

## Task M5 [security-critical]: tests of the review and privacy tooling (review point B round 2)

The source is the test review at full depth of `main..fdf67e6` plus `a618f6b`. Its full report is in the controller's scratchpad (`final/test-report-b2.md`).

- **I2 (IMPORTANT):** `scripts/check-private.mjs` reads `.private-terms` and the credential files from the main checkout when it runs in a linked worktree (`mainWorktreeRoot`, `loadEntries`). Nothing tests this.
  - Test 1: create a worktree with `git worktree add`, keep `.private-terms` only in the main checkout, and stage a hit in the worktree. The check must exit 1 and name the entry.
  - Test 2: a worktree's own `.private-terms` wins over the main checkout's.
  - Check: a mutant that makes `mainWorktreeRoot` return null must fail both tests.
- **M-N1, `scripts/check-private.mjs`:** add a test for each of these:
  - `unquotePath`, for paths with non-ASCII characters or a tab;
  - a `**/` glob that matches zero folders;
  - a credential value of exactly 6 characters;
  - a bad range with no sources at all, which is what CI runs;
  - `decodeXml` for `phpunit.xml` values;
  - a successful `--range=A..B` run;
  - deduplication of a value found in two sources;
  - `.env` lines with `export` and with an inline ` # comment`;
  - tracked symlinks in `--all` mode;
  - a pure `git mv` into a path that contains a term (`--no-renames`).

  Also:
  - Merge commits in `--range` mode: either test that hits in a merge's own changes are caught (for example with `--cc` or `-m`), or document this as an accepted gap in `README.md`.
  - Fix the hollow test at `scripts/check-private.test.mjs:629-633`: its name promises a content check, but it only checks that the file exists.
- **M-N2, `.claude/hooks/only-threat-model-writes.test.sh`:**
  - add cases where `docs/threat-model.md` itself, or the `docs/` folder, is a symlink to another file or another repository;
  - add a case where the project folder is not a git repository;
  - test that the ERR trap turns an unexpected failure into exit 2.
- **M-N3, `.githooks/pre-commit`:**
  - test that missing node blocks the commit (fails closed);
  - test that the hook checks only the staged changes. A mutant replacing `--staged` with `--all` must fail.
- **M-N4, `backend/tests/Unit/Load/StatsTest.php`:** add a case with n = 12 to tell `round` from `ceil` in the p95 rank.
- **M-N5, `backend/tests/Load/Helpers/ResultsFile.php:47`:** the docblock of the post-open check's test says why its use inside `create()` can't be unit-tested (a race).

---

## Task M6 [security-critical]: file paths of empty, binary and renamed files (review point B round 3)

The source is the test review at full depth of `main..d587c60`. Its full report is in the controller's scratchpad (`final/test-report-b3.md`). The maintainer decided on 2026-11-15 to fix it, followed by one scoped round 4 of both reviewers on the delta.

- **I3 (IMPORTANT, real defect):** `scripts/check-private.mjs:327-330`. In `--staged` and `--range` mode, a path is checked only on a `+++ ` header. Git prints none for empty files, binary files, or renames of either, so those paths are never checked.
  - Write failing tests first, in staged mode, for an empty file, a binary file and a rename of an empty file into a path that holds a term. Each must exit 1, print `(path withheld): file path matches block list entry #1`, and print no value.
  - Add one test in `--range` mode with a binary file.
  - Then take the paths from the `diff --git` header (with correct unquoting) or from a separate `--name-only -z` / `--name-status -z` listing. Check each path once per file and commit, and don't report the same path twice when a `+++` header also appears.
  - Then correct `CONTRIBUTING.md` "Known gaps" so it matches what is actually checked.
- **M-R3-1 (code gap):** `check-private.mjs:220`. In a linked worktree, the folder the credentials come from is chosen only by whether `extension/.env` exists. If the main checkout has only `backend/phpunit.xml` or only fixtures, those are never read. Choose the credential sources file by file, or by any of the three, and add worktree tests for "only phpunit.xml" and "only fixtures" in the main checkout.
- **M-R3-2:** add a negative glob case: `docs/**/x.md` must not allow `docs/ax.md`.
- **M-R3-3:** add an unquoted `.env` value with an inner `#`, such as `abc#def-zz`. It must still block as a whole value.
- **M-R3-4:** `&amp;lt;` in `phpunit.xml` must decode to `&lt;`, not `<`. Decode `&amp;` last.
