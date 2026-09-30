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
  - Authenticate with JWTs instead, so the backend never sees users' login tokens.
  - Update the extension, the API docs in [`backend/README.md`](backend/README.md) and the E2E tests to match.

- [ ] **Permission setup is not verified**
  The security model relies on the admin assigning rights exactly as described in the setup wizard. In particular, normal users must not be able to write to `passwordStore`. Nothing checks this afterwards.
  - Add a permission self-check to the setup wizard and/or the `/test` endpoint.
  - Better: assign the permissions ourselves. ChurchTools now lets us create groups and set role permissions through the API, so the setup wizard can provision the groups and rights automatically instead of relying on the admin to do it by hand. It should then re-check them and warn if a group has more rights than intended.

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
