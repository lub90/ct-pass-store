# Developing the CtPassStore extension

`npm run dev` starts the Vite development server at `http://localhost:5173/ccm/ctpassstore/`. It runs in one of two
modes. The choice is made in `src/main.ts` with the literal condition
`import.meta.env.DEV && import.meta.env.MODE !== 'real'`. A production build replaces it with `false` and drops
everything under `src/dev/`.

Node.js 23.6 or newer is needed (`engines` in `package.json`): `scripts/check-dist.js` imports
`src/dev/demo-data.ts` directly, which relies on Node's built-in TypeScript type stripping.

## Demo mode (default)

```sh
npm run dev
```

The app runs against an in-memory ChurchTools (`src/dev/fake-churchtools.ts`) and an in-memory backend
(`src/dev/fake-backend.ts`). Both are filled with the invented data of `src/dev/demo-data.ts`: made-up people, groups
and a backend address under the reserved `.invalid` domain. No request leaves the browser, and nothing is written to a
real instance.

- **Switch:** a small yellow box at the bottom right selects the scenario: user (Bruno), admin (Ada), setup missing,
  no access, ChurchTools error, versions don't match. Changing it reloads the page.
- **ChurchTools password:** the demo backend asks for `demo-passwort` before a password is changed or deleted (if the
  settings require it). The switch shows it too.
- **State:** the scenario, the stored settings and access values, and the stored passwords are kept in the browser's
  `localStorage` under `cps-demo-state`, so a reload keeps them. **Zurücksetzen** in the switch deletes the state and
  starts again from the invented data. Only demo mode uses `localStorage`; the production app never reads it.
- **Login:** the demo starts logged in to the demo backend. There is no OAuth round trip, so a renewal popup is
  reported as blocked.

## Real mode

```sh
npm run dev -- --mode real
```

Real mode covers **the ChurchTools side only**: KV values (settings, access), persons, groups and rights of a real
instance, through a Vite proxy for `/api`. It does **not** cover the backend:

- The dev server's origin (`http://localhost:5173`) serves no `/oauth/authorize`, and the backend wouldn't accept its
  redirect address. `/oauth` is deliberately not proxied: with the login token attached, ChurchTools would authorize
  as the token's user without asking.
- So the app refuses the backend login on the dev server: once the settings are set up, it shows „Die Anmeldung hat
  nicht geklappt“ (backend error) instead of leaving for a 404. Pages before the login (setup missing, migration, no
  access, the rights) work.
- Backend flows (login, password entries, self-test) are tested in the build hosted on the test instance and in the
  contract (`npm run test:contract`) and browser checks.

1. Create `.env` with mode `600` before putting anything into it, so it is never readable by other users:

   ```sh
   install -m 600 .env-example .env
   ```

   `.env` and every `.env.*` file (e.g. `.env.real`) are ignored by git; `.env-example` holds no values.

   (This replaces an existing `.env`; if you already have one, fix its mode with `chmod 600 .env` instead. An old
   `.env` with `VITE_BASE_URL`, `VITE_USERNAME` and `VITE_PASSWORD` must be migrated: put the address into
   `CT_BASE_URL`, a login token into `CT_LOGIN_TOKEN`, and delete the old `VITE_*` lines, above all the password.) Then fill
   in `CT_BASE_URL` (`https://<instance>.church.tools`) and `CT_LOGIN_TOKEN` (a ChurchTools login token of a
   test account). Check the mode with `ls -l .env` (`-rw-------`).
2. `vite.config.ts` reads the two variables (only when the dev server starts in mode `real`; never for a build or
   `vite preview`) and forwards `/api` to the instance. The token is added per request, so the browser never sees it.
   The server refuses to start if `CT_BASE_URL` isn't an `https://` address without credentials or if
   `CT_LOGIN_TOKEN` is empty.
3. The proxy acts with the token's rights, so it serves only the dev server's own page. It answers 404, and forwards
   nothing, when `Sec-Fetch-Site` is sent and isn't `same-origin`, when `Origin` is sent and isn't the dev server, or
   when the `Host` isn't `localhost`, `127.0.0.1` or `[::1]`. Without that check, any page you visit could send a
   simple cross-site request to `localhost:5173/api` and act as the token's user. The browser's `Cookie` and `Origin`
   headers are dropped before forwarding.

