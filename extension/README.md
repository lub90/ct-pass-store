# CtPassStore extension

The ChurchTools extension (Vue 3, Vite 8, strict TypeScript) of CtPassStore. It is served by ChurchTools under
`/ccm/ctpassstore/`. The design is in [`specs/extension-spec.md`](../specs/extension-spec.md); installation of the
extension and the backend is described in [docs/setup.md](./docs/setup.md).

## Development

```sh
npm install
npm run dev                          # demo mode: invented data, nothing leaves the browser
npm run dev -- --mode real           # real mode: the ChurchTools side of a test instance (no backend login)
```

**Demo mode** is the default: the app runs against in-memory fakes of ChurchTools and the backend with invented data
(`src/dev/`). A small switch at the bottom right changes the scenario (user, admin, setup missing, ...); the state is
kept in `localStorage` (development only) and can be reset there. The demo ChurchTools password is `demo-passwort`.

**Real mode** covers the ChurchTools side only (KV values, persons, groups, rights); there is no backend login on
the dev server, so backend flows are tested in the build hosted on the test instance. It needs Node.js 23.6+ like
every script here, and `CT_BASE_URL` and `CT_LOGIN_TOKEN` in `.env` (an old `.env` with `VITE_*` keys must be
migrated to these two). Create the file with mode `600` before filling it in:

```sh
install -m 600 .env-example .env     # once (it replaces an existing .env); then edit. ls -l .env: -rw-------
```

The variables have no `VITE_` prefix on purpose: only `vite.config.ts` reads them, for the dev proxy that forwards
`/api` with `Authorization: Login <token>`; they never reach the bundle. Treat the login token like a password. Other
credential files (backend `phpunit.xml`, recorded fixtures) are created with mode `600` as well. Details:
[docs/development.md](./docs/development.md).

## Scripts

| Script                  | Purpose                                                          |
| ----------------------- | ---------------------------------------------------------------- |
| `npm run dev`           | development server (demo mode; `-- --mode real` for an instance) |
| `npm run build`         | production build into `dist/`, followed by `scripts/check-dist.js` |
| `npm test`              | unit and app tests (Vitest)                                      |
| `npm run test:contract` | contract tests against a real ChurchTools test instance          |
| `npm run test:browser`  | browser tests (set up later)                                     |
| `npm run lint`          | ESLint                                                           |
| `npm run typecheck`     | `vue-tsc --noEmit`                                               |
| `npm run check`         | lint, typecheck, tests and build with its check                  |
| `npm run deploy`        | build and zip `dist/` into `releases/`                           |

`__APP_VERSION__` is the `package.json` version on an `extension-v<version>` tag, otherwise `<version>+<sha>`
(plus `-dirty` with uncommitted changes).
