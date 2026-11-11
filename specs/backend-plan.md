# CtPassStore Backend – Implementation Plan (Step 1)

This plan implements **step 1** of [`backend-spec.md`](backend-spec.md): security and correctness first, kept lean,
because ChurchTools' upcoming KV store may make the backend unnecessary (spec section 9). Step 2 (ct-radius talking
only to the backend) isn't part of it.

**How we work:**

- Each numbered item is roughly one pull request into `develop` (git flow, branches `feature/<name>`).
- Each item comes with its unit tests. The end-to-end suite must stay green, or be adapted in the same item.
- Before an item starts, the open questions it depends on (❓) are answered and written into the spec.
- Spec references in brackets point to [`backend-spec.md`](backend-spec.md).

## Phase 0 – Foundations (no behavior change)

- [x] **0.1 Tooling**
  - `composer.json`: `php: ^8.3`, dev dependencies for PHPUnit (12), PHPStan (2), PHP-CS-Fixer.
  - Composer scripts `test`, `stan`, `cs`, `cs:fix`.
- [x] **0.2 Prepare the three test layers** (spec 6.6)
  - Suites `Unit` and `Api` (default run and CI, no network) and `EndToEnd` (opt-in, later renamed to `Contract`).
  - The `Api` suite and folder exist from the start, even before the first API test.
  - A first real unit test (`PasswordValidator`, current behavior).
  - Run without configuration, the end-to-end suite aborts with a clear message instead of passing.
- [x] **0.3 Static analysis and code style**
  - PHPStan at an agreed level with a baseline for existing findings; raise the level later.
  - PHP-CS-Fixer with the PER coding style.
- [x] **0.4 CI**
  - A GitHub Actions workflow on push and pull request, PHP 8.3 / 8.4 / 8.5.
  - It runs `composer validate`, `composer audit`, the code-style check, PHPStan and the unit tests.

- [x] **0.5 Test catalog** (before any tests of phase 1 are written)
  - `specs/backend-test-catalog.md` lists the test cases per unit and for the API and contract layers.
  - Cases are grouped as normal, edge, special and **security-critical**, and each one is assigned to a layer.
  - The tests in phases 1 to 4 are written against it and checked off. A case that's added during implementation goes
    into the catalog first.

## Phase 1 – Own ChurchTools client (D1)

- [x] **1.1 `ChurchToolsClient` interface and Guzzle implementation** (spec 5.6)
  - URL normalization, a central timeout, `X-OnlyAuthenticated`, unwrapping of the `data` envelope.
  - The `meta.count` completeness check (spec 5.3 rule 9).
  - One exception type per error case, so the middleware can map them.
  - Unit tests with Guzzle's `MockHandler`.
- [x] **1.2 Migrate the services to it**
  - `ExtensionDataService`, `ChurchToolsStore`, `ServiceSettings`, the primary-password check.
  - Remove `churchtools/php-client` and the fork repository from `composer.json`.
  - The end-to-end suite stays green.

## Phase 2 – Errors and correctness

Decided: Q6, Q7, Q8, Q9, Q10 (spec section 7).

- [x] **2.0 API test layer** (spec 6.6; **at the latest here**)
  - Make the app buildable in tests: configuration and the ChurchTools client are injected instead of being read from
    `credentials.php` and built inside `bootstrap.php`.
  - A test helper builds the Slim app with a fake `ChurchToolsClient` and in-memory settings, sends PSR-7 requests and
    asserts status, problem type and body.
  - The first API tests cover today's behavior of `/entries/{id}` and `/test`. Every item from 2.1 onward adds its API
    tests here.
- [x] **2.1 Problem Details** (D2, spec 4.9)
  - Exception hierarchy and error middleware, `404 not-found`, `405 method-not-allowed`.
  - `backend/docs/problems.md` with one section per type.
- [x] **2.2 Configuration and settings validation** (spec 3.1, 3.2)
  - Missing or invalid configuration gives `500 misconfigured` with a precise `detail`.
  - The OAuth keys and `JWT_SECRET` are checked if present; they become required in 3.1. `machineClients` is
    validated in 3.3.