> **Accepted risk: use real mode only on a single-user machine.** While real mode runs, any other process or account
> on the same machine can send requests to `localhost:5173/api` (with a `Host` of `localhost` and no `Origin`) and act
> with the token's rights; the proxy's checks only keep out web pages in a browser. Don't run it on a shared machine,
> stop it when you don't need it, and use a test account's token.

> **Warning:** never expose the real-mode dev server to the network. `--host`, `0.0.0.0` or a LAN address would let
> anyone who can reach your machine use the token through the proxy; the dev server refuses to start in mode `real`
> on a host other than `localhost`, `127.0.0.1` or `::1`.

Notes:

- **No `VITE_` prefix.** Vite inlines `import.meta.env.VITE_*` into the bundle. The CT variables have no prefix and are
  read only by `vite.config.ts`. The app's `envPrefix` is `CPS_PUBLIC_`, so even an old `.env` with `VITE_*` keys can't
  reach a build.
- **The login token is effectively a permanent password.** It stays valid until the account's password is changed;
  use a test account and never commit, paste or log it.
- **Backend address:** the backend client accepts `https://` only, in every mode; there is no switch for a local
  `http://` backend.
- **Other credential files** (backend `phpunit.xml`, `credentials.php`, recorded contract fixtures) are created with
  mode `600` too, e.g. `install -m 600 /dev/null <file>` before writing into it.

## Builds and the demo

`npm run build` builds in mode `production` only: `vite.config.ts` refuses a build in another mode or with `NODE_ENV`
other than production (only `scripts/build.test.ts` passes it, with `CPS_ALLOW_NON_PRODUCTION_BUILD=1`, to build the
app in production, development and real mode and check that only the development build contains the demo).

After the build it runs `scripts/check-dist.js`. Among other checks it fails if the build contains the demo marker
`__DEMO__` (every module under `src/dev/` puts it into its code) or any of the demo data strings (`DEMO_STRINGS` in
`src/dev/demo-data.ts`). It also reads the local `.env` and `.env.*` files and fails if the value of any `CT_*`
variable (or of an old `VITE_PASSWORD` or `VITE_BASE_URL`) of 8 or more characters appears in `dist/`; it names the
variable and the file, never the value. CI has no `.env`, so this is a local safety net; CI scans the repository with
gitleaks instead.

## Contract tests

`npm run test:contract` runs the shared contract cases (`src/ct/contract-cases.ts`, `src/backend/contract-cases.ts`)
against a real ChurchTools **test** instance and the real backend of this repository, so the fakes the unit and app
tests use stay honest (spec 13.2). Run it by hand before a release, never against a production instance: it creates
and deletes temporary objects there.

### What it needs

The same source as the backend's contract tests (`backend/docs/testing.md`); no password is ever an environment
variable and no new credential file is created:

| What | Where it comes from |
| --- | --- |
| `CT_API_URL` | `https://<instance>/api`, the value in the backend's local `phpunit.xml` |
| `CT_API_TOKEN` | the login token of the service user, the value in the backend's local `phpunit.xml` |
| `admin_users.json`, `normal_users.json`, `person_status.json` | the backend's gitignored fixtures in `backend/tests/Contract/fixtures/` (another folder with `CT_FIXTURES_DIR`) |
| `backend/vendor` and the `php` command | `composer install` in `backend/`; PHP 8.3 CLI |

Pass the two variables only into the test process, e.g. `CT_API_URL=… CT_API_TOKEN=… npm run test:contract` from a
script that reads them from `phpunit.xml` without printing them; never put them into `.env`, a shell history or a
file. Without any of the above, `tests/contract/setup.ts` aborts the run before the first test with a message naming
**everything** that is missing; the suite is never reported as passed without them.

### What it does on the test instance

- **ChurchTools** (`tests/contract/ct.contract.test.ts`): the app's real `CtApi` as the service user
  (`Authorization: Login`, no cookies, as the real-mode dev proxy sends it), the normal test user's session for the
  "no category rights" cases, and an anonymous client. Two temporary groups named „ctpassstore extension contract
  test“ (a team with the service user, the normal test user, a `waiting` member and an archived person; a
  distribution list without the service user). Probe values in `passwordStore`, deleted right away.
