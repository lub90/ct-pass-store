# CtPassStore extension

The ChurchTools extension (Vue 3, Vite 8, strict TypeScript) of CtPassStore. It is served by ChurchTools under
`/ccm/ctpassstore/`. The design is in [`specs/extension-spec.md`](../specs/extension-spec.md); installation of the
extension and the backend is described in [docs/setup.md](./docs/setup.md).

## Development

```sh
npm install
cp .env-example .env     # only for --mode real; demo mode needs no values. Keep .env at mode 600.
npm run dev              # development server
```

`CT_BASE_URL` and `CT_LOGIN_TOKEN` have no `VITE_` prefix on purpose: they are read by the Vite dev proxy
(`npm run dev -- --mode real`) and never reach the bundle.

## Scripts

| Script                  | Purpose                                                          |
| ----------------------- | ---------------------------------------------------------------- |
| `npm run dev`           | development server                                               |
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