- [x] **2.3 Store fixes** (spec 5.3)
  - One ID comparison everywhere.
  - Duplicate healing: read the newest, update it and delete the rest on write.
  - Skip broken values instead of crashing.
  - *Moved to 4.1:* re-resolving stale cached module/category IDs (ST-18); IDs aren't cached across requests yet.
- [x] **2.4 Input validation and password policy** (spec 4.1, 5.1)
  - `invalid-id` and `invalid-body`.
  - Maximum length 128, the `violations` member, a secure shuffle.
- [x] **2.5 Upstream errors** (spec 6.2)
  - `502 upstream-unavailable` / `upstream-invalid`, and `503 upstream-rate-limited` with `Retry-After`.
  - Mostly done in 2.1; 2.5 added the mapping of rejected permission reads and tests for every step of a request.
    `Retry-After` for `too-many-attempts` follows with the rate limit in 3.5.
- [x] **2.6 Banned functions via PHPStan** (spec 6.6)
  - Add a disallowed-calls rule set (e.g. `spaze/phpstan-disallowed-calls`): `eval`, `unserialize`, `exec` and other
    shell calls, `str_shuffle`, `rand`, `mt_rand`, and loose comparisons of secrets. This replaces source scans in
    tests (catalog IJ-06, PG-05, TR-01).
  - Add a pull request template with a short security checklist, e.g. "no secret is compared with `==`/`===`", "no
    secret, token or password is logged", "new problem types are documented in `problems.md`".

- [x] **2.7 Architecture refactoring** (behavior-neutral, before phase 3)
  - Layers: `Domain` (value objects, policies), `Application` (use cases), `Infrastructure` (ChurchTools, KV
    repositories, crypto, clock), `Http` (controllers, middleware, problems, request parsing). `Kernel.php` is the
    only place where everything is wired.
  - Value objects `PersonId`, `Settings`, `PublicKey`; `PasswordPolicy`; typed `Principal`; `AccessPolicy` as a pure
    class; use cases `GetPassword`, `SetPassword`, `DeletePassword` with their own exceptions, mapped to problem types
    by the error middleware.
  - `SettingsRepository`, `PasswordRepository`, `PasswordCipher`, `PrimaryPasswordVerifier`, a PSR-20 clock.
  - Dissolve `AppConfig`; remove the `BaseService` base classes and PHP-DI.
  - Then: concurrency tests (TR-02) deterministic with the fake and in parallel against the test instance, and a
    writing smoke run against the test instance.

## Phase 3 – Authentication (D4, D5)

Decided: Q4, Q5, Q20, Q21, Q23 (spec section 7).

