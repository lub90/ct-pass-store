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

`npm run build` runs `scripts/check-dist.js` after the build. Among other checks it fails if the build contains the demo
marker `__DEMO__` (every module under `src/dev/` puts it into its code) or any of the demo data strings
(`DEMO_STRINGS` in `src/dev/demo-data.ts`). `scripts/build.test.ts` builds the app in production, development and real
mode and checks that only the development build contains the demo.

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
  (`tests/contract/backend-sandbox.ts`, 127.0.0.1, a free port, a fresh cache and log folder per run, deleted after).
  Its configuration (`tests/contract/sandbox/credentials.php`) holds no values; everything comes from the PHP
  process's environment, with a random `JWT_SECRET` per run. The deployed backend of the test instance is not used.
  - A temporary confidential OAuth client with the redirect URI `https://<instance>/ccm/ctpassstore/auth/callback`;
    its secret stays in memory. The normal test user gets „login to external system“ for this client only (`PUT`
    adds it; `DELETE` with the same body removes exactly it; afterwards all of the user's own grants are compared
    with the start).
  - "user" logs in through the real OAuth flow and `POST /v1/auth/token`. "admin" uses a token signed with the
    per-run secret exactly as the login issues it, because nobody is an admin on the test instance.
  - Entries are written only for persons that have none; the run refuses to start otherwise.
- **HTTPS:** the extension's backend client accepts `https://` only, and `src/` has no switch for plain HTTP. So the
  tests give the client the address `https://backend.contract.invalid` and replace `fetch` (`vi.stubGlobal`, test
  code only) with one that sends those requests to the sandbox. The sandbox's router sets `HTTPS=on`, as a TLS
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
- **Skipped cases**, by design: the read-only-rights case (no test user may read without writing), the
  primary-password cases while the instance doesn't require it, and the cases for the other value of
  `allowCustomPassword`. Vitest lists them as skipped.

### Recorded responses

With `CT_CONTRACT_RECORD=1` a few raw answers are written to `tests/contract/fixtures/` (gitignored, mode `600`), only
through `scripts/sanitize-fixture.js`: secrets under keys like `token`, `secret`, `pwd`, `code` are blanked; names,
initials and contact data replaced; the instance host becomes `ct.example`; tokens, hashes and ciphertexts in any
string become `<jwt>` / `<hash>`. To sanitize a file by hand: `CT_API_URL=… node scripts/sanitize-fixture.js in.json
out.json`.
