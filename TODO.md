# 📝 CtPassStore TODOs

Open issues and planned improvements, roughly ordered by severity.

## Bugs & Robustness

- [ ] **Race condition creates duplicate password entries**
  [`ChurchToolsStore.php`](backend/src/Service/ChurchToolsStore.php) does read-all → filter → create without any locking. Two concurrent PUTs for the same person (e.g. a double-click) can create two entries. After that, `getPwd()` returns `null` (it requires exactly one match) and `putPwd()` throws on every call, so the user is locked out until the data is cleaned up by hand.
  - Make PUT tolerate existing duplicates (keep the newest entry, delete the rest).
  - Unify the ID comparison: `getPwd()` uses `==`, while `putPwd()`/`deletePwd()` use `===`. An entry stored with a string `personId` is found by one and missed by the other.
  - Add a test for this scenario.

- [ ] **Missing error middleware**
  When ChurchTools is unreachable or the settings are malformed, callers get Slim's default HTML 500 page instead of a JSON error response.

- [ ] **Extension & backend: be ready for required CSRF tokens**
  ChurchTools currently accepts REST write requests without a CSRF token, but the JS client gained opt-in support for them (`setLoadCSRFForAPI()`, client 1.7.1) and the instance configuration has a `csrf_enabled` flag. If ChurchTools starts requiring them, our KV writes would fail.
  - Extension: check the installed `@churchtools/churchtools-client` version and test writes with `setLoadCSRFForAPI()` enabled.
  - Backend: decide whether our own ChurchTools client (D1 in [`specs/backend-spec.md`](specs/backend-spec.md)) needs to fetch `GET /api/csrftoken` for writes.

## Performance

- [ ] **Every request loads every user's password entry**
  `getPwd()` and `putPwd()` fetch the whole `passwordStore` category and filter it in PHP. That works for small installations, but frequent lookups (e.g. RADIUS) with a few hundred users will be slow.
  - Consider one entry per person keyed by person ID, so a lookup no longer loads everything.

- [ ] **Timing issues caused by the many backend calls to ChurchTools**
  A single request makes about 5–7 round trips to ChurchTools (whoami, permissions, module ID, categories, settings, data), none of them cached. This causes noticeable latency and can run into timeouts.
  - Cache the settings, the public key and the module/category IDs for a short time (per request and across requests).
  - Reduce or parallelize the remaining calls where possible.

## Security

- [ ] **Harden the primary-password check**
  [`ChurchtoolsAuthVerifier.php`](backend/src/Service/ChurchtoolsAuthVerifier.php) checks the primary password by calling the real `POST /api/login`.
  - Every check opens a new ChurchTools session.
  - The backend has no rate limiting, so it can be used to guess primary passwords. It's unverified whether ChurchTools' own login lockout would then block the backend's IP for all users.
  - The behaviour for users with 2FA enabled is untested.

- [ ] **Switch backend authentication from login tokens to JWTs**
  Right now clients send their ChurchTools login token (`Authorization: Login <token>`) to the backend, which uses it to call ChurchTools. So the backend sees long-lived credentials with full access to the user's ChurchTools account. If the backend is compromised, those tokens are exposed too.
  - **Decided (D4 in [`specs/backend-spec.md`](specs/backend-spec.md)):** users log in via ChurchTools OAuth (authorization code with PKCE, `scope=api`). The backend exchanges the code, checks identity and the `view` permission once, and issues its own short-lived JWT. Verified on the test instance on 2026-11-01.
  - Backend: implement `POST /auth/token` and bearer-token validation (spec 4.3, 4.4); add `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET` and `JWT_SECRET` to `credentials.php`.
  - Extension: start the OAuth flow, keep `state`/PKCE in `sessionStorage`, call `POST /auth/token`, and log in again silently on `401 token-expired`. Stop fetching `/persons/{id}/logintoken`.
  - Setup wizard: create the OAuth application (`POST /api/oauthclients`), show its secret once for `credentials.php`, and grant users the right "Bei Drittsystem via ChurchTools-Benutzerkonto einloggen" for it.
  - Machine clients (ct-radius): authentication still open (spec Q19).
  - Update the API docs in [`backend/README.md`](backend/README.md) and the E2E tests to match.