- [x] **3.1 Token service**
  - Issue and validate backend JWTs (HS256, pinned algorithm) with a small, well-known library such as
    `firebase/php-jwt`, which also supports EdDSA.
  - New configuration keys `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `JWT_SECRET`.
- [x] **3.2 `POST /auth/token`** (spec 4.4)
  - OAuth code exchange, checks on the ChurchTools token, `whoami` and the `view` permission.
  - Discard the ChurchTools tokens, then issue the backend token.
- [x] **3.3 Machine client tokens** (spec 4.4a)
  - EdDSA verification against `settings.machineClients`, claim checks, the `jti` replay cache.
- [x] **3.4 New auth middleware and authorization** (spec 4.3)
  - Bearer tokens only: remove the `Login` scheme.
  - Typed principals (person vs. machine client), roles from the cached settings, the access matrix.
  - All paths under `/v1/`; the old paths answer `404`. `readAccessUsers` is removed.
  - `/v1/test` refuses machine clients; restricting it to admins follows with 4.2.
- [x] **3.5 Primary password check** (spec 5.5, 6.3)
  - Simple rate limiting per person.
  - Upstream errors no longer count as a wrong password.
- [x] **3.6 Shrink the end-to-end tests to contract tests**
  - Rename the suite and folder to `Contract`. Remove cases that the API layer now covers (authorization matrix,
    status codes, problem types).
  - Keep only what needs real ChurchTools: KV read/write and `meta.count`, service-user permissions, primary password
    check, OAuth code exchange errors, a few smoke tests against the running backend.
  - A test helper mints backend tokens directly with the test `JWT_SECRET`, and machine tokens with a test key. The
    smoke tests against a deployed test backend use the same helper (catalog section 14); document it in
    `backend/docs/testing.md`.
  - The real OAuth flow (it needs a browser) is checked by hand before each release, with a short checklist.

- [x] **3.7 Architecture follow-up** (behavior-neutral, before phase 4)
  - Errors carry a category (enum); the HTTP layer maps each category to exactly one problem type with an exhaustive
    `match`. The HTTP layer no longer knows ChurchTools exception classes. `ConfigurationException` is split by cause.
  - The token rules (required claims, lifetimes, leeway, order of checks) move out of `Infrastructure`; only signing
    and verifying with firebase/php-jwt stays there (`TokenCodec`).
  - `SettingsParser` (pure: decoded JSON → `Settings` plus findings) is split from loading; the findings leave the
    domain object `Settings`. It stays in `Infrastructure/Kv`, because it knows the stored format.
  - Typed ChurchTools answers (`WhoAmI`, `Permissions`) instead of loose arrays.
  - An architecture test: `Domain` and `Application` import nothing from `Infrastructure`, `Http` or `Config`.
    `SelfCheckController` still uses `KvSettingsRepository` directly; 4.2 rebuilds it on ports.
  - Deliberately not done: folders per feature area (over-engineering for a backend this size, see the decision of
    2026-11-09).

## Phase 4 – Operations and release

Decided: Q11, Q14, Q17, Q18 (spec section 7).

- [x] **4.1 Cache** (spec 6.1)
  - A file cache outside the web root for settings, the public key, the module and category IDs. No APCu (Q3, kept
    lean). The `jti` replay cache and the attempt counters already live in the `SignedFileStore`.
  - Re-resolve stale cached module/category IDs once per request (spec 5.3.10, catalog ST-18).
  - Shared hosting (spec 6.1, "Locking" and "Bounded size"): document that the cache folder must be on a file system
    where `flock` works; confirm that every security record prunes expired items on write; test that the number of
    files stays bounded under many distinct callers.
- [x] **4.1a ChurchTools call budget for unauthenticated requests** (spec 6.2, review finding 2026-11-08)
  - Today a forged machine token costs 3 ChurchTools calls (settings before `kid` can be checked) and any
    `POST /v1/auth/token` costs 1. A few requests per second from anyone can exhaust the shared 600/min per IP, so
    every user and every WiFi login gets `503`.
  - With the settings cache (4.1), a forged machine token costs 0 calls.
  - A cheap per-IP limit (`REMOTE_ADDR`) for `POST /v1/auth/token` and for rejected tokens, in the `SignedFileStore`,
    answering `429 too-many-attempts` (spec 6.3). It must fail closed for the login and must not lock out a whole
    NAT'd parish by one person's mistakes: generous limits, short windows (Q26, accepted: 30 logins and 60 rejected
    tokens per address and minute, 256 buckets).
  - IPv6 addresses count per `/64`. The counters live in a **fixed number of buckets** (the address hashed into one),
    never one file per address: the interface is public, and lock files are never deleted (spec 6.1).
  - Test (catalog RX-06): a call budget per kind of unauthenticated request, counted on the fake.
- [x] **4.2 Extend `/test`** (spec 4.8)
  - File permissions, the OAuth and JWT configuration, the service user's rights (warn on admin rights), valid machine
    clients, the version.
  - The cache folder: `flock` works there, and the number of files is reported and stays below the limit (spec 4.8,
    6.1).
- [x] **4.3 Hardening**
  - Security headers, the CORS method list, the HTTPS check (Q17).
  - Configurable log level and rotation, no secrets in logs (spec 6.4).
- [x] **4.4 Deployment**
  - `setup.sh` sets permissions and runs a check of the deploy folder (no `credentials.php`, no dev files, no instance
    URL).
  - Update `backend/docs/setup.md`: permissions for both hosting cases, OAuth setup, rotating secrets.
- [x] **4.5 Release**
  - The version string `x.y.z[+sha[-dirty]]` (spec 6.5).
  - A `CHANGELOG.md` and a release workflow on tags with a release check.
  - Updated API docs in `backend/README.md`. First release of the new API.
- [ ] **4.6 Setup endpoint `/v1/setup`, installation without a shell** (after the first release; spec 4.10, 6.5, D6)
  - **Why:** the new authentication makes the backend's setup harder: an OAuth application whose secret is shown only
    once, `JWT_SECRET`, the service user's token, the per-user login right, file permissions that uploads don't keep,
    and Ed25519 keys for machine clients. The setup is accepted as it is for the first release and documented in
    `backend/docs/setup.md` (4.4). 4.6 removes the manual steps: the admin uploads the release zip by FTP and clicks
    through the extension's wizard. User friendliness for church members belongs to the extension (phase 5), not to
    the backend.
  - **Decided 2026-11-11 (D6), replacing the setup code, the PHP wizard page and the copied bundle of 2026-11-10:**
    - The **extension's setup wizard** (5.1) does everything on the ChurchTools side and then sends the service user's
      login name and random password and the OAuth client ID and secret to `POST /v1/setup`. The instance comes from
      the `Origin` header. The backend logs in from the server and fetches the service user's token itself (changed
      2026-11-11, spec 4.10, D6); it never receives admin credentials.
    - **No setup code.** Setup mode exists while `credentials.php` doesn't; the first valid setup wins. Accepted
      risk: someone can block the setup, but never take it over unnoticed, because the extension does the binding
      check (spec 6.3, D6).
    - The backend never handles admin credentials, and the backend has no HTML UI.
  - **Backend:**
    - `Kernel::bootstrap()` picks the app from the state of `credentials.php` (spec 3.1): missing → setup app; broken or
      unreadable → misconfigured app (never the setup app); valid → normal app.
    - `GET` and `POST /v1/setup` as in spec 4.10: pre-check, `Origin` and address checks, ChurchTools checks with the
      new values, writing under a lock, `201` with `instanceUrl` and `oauthClientId`. The other modes answer `409` or
      `500`. CORS `*` for this route in every mode (spec 4.2).
    - Reuse the checks of 4.2 (local checks, the OAuth client check, the rights check); don't duplicate them.
    - New problem types `already-configured`, `setup-check-failed`, `not-configured` (spec 4.9), documented in
      `backend/docs/problems.md`.
  - **Release and deployment** (takes over from 4.4 and 4.5 without changing what they ship for the first release):
    - Remove `setup/setup.sh`.
    - The release workflow builds `ctpassstore-backend-x.y.z.zip` (`vendor/` with `--no-dev`, no `credentials.php`, no
      dev files); the deploy-folder check of 4.4 runs on the zip.
    - Rewrite `backend/docs/setup.md`: download the zip, upload it by FTP, set `public/` as the web root, and
      **continue in the extension's setup wizard right after the upload, without a break** (until then, anyone who
      finds the URL can block the setup). Troubleshooting: `409` and re-arm (delete `config/credentials.php` and run the
      wizard again), HTTPS and certificate errors, a web root that ignores `.htaccess`, a `config/` folder that PHP
      can't write. Writing `credentials.php` by hand stays documented as the manual path.
  - **Replacing secrets later** (decided 2026-11-11, replaces `setup.sh --rearm`): delete `config/credentials.php` over
    FTP and run the extension's wizard again. It sets a new password for the service user (which invalidates the old
    token) and creates a new OAuth client; the backend fetches the new token and generates a new `JWT_SECRET`.
  - **Tests:**
    - Kernel modes: missing, unreadable, broken and valid `credentials.php`.
    - The setup endpoint against the ChurchTools fake: every check that can fail (including a wrong password and a
      login that asks for a second factor); nothing written after a failure; the password never appears in the log
      or the answer;
      `Origin` turned into `CT_API_URL` and `CORS`; the request-forgery rules (`http`, IP literal, private address,
      redirect).
    - Writing: the written file loads through `BackendConfig::fromArray`; values with quotes or `?>` can't inject
      code; mode `600`; two parallel setups give one `201` and one `409`.
    - CORS preflight of `/v1/setup` in all three modes.
    - A contract test against the test instance: one real setup into a temporary folder.
  - **Open, to check before 4.6 and the setup part of 5.1 start:**
    - ~~OAuth client check without a browser~~: **measured 2026-11-10, possible.** `POST /oauth/access_token` with a
      made-up code answers `400 {"error":"invalid_grant"}` when client ID and secret are right, `401
      {"error":"invalid_client"}` when the secret is wrong, and `404 error.notfound` (a ChurchTools error, not OAuth)
      for an unknown client ID. So `/v1/setup` and `/v1/test` can check the client by exchanging a made-up code.
      The skipped contract cases `testAnUnknownAuthorizationCodeIsRejected` and
      `testAWrongClientSecretIsRejectedAsClient` still need `OAUTH_CLIENT_ID` and `OAUTH_CLIENT_SECRET` in the test
      instance's `config/credentials.php` to run.
    - **API details for the wizard** (measured 2026-11-10): `POST /api/oauthclients` expects `redirectUri` as a
      **string** (it answers with a list) and returns `clientSecret` only in that response; `DELETE` (and the other
      single-client calls) address the client by its `identifier`, not by its numeric `id`.
    - ~~Service token rotation~~: **measured 2026-11-10.** Changing a person's password invalidates their login token
      at once (`401 No valid token`), and `GET /persons/{id}/logintoken` afterwards returns a **new**, working token.
      So the re-arm bundle gets a new token by setting a new password and fetching the token again.
      `DELETE /persons/{id}/logintoken` also exists (not measured yet).
    - ~~Module lookup right~~: **measured 2026-11-10.** `GET /api/custommodules/{key}` (and by ID) needs `view` on the
      extension; without it ChurchTools answers `403`. `GET …/customdatacategories` answers `200` but lists only the
      categories the person may see. So the service user needs `view` on the extension, `view custom category` and
      `view custom data` for its categories, and create/edit/delete custom data for `passwordStore` only.
    - **Setting the service user's password:** `PUT /api/persons/{id}/password` changes the password of the
      **logged-in** person, whatever `{id}` says, and needs that person's current password as `oldPassword` (measured
      2026-11-10: called as admin with another person's ID, it changed the admin's password). So the wizard can't set
      the new person's password this way.
      **Found 2026-11-11** (recorded in the browser, from the person view of the ChurchTools admin): the legacy AJAX
      API sets another person's password. `POST /index.php?q=churchdb/ajax`, form-encoded
      (`application/x-www-form-urlencoded`), body `func=setPersonPassword&id=<personId>&password=<new password>`
      (the UI also sends `browsertabId`, probably not needed), with the admin's session cookie and the `CSRF-Token`
      header (from `GET /api/csrftoken`, see `ct-extension-info.md`). Answer: `200 {"status":"success","data":null}`.
      The extension runs on the instance's own origin with the admin's session, so it can make this call.
      **Measured 2026-11-11** on the test instance:
      - It needs the churchcore right **"simulate persons"** ("Personen simulieren, Passwort ändern und Zugang
        sperren"). Without it, ChurchTools answers HTTP `200` with `{"status":"fail","data":"Keine ausreichende
        Berechtigung. …"}`, so the wizard must check `status`, not the HTTP status.
      - Without the `CSRF-Token` header: `401 CSRF-Token is invalid`. `browsertabId` isn't needed.
      - **No password rules are applied**: the password `a` was accepted. The wizard generates a long random password
        itself.
      - It invalidates the person's login token at once (`401`); the next `GET /api/persons/{id}/logintoken` as that
        person returns a new, working token. So re-arm works by setting a new password.
      It's a legacy API that ChurchTools may remove; the wizard puts it behind one function, so it can be swapped.
    - **Getting the service user's token without losing the admin's session (open, blocking for 5.1):** a browser holds
      only one ChurchTools session (`ct-extension-info.md`). **Measured 2026-11-11** on the test instance:
      - An admin (with every right) can't read another person's token: `GET /api/persons/{id}/logintoken` answers
        `403 Forbidden to see Login Token for Person[…]`.
      - Simulating the person doesn't help: `POST /api/simulate` works, but `GET` and `DELETE …/logintoken` then answer
        `403 Cannot get login token in simulation`. `DELETE /api/simulate` restores the admin's session.
      - `POST /api/login` as another person in the same cookie jar replaces the admin's session (`whoami` changes from
        the admin to that person). Its answer contains no token, so a login with `credentials: "omit"` gives the
        extension nothing usable.
      - A login in a fresh session followed by `GET /api/persons/{id}/logintoken` as that person works (as in the
        contract test helpers).

      **Decided 2026-11-11:** the backend fetches the token during `POST /v1/setup` from the service user's login name
      and password (spec 4.10, D6).
    - ~~Login name of the service user~~: **measured 2026-11-11, both work.** A person created with only `cmsUserId`
      (username) and one created with only `email` could each log in right after `setPersonPassword`, with that value as
      `username` in `POST /api/login`; `GET /api/persons/{id}/logintoken` in that session returned a working token.
      No confirmation, invitation or other step was needed before the first login. **The wizard uses `cmsUserId`**
      (`ctpassstore-api`, see below): the service user needs no email address, so ChurchTools never mails it, and the
      name says what the person is for.
    - **Creating a person** (measured 2026-11-10, refined 2026-11-11): `POST /api/persons` needs `departmentIds`,
      `campusId`, `statusId` and, on instances that require it, `privacyPolicyAgreementTypeId`,
      `privacyPolicyAgreementWhoId` and `privacyPolicyAgreementDate` (`Y-m-d`). Departments, campuses and statuses come
      from `GET /api/person/masterdata`. **The status (the type of person, e.g. `status.friend`, `status.member`) is
      chosen by the admin in the wizard** (decided 2026-11-12), from that list with the instance's labels; the wizard
      doesn't preselect one. **The privacy values don't:** neither `/api/person/masterdata` nor
      `/api/masterdata/person` lists them. Only the `400` validation answer names the valid IDs
      (`errors[].args.validOptions`, on the test instance types `1, 2, 3, 4` and who `1, 2, 10000`), without their
      meaning. **Decided 2026-11-11:** the wizard fills in only what ChurchTools needs to create the person. No privacy
      concern arises, because the service user isn't a real person. So it first creates the person without the
      privacy fields; if the `400` names them, it retries once with the first value of each `validOptions` and
      today's date. It doesn't ask the admin. `DELETE /api/persons/{id}` removes a person completely (`204`, then `404`), so the wizard can clean up after a
      failed setup.
    - **Name of the service user** (decided 2026-11-11): recognizable as an API account, not a person: first name
      `CtPassStore`, last name `API` (shown as "CtPassStore API"), login name (`cmsUserId`) `ctpassstore-api`, no
      email address. If `ctpassstore-api` is taken, the wizard appends `-2`, `-3`, …
    - ~~Licensing and data protection of the service user~~: checked 2026-11-10, an additional person has no
      licensing or data-protection side effects.