- **Backend** (`tests/contract/backend.contract.test.ts`): the backend runs locally on PHP's built-in server
  (`tests/contract/backend-sandbox.ts`, 127.0.0.1, a free port, a fresh cache and log folder per sandbox, deleted
  after); four sandboxes run side by side, one per settings variant and role.
  Its configuration (`tests/contract/sandbox/credentials.php`) holds no values; everything comes from the PHP
  process's environment, with a random `JWT_SECRET` per run. The deployed backend of the test instance is not used.
  - A temporary confidential OAuth client with the redirect URI `https://<instance>/ccm/ctpassstore/auth/callback`;
    its secret stays in memory. The normal test user gets „login to external system“ for this client only (`PUT`
    adds it; `DELETE` with the same body removes exactly it; afterwards all of the user's own grants are compared
    with the start).
  - **Settings variants:** every backend case runs in two variants, "primary password not required, custom
    passwords allowed" and "primary password required, custom passwords off", whatever the instance's settings are.
    The instance's settings are never written: the sandbox's router (`tests/contract/sandbox/router.php`, test code
    only, nothing in `backend/src` or `backend/public`) wires the backend as `Kernel::bootstrap()` does, but wraps its
    ChurchTools client in `tests/contract/sandbox/SandboxChurchTools.php`. That wrapper replaces exactly
    `requirePasswordForPasswordChange` and `allowCustomPassword` (from `CPS_SANDBOX_SETTINGS`, booleans only) in the
    settings value as the backend reads it; every other setting, the persons, groups, rights and entries come from
    the instance. It refuses any write to the settings (or access) it overrides, and a malformed override keeps the
    sandbox from starting. Its own checks are `tests/contract/sandbox-overrides.test.ts` (a fake inner client, no
    network; in this suite because it needs PHP and `backend/vendor`).
  - "user" and "admin" are both the normal test user, logged in through the real OAuth flow and
    `POST /v1/auth/token`. The "user" sandbox reads `access` from the instance, which has none, so nobody is an
    admin. The "admin" sandbox's backend sees an `access` value (`CPS_SANDBOX_ADMIN_GROUP_ID`) naming a group the
    normal test user is already an active member of as the admin group; the membership is read with the user's own
    token as in production, and no group is created or changed for it. So the login's `admin: true` is checked for
    real. (Only the wire check "an admin gets person-not-found for an archived person too" still uses a token signed
    with the sandbox's per-run secret.)
  - **Rate limits:** ChurchTools limits `POST /login`, and with a required primary password every backend write is
    one (the backend checks the password that way). The run reuses one session of the normal test user for all
    authorization codes; a `429` on a fixture login is waited out (`Retry-After`, at most 90 s, twice at most), and
    so is an `upstream-rate-limited` answer of the backend to an entry or self-test call (the same call sent again,
    twice at most; the answer the case sees is otherwise unchanged). The run says how often it waited. It takes
    about three minutes.
  - Entries are written only for persons that have none; the run refuses to start otherwise.
- **HTTPS:** the extension's backend client accepts `https://` only, and `src/` has no switch for plain HTTP. So the
  tests give the client an address like `https://open-user.backend.contract.invalid` (one per sandbox) and replace
  `fetch` (`vi.stubGlobal`, test code only) with one that sends those requests to the matching sandbox. The sandbox's router sets `HTTPS=on`, as a TLS
  terminator does in production, so the backend's own HTTPS check passes.
- **Cleanup:** every temporary object is removed in `afterAll`, also after a failure; each step runs even if an earlier
  one fails, and a failed step fails the run with „check the test instance by hand“.
- **After a crash** (the test process killed, the machine off), the next run recovers what it can:
  - OAuth clients named „ctpassstore extension contract test“ are deleted, each after removing the normal test user's
    „login to external system“ right for it (the only right the run grants).
  - Groups of that name are deleted.
  - Sandbox folders (`$TMPDIR/cps-backend-sandbox-*`) are deleted. The PHP server is killed when the test process exits
    or gets `SIGINT`/`SIGTERM`; after a `SIGKILL` of the test process it keeps running until you stop it
    (`pkill -f 'php -S 127.0.0.1'`).
  - **Not recovered:** a password entry the backend cases left for one of the touched persons (the normal test user
    and the active, archived and deleted fixture persons). The next run fails closed: it refuses to start and names
    those persons. Delete the entry by hand (as an admin in the extension, or the value in `passwordStore`).
  - A probe value in `passwordStore` without `personId` (from the ChurchTools cases) is not found automatically either;
    it is harmless to the backend but should be deleted by hand.
- **One contract run per instance at a time.** The runs (this suite and the backend's PHP contract suite) grant and
  remove the same right and look for leftovers by name; two runs at once would undo each other's objects. There is no
  lock.
- **Skipped cases**, by design, listed as skipped by Vitest:
  - Backend: each subject skips the cases of the other variant or role (custom-password cases in the "custom off"
    variant, `custom-password-not-allowed` and the primary-password cases in the "open" variant, admin cases for
    "user", the non-admin case for "admin"). Every backend case runs for at least one subject: 11, 12, 12 and 13
    cases run for open/user, open/admin, strict/user and strict/admin.
  - ChurchTools: the read-only-rights case (no test user may read the categories without also writing them); it runs
    against the fake only.

### Recorded responses

With `CT_CONTRACT_RECORD=1` a few raw answers are written to `tests/contract/fixtures/` (gitignored, mode `600`), only
through `scripts/sanitize-fixture.js`: secrets under keys like `token`, `secret`, `pwd`, `code` are blanked; names,
initials and contact data replaced; the instance host becomes `ct.example`; tokens, hashes and ciphertexts in any
string become `<jwt>` / `<hash>`. To sanitize a file by hand: `CT_API_URL=… node scripts/sanitize-fixture.js in.json
out.json`.

## Browser tests

`npm run test:browser` runs Playwright (`playwright.config.ts`, specs in `e2e/`) against the **demo mode** of
`npm run dev`: Playwright starts the dev server itself on a free port of `127.0.0.1` (`CPS_E2E_PORT` picks one by
hand) and stops it afterwards. Only the invented demo data is used; the tests never start `--mode real` and never
touch the test instance or `.env`. Each run keeps its traces in its own folder `test-results/run-<time>-<pid>/`
(`CPS_E2E_RUN` names it by hand, `--output` replaces it), so parallel runs in one worktree don't delete each other's
files; old run folders can be deleted at any time.

Once per machine:

```sh
npx playwright install chromium webkit
```

WebKit also needs system libraries (on Ubuntu 24.04 among others `libavif16`, which pulls in `libgav1-1` and
`libyuv0`); install them with `sudo npx playwright install-deps webkit`. Without them only Chromium runs:
`npm run test:browser -- --project='chromium-*'`.

Four projects: Chromium and WebKit, each at 1280 px (`*-desktop`) and at 375 px with touch (`*-phone`, so
`(pointer: coarse)` applies). Chromium runs the full browser in its new headless mode with the popup blocker switched
on (Playwright turns it off by default), so a popup outside a click is blocked as in a normal browser.

| Spec | What it shows |
| --- | --- |
| `password.spec.ts` | Generate, copy (clipboard read back in Chromium; in WebKit the „Kopiert“ feedback), „Fertig“ drops the plaintext; a chosen password; arrow keys in the ChoiceCard group; the custom form's `autocomplete` attributes and no username-like field |
| `admin.spec.ts` | An admin sets someone else's password: banner, confirm dialog naming the person with the „ID n“ line; focus trap, Escape, focus back on the opener; the dialog above a stand-in top bar (z-index 1040); one `main` landmark |
| `controls.spec.ts` | Toggle: Space and Enter, a click on its text flips it once and focuses the switch (fixme in WebKit, see item 6 below), a tap |
| `layout.spec.ts` | Every route of spec 4.1 and the main form states: no horizontal scrolling, every button, input and standalone link at least 44 px high with touch (Toggle and ChoiceCard through their label), 16 px input text and full-width form buttons at 375 px |
| `renewal.spec.ts` | The session renewal popup (spec 7.2) from a click, and from the confirm dialog's click when the request after it answers `token-expired`; a control shows the same renewal without a click is blocked. The popup tests are fixme in WebKit until a first run. Also, in the demo app, a token one minute before its end: the submit click renews first and keeps everything typed |
| `docs-screenshots.spec.ts` | The user-guide pictures in `docs/images/` (Chromium only, `*-desktop.png` and `*-phone.png`); only with `npm run docs:screenshots`, skipped otherwise |

**Not part of `npm run check`.** The browser tests need the Playwright browsers (and WebKit its system libraries),
start a dev server and take about a minute; `check` stays fast and runs anywhere. Run them by hand before a release
and after UI changes (spec 13.1). `e2e/` is type-checked and linted by `check`, and it never reaches the build (Vite
builds from `index.html` only; `check-dist` would fail on demo code).

**Touch targets of links.** A link that stands alone (alone in its paragraph, list item or footer: the back link
„‹ Einstellungen“, „Über“, the links on „Über“) is a target of its own and gets the class `cps-link`, which makes it
44 px high on a coarse pointer (`theme.css`). A link inside running text (the block around it has text of its own,
e.g. „In ChurchTools öffnen ↗“ after the members hint, or a link at the end of a banner sentence) keeps the line
height: WCAG 2.5.8 exempts inline targets. `layout.spec.ts` applies the same rule when it measures.

**Screenshots** are made only on request: `npm run docs:screenshots` (it sets `CPS_SCREENSHOTS=1`); a normal
`npm run test:browser` skips them and never rewrites `docs/images/`. They aim to be deterministic: a fixed scenario per picture, a fresh demo state, the demo switch hidden, no
caret or focus ring, and a fixed example (`Beispiel-Pw-42!x`) in place of the random password. Fonts come from the
machine (Lato only on the instance), so pictures made on another machine can differ in the font; commit them from one
machine. Small sub-pixel differences between two runs on the same machine (anti-aliasing) are expected; commit new
pictures only when the page itself changed.

**Session renewal in the demo:** the demo has no OAuth, so its popup is always reported as blocked. The renewal tests
therefore build a real `Auth` and `Session` from the app's modules on the demo page (Vite serves them under
`/ccm/ctpassstore/src/`), answer `/oauth/authorize` with a redirect to the callback route, and let the real callback
page post the code back to its opener. Playwright marks its own injected calls (`page.evaluate`, the checks around a
click) as user gestures, so the tests can't separate the click's activation from Playwright's: they show that the
renewal runs within the click's activation window, not that the click alone provides it. The control test starts the
same renewal from a timer after more than Chromium's 5 s activation lifetime, with no Playwright call meanwhile, and
it is blocked.

### Manual checks on the test instance

What the demo can't show. Each needs the build installed on the test instance (an upload replaces the extension there;
ask the maintainer first) and a test account; never a production instance.