- [ ] **Backend: warn when the service user has too many rights**
  On the test instance, the service token in `credentials.php` belongs to an admin (person 1) with `administer settings`, `administer persons` and `administer custom modules`. The backend only needs read access to its categories and write access to `passwordStore`. If its token leaks, an attacker gets full admin access.
  - Extend the `/test` self-check: fail if the service user has administrative rights or write access beyond `passwordStore` (see section 4.7 of [`specs/backend-spec.md`](specs/backend-spec.md)).
  - Use a dedicated, minimal service user on the test instance as well.

- [ ] **Permission setup is not verified**
  The security model relies on the admin assigning rights exactly as described in the setup wizard. In particular, normal users must not be able to write to `passwordStore`. Nothing checks this afterwards.
  - Add a permission self-check to the setup wizard and/or the `/test` endpoint.
  - Better: assign the permissions ourselves. ChurchTools now lets us create groups and set role permissions through the API, so the setup wizard can provision the groups and rights automatically instead of relying on the admin to do it by hand. It should then re-check them and warn if a group has more rights than intended.

- [ ] **Extension: keep the test instance URL out of the release build**
  [`extension/src/main.ts`](extension/src/main.ts) uses `window.settings?.base_url ?? import.meta.env.VITE_BASE_URL` (a pattern taken from the boilerplate). Vite inlines the `VITE_` value, so the URL of the development instance ends up in `dist/` and in the release ZIP. The dev password isn't in the bundle, but only because the code that reads it is removed as dead code.
  - Use the fallback only in development (`import.meta.env.DEV`), or replace it with a dev proxy that holds URL and credentials in non-`VITE_` variables.
  - Add a post-build check (like `check-dist.js` in the infoscreen project) that fails when `*.church.tools` or the dev username appears in `dist/`.
  - Rebuild the existing release ZIP, and replace it wherever it was published.

- [ ] **Keep local credential files private**
  The ignored files with credentials are readable by other users on the development machine (mode `664`):
  - `backend/config/credentials.php`
  - `backend/phpunit.xml`
  - `extension/.env`
  - the end-to-end fixtures with test users' passwords in `backend/tests/EndToEnd/fixtures/`

  Set them to `600`, and mention that in the testing docs.

- [ ] **Backend: set and check file permissions on the server**
  Local permissions don't survive deployment. FTP/SFTP uploads get the server's defaults (usually `644`/`755`), and [`backend/setup/setup.sh`](backend/setup/setup.sh) copies files without setting any permissions. The right values depend on which user PHP runs as:
  - **PHP runs as the hosting user** (PHP-FPM, suPHP; most shared hosts): `credentials.php` → `600`.
  - **PHP runs as the web server user** (e.g. `www-data` with `mod_php`): `600` owned by the hosting user would make the file unreadable for PHP and break the backend. Use e.g. `640` with the web server's group instead.

  To do:
  - Document the target permissions for both cases in [`backend/docs/setup.md`](backend/docs/setup.md):
    - `config/credentials.php` not readable by others
    - `logs/` writable by PHP but not readable by others
    - code and directories not writable by the web server where possible
  - Let `setup.sh` set sensible defaults in the deploy folder, and remind the admin to check them again after uploading.
  - Fix the `/test` self-check. It currently requires `0600` or stricter, which can never pass on hosts of the second kind. It should instead check that `credentials.php` is readable by PHP but not by others, and that `logs/` is writable.
  - Update section 4.7 of [`specs/backend-spec.md`](specs/backend-spec.md) accordingly.

