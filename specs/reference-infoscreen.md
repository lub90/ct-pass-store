# Reference project: churchtools-infoscreen

**Repository:** https://github.com/wirsindcgks/churchtools-infoscreen
**Analyzed:** version 0.49.2, commit `ba6b64d`, 2026-11-01

This project is our **benchmark for the Vue part** of ct-pass-store: architecture, design and UX. For the PHP backend
it's only useful for its general engineering practices (section 5).

It's a ChurchTools extension that lets a church design the screens in its foyer: a slide designer plus a kiosk player.
The stack is Vue 3, TypeScript (strict), Vite, Pinia, valibot, Vitest and Playwright. It has **no Vuetify and no
Tailwind**; the UI is built on a hand-written CSS design system. The project is large: about 77,000 lines of code,
138 unit test files and 36 end-to-end test specs. **Copy its patterns, not its size.**

All paths below are relative to the repository root. The project's docs are in German; its code is in English.

---

## 1. How far it applies to us

| Area | Applies to us | Notes |
| --- | --- | --- |
| Vue architecture (layers, store, setup wizard) | **High** | Section 2 |
| Design system and UX | **High** | Section 3. It looks native to ChurchTools. |
| Engineering process (tests, CI, releases, docs) | **High** | Section 4 |
| PHP backend | **Limited** | Only the practices that don't depend on the language (section 5) |
| Kiosk player, service worker, fonts, slide editor | None | Specific to that product |

## 2. Architecture (Vue part)

### Folders by domain, thin views

- `src/` is organized by domain, not by technical layer:
  - `ct/`: ChurchTools API
  - `store/`: persistence
  - `model/`: schemas
  - `setup/`: provisioning of groups and rights
  - `i18n/`: UI texts
  - `dev/`: demo data
  - `views/`: route pages only
- The logic lives in pure `.ts` modules with a `*.test.ts` file next to each. Views stay thin.
- `src/main.ts`: `configureClient()`, then `createApp(App).use(createPinia()).use(router).mount('#app')`. There's no
  async bootstrap; each view loads its own data.
- `src/App.vue` is just `<RouterView/>` plus one global `<ConfirmDialog/>`.
- `src/router.ts`:
  - flat routes, `createWebHistory(import.meta.env.BASE_URL)`
  - a catch-all `/:pathMatch(.*)*` → `NotFoundView`
  - no route guards; rights are checked inside the views
- `src/config.ts` derives the extension key from `BASE_URL`, so the same code runs under a test key.

### ChurchTools API layer (`src/ct/`)

- **`client.ts`:**
  - `instanceBaseUrl()` returns `window.settings.base_url` inside ChurchTools and `location.origin` (the dev proxy)
    otherwise. No instance URL ever reaches the bundle.
  - `NotAuthenticatedError` / `assertAuthenticated()` reject the anonymous person (`id -1`). ChurchTools answers `200`
    with empty data when nobody is logged in, so the status code alone isn't enough.
  - Cached promises that reset themselves on error, for the current person, the module ID and the admin check.
  - `httpStatus(error)`, and `retryAfterMs()` for `429` (accepts seconds or an HTTP date, never less than 60 s).
- **`api.ts`:** one thin typed function per endpoint, each with a doc comment on API quirks measured on a real
  instance.
- **`types.ts`:** a few hand-written types instead of the large generated type file. Each feature declares the
  response fields it actually reads.

### Persistence layer (`src/store/`, `src/model/`)

The most valuable part to copy.

- **`store/kv.ts`:** a `KvBackend` interface that mirrors the KV API one-to-one (list and create categories; list,
  create, update and delete values).
- **`store/churchtools-kv.ts`:** the real implementation. It finds its module by listing `GET /custommodules` and
  matching `shorty`. (Our own approach is `GET /custommodules/{key}`; see `specs/ct-extension-info.md`.)
- **`store/memory-kv.ts`:** an in-memory implementation for tests. It records every write and can fail from the Nth
  write on (`failFromWrite`), which makes interrupted saves testable.
- **`dev/demo-kv.ts`:** the in-memory store plus localStorage persistence and sync between tabs. The dev server uses
  it by default, so development never writes into the real instance.
- **`store/backend.ts`:** `getRepository()` decides between demo and real module. Production has no silent fallback.
  The dev branch is tree-shaken out of the release build.
- **`model/schema.ts`** (valibot): every stored document carries `schema` (major/minor version), `kind`, `id` and
  `revision`.
- **`model/read.ts`:** tolerant reads, strict writes.
  - `checkVersion` throws `SchemaTooNewError` when the stored data is newer than the code.
  - `parseStrict` validates. Broken parts are skipped and reported instead of failing the whole document.
  - `serialize()` validates and enforces the 10,000-character limit (`ValueTooLargeError`) **before** writing.
