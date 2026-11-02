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
    repositories, crypto, clock), `Http` (controllers, middleware, problems, request parsing). `Application.php` is the
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

## Phase 4 – Operations and release

Decided: Q11, Q14, Q17, Q18 (spec section 7).

- [ ] **4.1 Cache** (spec 6.1)
  - A file cache outside the web root for settings, the public key, the module and category IDs, and the `jti` replay
    cache. No APCu (Q3, kept lean).
- [ ] **4.2 Extend `/test`** (spec 4.8)
  - File permissions, the OAuth and JWT configuration, the service user's rights (warn on admin rights), valid machine
    clients, the version.
- [ ] **4.3 Hardening**
  - Security headers, the CORS method list, the HTTPS check (Q17).
  - Configurable log level and rotation, no secrets in logs (spec 6.4).
- [ ] **4.4 Deployment**
  - `setup.sh` sets permissions and runs a check of the deploy folder (no `credentials.php`, no dev files, no instance
    URL).
  - Update `backend/docs/setup.md`: permissions for both hosting cases, OAuth setup, rotating secrets.
- [ ] **4.5 Release**
  - The version string `x.y.z[+sha[-dirty]]` (spec 6.5).
  - A `CHANGELOG.md` and a release workflow on tags with a release check.
  - Updated API docs in `backend/README.md`. First release of the new API.

## Phase 5 – Consumers (after the backend API is stable)

These live outside the backend, but the new API is only usable once they're done.

- [ ] **5.1 Extension**
  - The OAuth login flow (`state`/PKCE in `sessionStorage`, `POST /auth/token`, a silent re-login on `token-expired`).
  - Handling of Problem Details.
  - Setup wizard: create the OAuth application, show the secret once, and grant users the login right.
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