- [ ] **No key-rotation story**
  Stored passwords can't be re-encrypted under a new key, because nobody holds the plaintext. Rotating the key (or recovering from a leaked private key) means every user has to reset their password.
  - Document the procedure and support it in the UI (e.g. a "key rotated, please reset your password" state).

## Data Management

- [ ] **Clean up entries of deleted users**
  Nothing removes password entries (or `adminUsers`/`readAccessUsers` references) for people who no longer exist in ChurchTools.
  - Add a cron job or similar scheduled task that finds these orphaned IDs and deletes them.

- [ ] **Backup & restore of the extension data**
  Updating the extension in ChurchTools deletes all of its data: settings, encryption settings and every stored password.
  - Add a feature to export the whole extension data (all categories and their entries) to a backup file.
  - Add a matching import so the data can be restored after an update.

## Testing & Tooling

- [ ] **Add unit tests**
  Right now there are only end-to-end tests, and they need a live ChurchTools instance.
  - Add PHPUnit unit tests for `PasswordValidator`, `EncryptionService` (encrypt/decrypt round trip with the test keys) and the store logic against a mocked client.
  - Add frontend tests.

- [ ] **Set up CI and static analysis**
  - Add a GitHub Actions workflow that runs the unit tests, PHPStan and `vue-tsc`.
  - Add linting (e.g. ESLint).
  - Start tagging releases.

## Dependencies & Shared Code

- [ ] **Fix shared code upstream, not in the subtree copies**
  [`extension/src/ct-utils/`](extension/src/ct-utils/) and [`extension/src/ct-extension-utils/`](extension/src/ct-extension-utils/) are squashed git subtrees of `lub90/ct-utils` and `lub90/ct-extension-utils`. So far, every change has come in through `git subtree pull --squash`, and the copies haven't drifted from upstream.
  - Make fixes to shared code (e.g. the KV helpers in `ExtensionData.ts`, `Permissions.ts`, the ChurchTools types) in the upstream repos, then pull them in. Editing the copies here makes them diverge, and the next pull will conflict.
  - Bugs in code that belongs only to ct-pass-store (e.g. the race condition in `ChurchToolsStore.php`) are fixed here as usual.

- [ ] **Bring the shared libraries out of prototype state**
  Both subtree READMEs contain only TODOs.
  - Write real READMEs and add `.gitignore` files.
  - Rewrite `ExtensionData` in ct-utils to follow the boilerplate's [`kv-store.ts`](https://github.com/churchtools/extension-boilerplate/blob/main/src/utils/kv-store.ts), as already noted in its README.

- [ ] **Consider publishing the shared libraries as packages**
  Subtrees work for a single developer. If other extensions will reuse `ct-utils` and `ct-extension-utils`, publish them as versioned npm packages (private or GitHub-hosted is fine) instead of copying them in.

- [ ] **Replace `churchtools/php-client` with our own thin ChurchTools client**
  [`backend/composer.json`](backend/composer.json) requires `churchtools/php-client` from the fork `lub90/ct-php-client` as `dev-version/3.126.2`, which is a branch. The library is 59 MB and about 3,800 files, but the backend uses only `SimpleClient`, `GeneralApi::getWhoami()`, `Configuration`, `ApiException` and one model.
  - Decided in [`specs/backend-spec.md`](specs/backend-spec.md) (D1); the client's behavior is specified in section 5.6.
  - Write a small client on top of Guzzle behind an interface: `whoami`, global permissions, login check and the KV store calls. It gets central timeouts, `429` handling and one exception type per error case.
  - Do this before writing the unit tests for authentication and the store.
  - Afterwards, remove the library and the fork repository from `composer.json`.

## Code Cleanup