- **`store/screen-repository.ts`:**
  - Categories declared in one `CATEGORIES` constant and created on first use (with a comment noting that it works
    "like the setup assistant of ct-pass-store").
  - **Optimistic concurrency:** each save compares `expectedRevision` with the stored one and throws `ConflictError`
    (with `updatedBy`/`updatedAt`) on a mismatch.
  - **Write order:** children first, the index last, so an interrupted save never leaves dangling references.

### State

- **Only one Pinia store** (`designer/editor-store.ts`), for the complex editor. Every other page uses local `ref`s
  plus small singleton composables (`designer/useConfirm.ts`, `designer/administrator.ts`).
- **For us:** plain refs and a few composables are enough. Pinia is optional.

### Setup wizard and rights (`src/setup/`)

- **`catalog.ts`:** reads the rights catalog through the legacy AJAX API and finds the module's auth IDs **by name**.
  IDs are never hard-coded.
- **`provision.ts`:**
  - `planProvisioning()` is a **pure function** returning the groups, the rights to grant and the rights that must be
    absent. The UI can show the plan before anything is written.
  - `provision(plan, …, api)` runs it step by step through an injected `ProvisionApi`, keeping a log in plain
    language.
  - `planRefresh` / `applyRefresh` repair rights after an update.
  - `removeCreatedGroups` only removes what the assistant itself created.
- **`load.ts`:** the real API calls:
  - `POST /groups`
  - `GET /groups/{id}/roles`
  - `PUT` / `DELETE /permissions/group_role/{roleId}`
  - reading `/permissions/global`
- **`checks.ts`:** pure traffic-light checks (ok/warn/fail/info) over the loaded rights.
- **`abilities.ts`:** decides which setup buttons work and names the missing rights.
- **`designer/rights.ts`:** missing rights are shown as a banner listing them, instead of an empty list or a `403`.
- **Copy the shape plan → execute → check, with an injected API.** It solves our TODO item "assign the permissions
  ourselves".

### Texts (`src/i18n/`)

- No library: nested `const` objects (`designer.ts`, `player.ts`) with English keys and German values. Texts with
  parameters are functions.
- `no-bare-text.test.ts` parses every `.vue` file and fails on hard-coded text in templates.
- Cheap and type-safe. Copy it unless we need several languages.

### Configuration and dev setup

- `.env`: `CT_BASE_URL` and `CT_LOGIN_TOKEN` have **no `VITE_` prefix**, so they never reach the bundle.
- **`vite.config.ts`:**
  - A dev proxy forwards `/api` to the test instance and injects `Authorization: Login <token>`. The browser never sees
    credentials, which also fixes Safari's cookie problems.
  - `__APP_VERSION__` comes from `git describe` (`0.49.2`, `0.49.2+sha` or `0.49.2+sha-dirty`).
  - `modulePreload.polyfill: false`, because the ChurchTools CSP blocks inline scripts.

## 3. Design and UX (reference for our UI)

### Styling approach

- **One global stylesheet**, `src/designer/theme.css`, with tokens and shared classes prefixed `d-` (`d-btn`,
  `d-card`, `d-field`, `d-banner`, `d-dialog`, `d-tiles`, `d-choice`). Component-specific styles are `<style scoped>`.
- **How it stays separate from the host page:**
  - Everything is scoped under one root class (`.infoscreen-designer`).
  - Shared rules use `:where(...)`, so specificity stays at a single class and scoped component styles can override
    them.
  - No `@layer`: unlayered CSS always beats the host's Tailwind v4 layers, so `!important` is never needed.
  - `src/designer/host-classes.test.ts` fails if one of its class names matches a Tailwind utility (`collapse`,
    `hidden`, `flex`, …). This came from a real bug: a button with the class `collapse` was invisible inside
    ChurchTools.
  - z-index values sit above ChurchTools' sticky top bar (1040): menus 1000, dialogs 1100, tooltips 1200.

### Design tokens (`src/designer/theme.css`)

Every token reads a ChurchTools host variable, with the light-mode value as fallback:

```css
.infoscreen-designer {
    --d-font: var(--font-sans, 'Lato', ui-sans-serif, system-ui, sans-serif);
    --d-text: var(--color-basic-primary, oklch(20.8% 0.042 265.755));
    --d-text-muted: var(--color-basic-secondary, oklch(44.6% 0.043 257.281));
    --d-surface: var(--color-basic-inverted, #fff);
    --d-panel: var(--color-basic-b-pale, oklch(98.4% 0.003 247.858));
    --d-divider: var(--color-basic-divider, oklch(92.9% 0.013 255.508));
    --d-accent: var(--color-accent-bright, oklch(54.6% 0.245 262.881));
    --d-danger: var(--color-destructive-bright, …);
    --d-create: var(--color-constructive-b-bright, …);  /* green "+ … erstellen", like ChurchTools' own */
    --d-radius: var(--radius-md, .375rem);
    --d-radius-lg: var(--radius-lg, .5rem);
    --d-size: var(--text-base, .875rem);
    /* spacing 4/8/12/16/24/32px; control height 40px, 44px on touch */
}
```