1. **Dialog above the ChurchTools top bar.** As an admin: „Passwörter verwalten“, pick a person with a password,
   „Löschen“. Expected: the dark backdrop also covers ChurchTools' top bar and side menu; a click on the top bar area
   closes the dialog (backdrop = cancel) and does not open a ChurchTools menu. Repeat in a 375 px wide window (browser
   dev tools) and with „Neues Passwort“ for a person that has one (the „Passwort ersetzen?“ dialog).
2. **One `main` landmark.** On any page of the extension, in the browser console:
   `document.querySelectorAll('main, [role=main]').length`. Expected: 1. If ChurchTools wraps the extension in its own
   `main`, note it (the extension's frame would then need another element).
3. **Group link.** As an admin: „Einstellungen“ → „Zugriff“ → „In ChurchTools öffnen ↗“ at the users group and at the
   admin group. Expected: each opens `https://<instance>/groups/<id>/dashboard` with that group's dashboard, not an
   error page.
4. **Password managers.** In Chrome (built-in manager), Firefox and Safari, and if available with Bitwarden or
   1Password: „Mein Passwort“ → „Neues Passwort festlegen“ → „Selbst wählen“, type a new password and the ChurchTools
   password, save. Expected: no manager offers to replace the saved **ChurchTools** login with the new secondary
   password; if one offers to save a new login, it must not be under the ChurchTools username. Then generate one
   („Zufällig erzeugen“): the read-only result field (`autocomplete="off"`) should not trigger a save prompt. Note each
   manager's behaviour; if one overwrites the ChurchTools login, report it (security review of Task 12, F2).
5. **Session renewal popup.** As a user, open „Mein Passwort“. In the console, shorten the stored token and reload
   (the app reads it at startup):
   `t = JSON.parse(sessionStorage['cps-token']); t.expiresAt = Date.now() + 90000; sessionStorage['cps-token'] = JSON.stringify(t); location.reload()`.
   Within the remaining minute, click „Neues Passwort festlegen“. Expected: a ChurchTools login popup opens (and closes
   by itself while ChurchTools still has a session), the form opens, and no „Sitzung erneuern“ banner appears. Repeat
   in Firefox and Safari. The other path, a `token-expired` answer after the confirm dialog's click, can't be provoked by hand
   reliably; `renewal.spec.ts` covers it (Chromium; WebKit where its libraries are installed).
6. **WebKit run and Safari details** (if WebKit couldn't run locally): `npm run test:browser` on a machine with the
   WebKit libraries, or the checks by hand in Safari on macOS/iOS: the Toggle's text click (Safari does not focus
   buttons on a click; the focus test is fixme there until decided), the copy feedback, and 16 px fields without zoom
   on an iPhone. Safari's activation after a click is short: in the path where the request after the confirm dialog
   answers `token-expired`, Safari may block the renewal popup. The expected fallback is the „Sitzung erneuern“
   banner, with everything typed kept; a click on its button opens the popup. The renewal popup tests are fixme in
   WebKit until a first WebKit run shows its popup-blocker default.

## CI and releases

`.github/workflows/extension.yml` runs on every push and pull request with read-only permissions, on Node 24 LTS:
`npm ci`, lint, typecheck, unit and app tests, `npm run build` (with `check-dist`) and `npm audit --audit-level=high`.
The contract tests and the browser tests don't run in CI (see above).

All four workflows (`extension.yml`, `extension-release.yml`, `backend.yml`, `backend-release.yml`) pin every action by
its full commit SHA, with the release tag in a trailing comment (`uses: actions/checkout@<40-hex> # v7.0.1`): a moved or
re-pushed tag can't change what runs. To update an action, look up the commit of the new tag in the action's official
repository and replace SHA and comment together:

```sh
git ls-remote https://github.com/actions/checkout refs/tags/v7.0.2 'refs/tags/v7.0.2^{}'
```

For an annotated tag the second line (`^{}`) is the commit; use it, not the tag object. Keep `upload-artifact` and
`download-artifact` on majors that work together (today v7 and v8, both on the same artifact service; there is no
upload-artifact v8); read both release notes before bumping either.

`.github/CODEOWNERS` names the maintainer (`@lub90`) as owner of the workflows, `.gitleaks.toml`, `.gitleaksignore` and
`CODEOWNERS` itself: a change to any of them needs the owner's review. That is enforced only when the branch protection
of `main` requires code owner reviews, which the maintainer sets on GitHub; without it, the file is only a reviewer hint.

### Secret scan (gitleaks)

A second job scans the whole git history with gitleaks (pinned version, checked against its sha256) and the committed
configuration `.gitleaks.toml` at the repository root: all default rules, plus exceptions for committed **test** values,
each with its reason. The two PEM test keys are allowed by their exact path; in the three test source files only the one
invented value each is allowed (`condition = "AND"`: exact path and exact value), so anything else secret-looking added
to those files is still reported. gitleaks can't run on the development machine of this rework, so **the first CI run
is what verifies this configuration**; if it reports a finding:

1. Look at the finding (file, commit, rule; the value is redacted in the log). If it may be a real secret, don't
   suppress it: treat it as leaked (change it where it is used) and tell the maintainer.
2. If it is a reviewed test or example value: for a single finding, add its fingerprint (`<commit>:<file>:<rule>:<line>`,
   printed by gitleaks) to `.gitleaksignore` at the repository root, with a comment line above it saying why. For a
   test value in a committed test file, add a `[[allowlists]]` block with `condition = "AND"`, the file's exact path in
   `paths` and the exact value in `regexes`, and a description. Only a multi-line test key file gets a path-only block.
   Never disable a rule or allowlist by a broad value pattern.
3. Both files are reviewed like code.

**The historic root `.env`.** Commit `78b4913` added a root `.env` with real-looking ChurchTools credentials (removed
again in `e4aca49`, but still in the history on `origin`); the scan may report it, and it is deliberately not
allowlisted. That is the maintainer's call: first treat the values as leaked and change the password (and any token) at
ChurchTools. Only then, if the history is not rewritten, add the findings' fingerprints to `.gitleaksignore`, e.g.

```text
# 78b4913: historic root .env, credentials changed on YYYY-MM-DD (maintainer); history kept.
<full SHA of 78b4913>:.env:<rule-id>:<line>
```

with the full commit SHA, the rule and the line exactly as gitleaks prints them in the `Fingerprint:` line (one line per
finding; `--redact` hides only the value, not the fingerprint).

### Releases

The CHANGELOG section of the next version is headed `## [X.Y.Z] - Unreleased` until release day; the release check
accepts only a real date, so it fails until then. Steps for a release:

1. Set the version in `package.json` and `package-lock.json` (`npm version X.Y.Z --no-git-tag-version`), and make sure
   `backend/VERSION` has the same `X.Y`.
2. Head the CHANGELOG section exactly `## [X.Y.Z] - YYYY-MM-DD` with the release date; there must be no
   `## [Unreleased]` section and only one section for `X.Y.Z`.
3. Run `node scripts/release-check.js extension-vX.Y.Z`. It checks that the tag, `package.json`, `package-lock.json`
   (also its root entry `packages[""]`) and the CHANGELOG section agree, and that `X.Y` equals the first two numbers of
   `backend/VERSION`; it names every mismatch and prints the release notes when all is well.
4. Commit, then tag `extension-vX.Y.Z` and push the tag (ask the maintainer first).

`.github/workflows/extension-release.yml` then runs the release check, the audit and `npm run check`, and compares
`dist/version.txt` (the app version the build carries, written by `vite.config.ts`) with the tag: a build from anything
but a clean checkout of the tag carries `X.Y.Z+sha` and is refused. It zips `dist/`
(`ctpassstore-extension-X.Y.Z.zip`, without sourcemaps) and publishes a GitHub release with the CHANGELOG section as
notes. Next to the ZIP it publishes `ctpassstore-extension-X.Y.Z.zip.sha256` (computed in the build job, checked
again before publishing) and signs a build provenance attestation for the ZIP (`actions/attest`, SLSA provenance via
GitHub's Sigstore). Three jobs, each with only what it needs: the build (npm packages run here) has read access only;
`attest` gets `id-token: write` and `attestations: write` and runs no project code, so the OIDC token never reaches npm
code; `release` gets `contents: write` to create the release and runs no project code either. `backend-release.yml`
does the same for `ctpassstore-backend-X.Y.Z.zip` (Composer packages instead of npm).

**Checking a downloaded release ZIP** (do this before uploading it to ChurchTools or a web server):

```sh
# Both files from the release page in one folder:
sha256sum --check ctpassstore-extension-X.Y.Z.zip.sha256
# Proves the ZIP was built by this repository's release workflow from the tag (GitHub CLI, logged in):
gh attestation verify ctpassstore-extension-X.Y.Z.zip --repo lub90/ct-pass-store \
  --signer-workflow lub90/ct-pass-store/.github/workflows/extension-release.yml \
  --source-ref refs/tags/extension-vX.Y.Z
```

`--source-ref` binds the check to the release tag: without it, an attestation from any run of the release workflow (for
example from another tag) would also pass.

The checksum catches a damaged or incomplete download; whoever can change the release page can replace both files, so
the attestation is the stronger check (it is signed and names the workflow, the tag and the commit). For the backend, use
`ctpassstore-backend-X.Y.Z.zip`, `backend-release.yml` and `--source-ref refs/tags/backend-vX.Y.Z`.