## Phase 5 – Consumers (after the backend API is stable)

These live outside the backend, but the new API is only usable once they're done.

- [ ] **5.1 Extension**
  - The OAuth login flow (`state`/PKCE in `sessionStorage`, `POST /auth/token`, a silent re-login on `token-expired`).
  - **Re-login without losing input.** The backend token stays at 15 minutes (spec 4.4, Q21); the extension makes its
    expiry invisible. No backend change is needed.
    - **Page load:** a normal full-page redirect to `/oauth/authorize`. Nothing can be lost yet.
    - **During a session:** re-login in a popup, so the page and any form stay untouched. After the first consent,
      ChurchTools redirects without a visible step (it ignores `prompt=login`), so the window only flashes briefly.
    - **Callback:** the extension page itself is the redirect URI, so no second URI is registered and the backend's
      `redirectUri` check (spec 4.4) stays as it is. Loaded with `code` and `state` in a window with `window.opener`,
      it passes both to the opener with `postMessage` (target origin = its own origin) and closes itself.
    - **`state` and PKCE verifier** of a popup login live in the opener's memory, because `sessionStorage` isn't shared
      between the opener and the popup. The opener checks `event.origin` against its own origin and `state` against the
      expected value, then sends the code to `POST /v1/auth/token` itself.
    - **Proactive renewal:** the extension knows the expiry from `expiresIn`. Before opening a form and right before
      sending it, it renews the token if fewer than ~2 minutes are left, but only inside a click handler ("Edit",
      "Save"), so popup blockers allow it.
    - **Retry once on `401 token-expired`:** re-login via popup, then resend the same request once with the values
      still in memory. This is safe: an authentication error comes before any side effect and before the
      primary-password check (spec 4.1), so the retry neither counts against the rate limit nor generates a second
      password.
    - **Popup blocked or closed:** show a "renew session" button and keep everything typed in the form.
    - **No hidden iframe:** ChurchTools very likely forbids being framed; not worth relying on.
    - Popup logins count against the per-address limit of `POST /v1/auth/token` (spec 6.3, Q26); its values must leave
      room for them.
  - Handling of Problem Details.
  - **Setup wizard** (ChurchTools side of the setup; the server side is `/v1/setup`, 4.6, spec 4.10, D6):
    - **Groups per access level:** create one group per access level and assign its rights through the API (auth IDs
      looked up per instance, never hard-coded; see `ct-extension-info.md`), then re-check them and warn about groups
      with more rights than intended:
      - **Users:** the extension's `view` permission (the backend checks `ctpassstore.view === true` at login, spec
        4.4), read access to `settings` (password length, `allowCustomPassword`, `backendUrl`), and the login right
        for the OAuth application ("Bei Drittsystem via ChurchTools-Benutzerkonto einloggen", churchcore, per client;
        authId 18 on the test instance; spec 3.3, measured 2026-11-01). **No** access to `encryptionSettings` (only
        the backend encrypts; ct-radius decrypts with the private key) and **no** access to `passwordStore` (all
        entries go through the backend).
      - **Extension admins:** in addition, write access to `settings` and `encryptionSettings`. The wizard states the
        consequence clearly: whoever can write `settings` can put themselves into `adminUsers` and register machine
        clients, so this group effectively has full access to every entry and must be kept very small.
      - **Service user:** read access to the extension's categories and write access to `passwordStore` only, no
        admin rights (spec 4.8; the self-check of 4.2 fails if it has more).

      The backend's admin role still comes from the `adminUsers` list in the settings until Q22 (roles via groups) is
      decided; the wizard says so and doesn't silently mix the two.
    - **Service user:** create the person with a login name, set a long random password with the legacy
      `setPersonPassword` call (needs "simulate persons" and a CSRF token; check `status`, not the HTTP status; 4.6,
      measured 2026-11-11), and add it to the service-user group. The wizard **doesn't** fetch the token and never logs
      in as that person: that would replace the admin's session. It sends login name and password to
      `POST /v1/setup`, and the backend fetches the token. The password isn't shown or stored. **Never** call
      `PUT /persons/{id}/password` for this: it changes the logged-in admin's password (see the open points in 4.6).
    - **OAuth application:** create it (`POST /api/oauthclients`) and grant the users' group the login right.
    - **Order:** ask for the backend URL and run the pre-check (`GET /v1/setup`) **before** creating anything in
      ChurchTools. A host that doesn't work, or `409`, stops the wizard with a clear message, and nothing is left
      half-created. Name the browser-side failures, never just "network error": no valid HTTPS (certificate), a URL
      that doesn't answer as CtPassStore (web root or `.htaccess` ignored), `500 misconfigured` (a broken
      `credentials.php` exists).
    - **Configure the backend:** after the ChurchTools side, send `POST /v1/setup` with the service user's login name
      and password and the OAuth client ID and secret. They stay only in memory and are never shown. On `422` or a
      network error, offer "retry" with the same values; if the tab was closed in between, delete the OAuth client
      (by `identifier`), create a new one and set a new password for the service user.
    - **Binding check** (spec D6): compare `instanceUrl` and `oauthClientId` of the `201` with the wizard's own values,
      then log in once through OAuth against the backend. `409`, values that don't match or a failed login give a red
      warning: "someone else configured this backend; delete `config/credentials.php` over FTP and repeat".
    - Only then save `backendUrl` in the settings.
    - **Re-arm** is the same flow after the admin deleted `credentials.php`: the existing service user gets a new
      password (which invalidates its old token), and the backend fetches the new token.
  - An admin UI for machine clients.
  - Stop fetching `/persons/{id}/logintoken`.
  - Align the settings with the backend's validation: `passwordLength` 12–64 in the JSON schema (`AppConfig.ts`)
    and in the settings form (today: minimum 8, no maximum).
- [ ] **5.2 ct-radius** (see the ct-radius section in [`TODO.md`](../TODO.md))
  - Ed25519 key generation and token signing, and the problem `type` check for `404`.
  - A timeout on the backend call, the backend URL, updated tests.

## Deliberately not in step 1

- Cleanup job for deleted persons (Q16).
- Roles via ChurchTools groups (Q22).
- Person and group lookups for ct-radius (step 2).
- APCu cache.