- **Dark mode comes for free:** the host's semantic tokens switch when ChurchTools sets `.dark`. Only one extra
  override is needed.
- **Font:** the host's Lato. No UI font is bundled. Font weight 500 is avoided, because the Lato ChurchTools ships only
  has 300, 400 and 700.

### Components and patterns

- **Buttons** are classes, not components: `d-btn` plus `--primary`, `--create` (green), `--danger`, `--ghost`,
  `--icon`. Icon buttons always have an `aria-label` and a tooltip.
- **Icons:** `Icon.vue`, a small inline SVG line-icon set. There's no icon font.
- **Page frame:** `ModulePage.vue` (grey workspace, sticky sidebar card, content in a large white card) and
  `PageHeader.vue` (pale icon square, h1, an explanatory sentence, actions on the right).
- **Confirmations:** `useConfirm.ts` + `ConfirmDialog.vue`. It's promise-based and replaces `window.confirm`. The
  danger variant starts with focus on "Cancel".
- **Irreversible actions:** `RemoveSetupDialog.vue` lists exactly what will be deleted and requires typing the word
  "entfernen".
- **Forms:**
  - `.d-field`: a label wrapping the control, the label small and muted.
  - `.d-choice`: checkbox/radio cards; the checked one is highlighted via `:has(> input:checked)`.
  - `ToggleField` uses `role="switch"`.
  - `SelectMenu.vue` is a keyboard-accessible listbox with search.
- **Alerts:** `.d-banner`, a 4px left border plus a pale fill, with `--warning`/`--error` variants. That's calmer than
  saturated alert boxes.
- **Help:** `HelpButton.vue` (turquoise "?"), the `v-tip` tooltip directive, and `IntroCard.vue` (a non-blocking intro
  with "Start" / "Später").

### Layout and pages

- **Sidebar navigation:** 44px entries with an icon square. The active entry gets a pale accent background and
  `aria-current="page"`. Settings and "Über & Neuigkeiten" (about and release notes) are pinned to the bottom.
- **Settings overview** (`src/views/SetupView.vue`): link cards with an icon, title, intro sentence, a status pill
  ("✓ eingerichtet" or a warning) and a chevron. Sub-pages have a "‹ Einstellungen" back button.
- **Saving:** Save and Discard are disabled until something changes. Success shows as inline "Gespeichert" text with
  `role="status"`.
- **Setup assistant:**
  - explanation text and a `<details>` "Was passiert" (what happens)
  - the primary button, with hints explaining why it's disabled
  - a running log of the steps
  - rights checks as groups with colored dots
- **Phone** (below 48rem):
  - a single column, with the sidebar turning into a dropdown
  - the label of create buttons hidden
  - 44px touch targets
  - 16px input font (prevents iOS zoom)

### UX rules

- **Loading:** a muted inline line ("Lade …") inside an already rendered frame. No spinners, no full-page loaders.
- **Empty states:** one muted sentence saying what to do next.
- **Errors:** specific red text with `role="alert"`, never a blank page.
- **Missing rights:** a warning banner naming them, and hints on disabled buttons.
- **Wording:** German, informal "du", calm. Each page header has one or two sentences saying what the page is for.
  German quotes „…".

### Accessibility

- A global `:focus-visible` outline in the accent color.
- The dialog uses `role="alertdialog"`, `aria-modal` and a focus trap. Esc cancels, and focus returns where it was.
- `prefers-reduced-motion` turns off transitions.
- Contrast is documented in code comments.

### What this means for our Vuetify-based extension

ct-pass-store uses Vuetify (Material look, MDI icon font). Before reworking our UI we need to decide between two paths:

1. **Keep Vuetify, but restyle it heavily:**
   - one root class
   - point Vuetify's theme colors at the ChurchTools tokens (`--color-accent-bright`, `--color-basic-*`, …)
   - flat variants, 8px radius, no elevation except a soft card shadow, 40px controls
   - no uppercase buttons, `font-family: var(--font-sans)`, `v-alert variant="tonal" border="start"`

   Risk: Vuetify's global `:root` theme and reset can collide with the host page.
2. **Replace Vuetify with a small `theme.css` like theirs:** lighter and closer to the host. That's realistic, because
   our extension has only three pages (password, settings, setup).

Either way, adopt:
- the token mapping to host variables
- a test against Tailwind class names
- `useConfirm`
- banners instead of saturated alerts
- the settings overview as link cards with status pills
- the setup assistant pattern
- the loading/empty/error rules
- the wording rules