- [ ] Controllers extend `BaseService`. `PasswordController` has an unused `json()` method and unused imports.
- [ ] `PasswordValidator::generateRandom()` shuffles with `str_shuffle`, which isn't cryptographically secure. The characters themselves come from `random_int`, so this is minor, but a CSPRNG-based shuffle would be better.
- [ ] The class name is spelled two ways: `ChurchtoolsAuthVerifier` and `ChurchToolsAuthVerifier`.
- [ ] Translate the remaining German code comments to English.
- [ ] Extension `package.json`: remove the unused `angular-route` dependency and move the Vite plugins to `devDependencies`.
- [ ] Reconsider committing the generated 33k-line [`ct-types.d.ts`](extension/src/utils/ct-types.d.ts).

## Documentation

- [ ] Add a README for contributors that explains the architecture, the reasoning behind it and how to run the tests.
- [ ] Document the procedures for key rotation and for offboarding users.

## ct-radius (after the backend changes)

These items belong to the separate repository [lub90/ct-radius](https://github.com/lub90/ct-radius). Most of them have to be done once the backend's API changes (new error format, status codes, authentication) are in place. Paths are relative to that repository.

- [ ] **Adapt to the new backend API**
  The only backend call is in `typescript/src/core/modules/ct-groups/CtPasswordService.ts` (`getEncryptedPwd`).
  - Today every `404` counts as "user has no password", so a wrong backend URL or route silently rejects every login. With the new error format, check the problem `type` and treat everything except "no entry" as an error.
  - Log `title`/`detail` of problem responses instead of the raw body.
  - Switch to the new authentication scheme. The header is built in one place (line ~56), but the token is currently the same `CT_API_TOKEN` that's used for ChurchTools itself. Separate the two.
  - ct-radius starts a new Node process for every RADIUS request, so in-memory caches don't survive. If the new scheme uses short-lived tokens, persist them (e.g. in the existing SQLite cache) instead of fetching a new one per login.
  - Update the tests that assert the exact request and the `404` handling (`tests/core/modules/ct-groups/CtPasswordService.test.ts`).

- [ ] **Decide where the backend URL comes from**
  Today ct-radius reads `backendUrl` from the ct-pass-store extension's `settings` category in ChurchTools. That costs 3 ChurchTools calls per login and couples both projects to the KV layout. Alternative: configure the URL locally in ct-radius.
  - If it stays in the KV store: a missing `backendUrl` currently crashes with a `TypeError` (`CtGroupsModule.ts`, `getPasswordServerUrl`). Validate it and fail with a clear message.
  - Document that the ct-radius account needs "view custom data" on the ct-pass-store `settings` category.

- [ ] **Robustness of the backend call**
  - Add a timeout to the `fetch` call (e.g. `AbortSignal.timeout`). Today there's none; only FreeRADIUS' exec timeout applies.
  - The base64 check before decryption is ineffective (`Buffer.from` never throws). Validate the format properly.
  - Check whether a "no password" result should fall through to the next module (e.g. ct-guests) instead of rejecting immediately.

- [ ] **Keep the password character set in sync with the backend**
  ct-radius rejects passwords with characters outside `[A-Za-z0-9!@$%&*-_+=?.]` (`typescript/src/types/isAllowedString.ts`). The backend's password policy must use the same set. Treat it as a shared contract and document it in both projects.

- [ ] **Guest passwords are stored in cleartext**
  The ct-guests module stores guest passwords in cleartext in the `ctradius` extension's KV category `guests` and in its SQLite cache. That contradicts the README, which says passwords are never stored. Decide whether to encrypt them like ct-pass-store does, or document the risk.

- [ ] **Bring ct-radius out of prototype state**
  - Add CI (lint, typecheck, tests) and an ESLint config. There's none today.
  - Add tests for `getPasswordServerUrl` and `ExtensionData`.
  - The `ct-utils` / `ct-extension-utils` copies are duplicated (in `typescript/` and `extension/`) and nearly identical to ct-pass-store's subtree. Use the shared upstream (subtree or package) instead.
  - Replace `any` in `ExtensionData`.
  - Fix the package metadata (`"name": "typescript"`, version `1.0.0`).
  - Update the outdated README (guests are still listed as "planned").
  - Remove the leftover LLM prompt file `commands`.
