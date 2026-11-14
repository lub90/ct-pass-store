# Developing the CtPassStore extension

`npm run dev` starts the Vite development server at `http://localhost:5173/ccm/ctpassstore/`. It runs in one of two
modes. The choice is made in `src/main.ts` with the literal condition
`import.meta.env.DEV && import.meta.env.MODE !== 'real'`. A production build replaces it with `false` and drops
everything under `src/dev/`.

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

The app uses the real ChurchTools instance through a Vite proxy, and the backend named in the instance's settings.

1. Create `.env` with mode `600` before putting anything into it, so it is never readable by other users:

   ```sh
   install -m 600 .env-example .env
   ```

   (This replaces an existing `.env`; if you already have one, fix its mode with `chmod 600 .env` instead.) Then fill
   in `CT_BASE_URL` (`https://<instance>.church.tools`) and `CT_LOGIN_TOKEN` (a ChurchTools login token of a
   test account). Check the mode with `ls -l .env` (`-rw-------`).
2. `vite.config.ts` reads the two variables (only when the dev server starts in mode `real`) and forwards `/api` to the
   instance with `Authorization: Login <token>`, so the browser never sees the token. The server refuses to start if
   `CT_BASE_URL` isn't an `https://` address without credentials or if `CT_LOGIN_TOKEN` is empty.

Notes:

- **No `VITE_` prefix.** Vite inlines `import.meta.env.VITE_*` into the bundle. The CT variables have no prefix and are
  read only by `vite.config.ts`. The app's `envPrefix` is `CPS_PUBLIC_`, so even an old `.env` with `VITE_*` keys can't
  reach a build.
- **The login token is effectively a permanent password.** It stays valid until the account's password is changed;
  use a test account and never commit, paste or log it.
- **Backend address:** the app talks to the backend only over `https://`. Local `http://localhost` backends are not
  allowed in the app, in any mode.
- **Other credential files** (backend `phpunit.xml`, `credentials.php`, recorded contract fixtures) are created with
  mode `600` too, e.g. `install -m 600 /dev/null <file>` before writing into it.

## Builds and the demo

`npm run build` runs `scripts/check-dist.js` after the build. Among other checks it fails if the build contains the demo
marker `__DEMO__` (every module under `src/dev/` puts it into its code) or any of the demo data strings
(`DEMO_STRINGS` in `src/dev/demo-data.ts`). `scripts/build.test.ts` builds the app in production, development and real
mode and checks that only the development build contains the demo.