Our MDI icon font is bundled under `/ccm/…`, so the CSP allows it. Inline SVGs or `@mdi/js` paths would still be
lighter.

## 4. Engineering process

- **Unit tests (Vitest, jsdom):**
  - test files sit next to the code
  - the API is mocked with `vi.mock` or an injected `fetcher`
  - `MemoryKv` stands in for the KV store
  - test data is built from the types (`src/model/testing.ts`)
- **Fixtures:**
  - real API responses recorded only from the test instance
  - cleaned with `scripts/sanitize-fixture.js` (personal data, instance host, tokens, iCal URLs, hashes) and
    **gitignored**
  - tests that need them use `describe.skipIf(!hasFixture(…))`, so they show as skipped, never silently green
- **Tests that keep docs honest:**
  - `src/setup/rights-doc.test.ts`: every right the wizard grants must appear in `docs/Rechte.md`
  - `no-bare-text.test.ts`: no hard-coded UI text
  - `host-classes.test.ts`: no Tailwind class names
- **End-to-end (Playwright):** Chromium and WebKit, against the dev server in demo mode, **run by hand, not in CI**.
  `e2e/docs-screenshots.spec.ts` generates the documentation screenshots from invented data.
- **TypeScript:** `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`/`Parameters`, `verbatimModuleSyntax`.
  ESLint uses `eslint-plugin-vue` + `@vue/eslint-config-typescript`.
- **`scripts/check-dist.js`** (runs after every build) enforces:
  - exactly one JS bundle
  - no inline `<script>`
  - no instance host in the output
  - no external fonts
  - no demo code
  - license files present
- **CI** (`.github/workflows/ci.yml`): one job `check` (lint → typecheck → test → build) on every push and PR, with
  `permissions: contents: read`.
- **Releases** (`.github/workflows/release.yml`):
  - triggered by tags `v*.*.*`
  - `scripts/release-check.js` verifies that the tag, `package.json`, `package-lock.json` and a dated CHANGELOG
    section agree
  - it creates the GitHub release with the CHANGELOG section as notes
- **Branch rules:** `main` can't be force-pushed or deleted, merges are squash-only via PRs with a green `check`, and
  release tags are protected. A failed release gets the next patch version instead of a moved tag.
- **CHANGELOG:**
  - Keep a Changelog format with SemVer, written for users
  - no "Unreleased" section
  - the app parses it and shows it on its "Über & Neuigkeiten" page
- **Documentation:**

  | File | Purpose |
  | --- | --- |
  | `README.md` | Public face |
  | `AGENTS.md` | One rules file for all agents; `CLAUDE.md` only points to it |
  | `Plan.md` | Decisions and conventions |
  | `Befunde.md` | Log of measured ChurchTools behavior |
  | `LocalTests.md` | Development setup |
  | `docs/` | User and admin guides: setup, onboarding, a rights table, a feature tour, outage behavior |

  Developer details in user docs go inside `<details>` blocks.
- **Gap:** dependency audits are done by hand. There's no Dependabot and no audit step in CI.

## 5. What applies to the PHP backend

Only the practices that don't depend on the language:

- **One required CI job** `check`: `composer validate` → code style → PHPStan → PHPUnit, with read-only permissions and
  Composer caching.
- **A release workflow on tags** with a release-check script: tag = version = dated CHANGELOG section. The CHANGELOG
  section becomes the release notes.
- **A post-build check of the deploy folder:**
  - no `credentials.php`
  - no secrets or instance URLs
  - no dev files
  - licenses present
  - the expected layout
- **The version visible at runtime** (e.g. in `/test`): `x.y.z`, `x.y.z+sha`, `x.y.z+sha-dirty`.
- **Fixtures, tests and the HTTP client:**
  - recorded ChurchTools responses gitignored and sanitized
  - `markTestSkipped` when they're missing
  - test data built from types
  - the HTTP client injected so tests can replace it (matches decision D1 in `specs/backend-spec.md`)
- **Tests that keep docs honest,** e.g. the permission table in `backend/docs/setup.md` versus the code.
- **`composer audit` as a CI step.** Better than their manual approach.
- **Keep a Changelog, SemVer, protected tags and squash merges.**

## 6. What not to copy

- **File sizes:** `SetupView.vue` (1,745 lines, seven routes on one component), `screen-repository.ts` (1,518 lines),
  `editor-store.ts` (1,687 lines). Use child routes and smaller components instead.
- **Product-specific features:** orphan cleanup with a grace period, drafts, the changelog category, heartbeats, the
  service worker, fonts, the slide editor.
- **Plan.md item numbers cited in code comments everywhere.**
- **Their module lookup** by listing all modules (see section 2).
