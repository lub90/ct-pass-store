# Extension Rework – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the ChurchTools extension (`extension/`) as specified: own design system, new architecture, OAuth
login against the `/v1` backend, the password, admin and settings pages, two languages, and the test layers.

**Architecture:** Domain folders under `extension/src/` (spec 5.1) with thin views. Every external system sits behind
one module (`ct/`, `store/`, `backend/`) and is injected, so the app runs against fakes (`dev/`) in tests and in demo
mode. The design system `ui/` is a closed folder without app imports.

**Tech Stack:** Vue 3.5, vue-router 5, vue-i18n (current major), valibot 1, `@mdi/js` 7, Vite 8, TypeScript 6
(strict), Vitest 5 + jsdom + `@vue/test-utils` 2, ESLint 10 + `eslint-plugin-vue`, Playwright. These are the majors
churchtools-infoscreen 0.61.0 uses (checked 2026-11-13); `npm view <pkg> version` for vue-i18n and
`@churchtools/churchtools-client` before Task 1.

**Spec:** [`extension-spec.md`](extension-spec.md) (numbers below like "4.2" are its sections),
[`versioning.md`](versioning.md), [`reference-infoscreen.md`](reference-infoscreen.md),
[`ct-extension-info.md`](ct-extension-info.md). The backend side is
[`backend-admin-group-plan.md`](backend-admin-group-plan.md); this plan doesn't need it until Task 18 (contract tests
against the real backend).

**Branch:** `feature/extension-rework` from the branch that holds the specs (`docs/extension-spec`, or `main` after
it's merged). Work in a worktree; another agent may be working in the main checkout.

Tasks marked **[security-critical]** get, after Superpowers' own task review, a `test-reviewer` and a
`security-reviewer` pass on their diff (project `.claude/CLAUDE.md`, review point A; added 2026-11-14).

## Global Constraints

- All commands run in `extension/`. Every commit passes `npm run check` (lint → typecheck → unit and app tests →
  build → build check) from Task 1 on.
- Version: `package.json` `0.1.0` (shares `MAJOR.MINOR` with `backend/VERSION`, `versioning.md`).
- Base path `/ccm/ctpassstore/`; extension key `ctpassstore`; KV categories `settings`, `access`,
  `encryptionSettings`, `passwordStore` (spec 6.1).
- No Vuetify, no Pinia, no icon font, no bundled UI font. Lato from the host, weights 400 and 700 only (spec 9.1).
- Root class `.cps`; shared CSS rules inside `:where(…)`; no `@layer`, no `!important`; z-index menus 1000, dialog
  1100.
- Spacing tokens 4/8/12/16/24/32 px; control height 40 px, 44 px under `(pointer: coarse)`; inputs 16 px font below
  48rem and under `(pointer: coarse)`.
- Every UI text comes from `i18n/de.ts` / `i18n/en.ts`; German informal "du", quotes „…“. `ui/` components take their
  labels as props.
- `ct/`, `store/`, `backend/` are the only modules that call `fetch` or the ChurchTools client.
- `.env` keys `CT_BASE_URL`, `CT_LOGIN_TOKEN` (no `VITE_` prefix); demo mode is the default of `npm run dev`.
- Backend base URL = `settings.backendUrl` without trailing slash + `/v1`; request timeout 15 s.
- OAuth: `scope=api`, PKCE S256, redirect URI `<origin>/ccm/ctpassstore/auth/callback`; token in `sessionStorage`;
  renew when fewer than 120 s are left, only inside a click handler.
- Password rules mirror backend spec 5.1: length ≥ `passwordLength` and ≤ 128; ≥ 1 letter, ≥ 1 digit, ≥ 1 of
  `! @ $ % & * - _ + = ? .`; no other characters.
- Settings: `passwordLength` 12–64; texts: title ≤ 60, intro ≤ 300 characters; values ≤ 10,000 characters.
- Not in this plan (wizard spec, spec 12): the setup and migration wizards, backup/restore, provisioning, the rights
  check (16.4) and changing groups (16.5). This plan reserves their routes and shows `setup-needed` /
  `migration-needed` with the waiting text.

## Review Focus

1. **A password pasted with a trailing space or newline** (from a password manager or a mail): the rule list marks
   „keine anderen Zeichen“ and the message names the space; nothing is trimmed silently. → Task 10 test
   `rules flags a trailing space as invalid-character`.
2. **The request times out after the backend may have stored a generated password:** the user must not believe the
   old password still works. Show „Es ist unklar, ob das neue Passwort gespeichert wurde. Leg sicherheitshalber noch
   eins fest.“ and reload the status. → Task 12 test `timeout on generate warns that the outcome is unknown`.
3. **The session expires while a generated password is on screen:** the plaintext stays until „Fertig“; a renewal
   never re-renders the result away. → Task 12 test `token expiry does not clear the shown password`.
4. **Two admins save the settings at the same time (two tabs):** the second save reports the conflict instead of
   overwriting. → Task 14 test `second save with a stale revision reports a conflict`.
5. **A `backendUrl` with a trailing slash, a path, or `http://`:** the slash is removed, a path is kept, `http://` is
   refused in the settings form and treated as `setup-needed` when read. → Task 16 test `backend url rules` and
   Task 8 test `base url without trailing slash`.

---

### Task 1: Clean slate and tooling

**Files:**
- Delete: everything in `extension/src/` (old views, components, `setup/`, `layouts/`, `ct-utils/`,
  `ct-extension-utils/`, `utils/ct-types.d.ts`, `types/`, `AppConfig.ts`), `extension/releases/` stays ignored.
- Create: `extension/src/main.ts`, `App.vue` (renders `<RouterView/>` inside `<div class="cps">`), `router.ts` (one
  route `/` with a placeholder view), `config.ts`, `vite-env.d.ts`
- Rewrite: `extension/package.json`, `vite.config.ts`, `tsconfig.json`, `.env-example`, `README.md`
- Create: `extension/eslint.config.js`, `vitest.config.ts`, `scripts/check-dist.js`, `scripts/check-dist.test.js`,
  `extension/CHANGELOG.md`
- Modify: `extension/.gitignore` (add `coverage/`, `test-results/`, `playwright-report/`, `tests/contract/fixtures/`,
  `.env`), root `TODO.md` (tick "remove `angular-route`", "keep the test instance URL out of the release build",
  "reconsider `ct-types.d.ts`")

**Interfaces:**
- Produces: `config.ts`: `EXTENSION_KEY = 'ctpassstore'`, `BASE_PATH` (from `import.meta.env.BASE_URL`),
  `APP_VERSION` (`__APP_VERSION__`), `CALLBACK_PATH = 'auth/callback'`.
- Produces: npm scripts `dev`, `build`, `test` (unit + app), `test:contract`, `test:browser`, `lint`, `typecheck`
  (`vue-tsc --noEmit`), `check`, `deploy` (build + zip as today's `scripts/package.js`).

- [ ] **Step 1:** Write `scripts/check-dist.test.js` (Vitest, against fixture folders in a temp dir): passes for one
  JS bundle and no inline script; fails for two bundles, an inline `<script>` without `src`, a `*.church.tools` host
  other than `example.church.tools`, a `@font-face` with an external URL, the string `__DEMO__` (demo marker), a
  missing `THIRD-PARTY-LICENSES.txt`.
- [ ] **Step 2: Run** `npx vitest run scripts` → FAIL.
- [ ] **Step 3: Implement** `check-dist.js`, the Vite config (`base: '/ccm/ctpassstore/'`, one bundle via
  `build.rollupOptions.output.inlineDynamicImports: true`, `modulePreload: { polyfill: false }`, `define:
  __APP_VERSION__` from `git describe --tags --match 'extension-v*'` formatted `x.y.z`, `x.y.z+sha`,
  `x.y.z+sha-dirty`, a dev proxy for `/api` to `CT_BASE_URL` adding `Authorization: Login <CT_LOGIN_TOKEN>` only when
  `--mode real`), a license-collecting Rollup plugin writing `THIRD-PARTY-LICENSES.txt`, and the strict
  `tsconfig.json` (`strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`,
  `verbatimModuleSyntax`).
- [ ] **Step 4: Run** `npm run check` → PASS (the placeholder app builds; `dist/` passes the check).
- [ ] **Step 5: Commit:** `"Extension: clean slate, Vite 8, strict TypeScript, Vitest, ESLint, build check"`.

### Task 2: Design tokens and the first `ui/` pieces

**Files:**
- Create: `extension/src/ui/theme.css`, `ui/Icon.vue`, `ui/icons.ts`, `ui/Banner.vue`, `ui/Pill.vue`,
  `ui/StatusLine.vue`, `ui/PageHeader.vue`, `ui/index.ts`
- Test: `ui/Banner.test.ts`, `ui/PageHeader.test.ts`, `ui/guards/host-classes.test.ts`,
  `ui/guards/ui-boundary.test.ts`

**Interfaces:**
- Produces tokens (prefix `--cps-`), each mapped like infoscreen's `src/designer/theme.css` (2026-11-13): `font`,
  `text`, `text-muted`, `surface`, `panel`, `divider`, `accent`, `accent-text`, `accent-pale`, `danger`,
  `danger-pale`, `warning`, `warning-pale`, `success`, `create`, `create-text`, `radius`, `radius-lg`, `size`,
  `size-sm`, `space-1`…`space-6`, `control-h`, `shadow-card`, `transition`, `weight-normal: 400`,
  `weight-strong: 700`. Contrast notes as comments.
- Produces: button classes `cps-btn`, `cps-btn--primary|--create|--danger|--ghost|--icon`.
- Produces: `<Icon name: IconName size?: number />` (`IconName` = keys of `icons.ts`, which re-exports only used
  `@mdi/js` paths); `<Banner kind: 'info'|'warning'|'error' :title? >slot</Banner>` (`role="alert"` for `error`,
  `role="status"` otherwise); `<Pill kind: 'ok'|'neutral'|'warning'|'error'>`; `<StatusLine kind: 'loading'|'empty'|'error' text>`;
  `<PageHeader icon title intro>` with an `actions` slot.

- [ ] **Step 1: Failing tests:** `host-classes.test.ts` scans `src/**/*.vue` and `theme.css` for class names and
  fails on any Tailwind utility name (list as infoscreen's `host-classes.test.ts`: `collapse`, `hidden`, `flex`,
  `block`, `grid`, `container`, `sr-only`, `truncate`, …); `ui-boundary.test.ts` fails if a file in `src/ui/` imports
  a path outside `src/ui/` (except `vue` and `@mdi/js`); `Banner.test.ts` checks the roles; `PageHeader.test.ts`
  renders title and intro.
- [ ] **Step 2: Run** `npx vitest run src/ui` → FAIL.
- [ ] **Step 3: Implement.** Everything under `.cps`; `:focus-visible` outline in `--cps-accent`;
  `prefers-reduced-motion` turns off transitions; the `(pointer: coarse)` and `max-width: 48rem` rules of Global
  Constraints.
- [ ] **Step 4: Run** `npm run check` → PASS.
- [ ] **Step 5: Commit:** `"Extension: design tokens mapped to ChurchTools, Icon, Banner, Pill, StatusLine, PageHeader"`.

### Task 3: Form components

**Files:**
- Create: `ui/Field.vue`, `ui/Toggle.vue`, `ui/SecretField.vue`, `ui/ChoiceCard.vue`, `ui/LinkCard.vue`
- Test: one `*.test.ts` each

**Interfaces:**
- Produces: `<Field label help? error? :id>` wrapping its slot; sets `aria-describedby` on the control to the help and
  error ids. `<Toggle v-model label help?>` (`role="switch"`, `aria-checked`). `<ChoiceCard v-model value name label
  help?>` (radio input). `<LinkCard to icon title text pill? :pill-kind? disabled-reason?>` (a `RouterLink`, or a
  `div` with the reason when disabled).
- Produces: `<SecretField v-model? :value? label :reveal-label :hide-label :copy-label? :copied-label? readonly?
  autocomplete?>` — the eye button and/or copy button sit **inside** the field on the right edge; copy uses
  `navigator.clipboard.writeText` and shows the copied label for 2,000 ms; both buttons have `aria-label`.

- [ ] **Step 1: Failing tests:** `SecretField` toggles `type` between `password` and `text`; copy calls
  `clipboard.writeText` with the value and shows the copied label, which disappears after 2 s (fake timers); a failed
  copy keeps the original label and emits `copy-failed`. `Toggle` flips `aria-checked` on click and Space.
  `ChoiceCard` group: arrow keys move the selection. `Field` links help and error by id. `LinkCard` disabled renders
  no link and shows the reason.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run check` → PASS.
- [ ] **Step 5: Commit:** `"Extension: Field, Toggle, SecretField, ChoiceCard, LinkCard"`.

### Task 4: Dialog, person picker, page frame

**Files:**
- Create: `ui/ConfirmDialog.vue`, `ui/useConfirm.ts`, `ui/PersonPicker.vue`, `ui/PageFrame.vue`
- Test: `ui/useConfirm.test.ts`, `ui/ConfirmDialog.test.ts`, `ui/PersonPicker.test.ts`, `ui/PageFrame.test.ts`

**Interfaces:**
- Produces: `useConfirm(): (options: ConfirmOptions) => Promise<ConfirmResult>` with
  `ConfirmOptions = { title: string; text: string; confirmLabel: string; cancelLabel: string; danger?: boolean;
  field?: { label: string; type: 'password'|'text'; mustEqual?: string } }` and
  `ConfirmResult = { confirmed: false } | { confirmed: true; value?: string }`. One global `<ConfirmDialog/>` in
  `App.vue` renders the pending request.
- Produces: `<PersonPicker :search="(query: string) => Promise<PersonOption[]>" v-model:selected label placeholder
  empty-text>` with `PersonOption = { id: number; name: string; detail?: string }`; debounce 250 ms; listbox with
  `aria-activedescendant`, Up/Down/Enter/Escape.
- Produces: `<PageFrame mode: 'card'|'sidebar' :nav="NavItem[]" :nav-label>` with `NavItem = { to: string; label:
  string; icon: IconName; bottom?: boolean }`; `card` = centered card, no navigation; `sidebar` below 48rem becomes a
  `<select>`-style dropdown at the top; the active entry has `aria-current="page"`.

- [ ] **Step 1: Failing tests:** dialog has `role="alertdialog"`, `aria-modal="true"`; focus starts on cancel for
  `danger`, on confirm otherwise; Tab is trapped; Escape resolves `{confirmed: false}`; focus returns to the opener;
  with `field.mustEqual`, confirm stays disabled until the typed text matches. Picker: debounced (one search call for
  fast typing), keyboard selection, empty text when no hit, a rejected search shows the error slot. Frame: `card` has
  no `nav`; `sidebar` renders entries with `bottom` after the spacer.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run check` → PASS.
- [ ] **Step 5: Commit:** `"Extension: confirm dialog, person picker, page frame"`.

### Task 5: Languages

**Files:**
- Create: `src/i18n/index.ts`, `i18n/de.ts`, `i18n/en.ts`, `i18n/language.ts`, `i18n/custom-texts.ts`
- Test: `i18n/language.test.ts`, `i18n/keys.test.ts`, `i18n/custom-texts.test.ts`, `src/guards/no-bare-text.test.ts`

**Interfaces:**
- Produces: `SUPPORTED = ['de', 'en'] as const`, `type Language`; `pickLanguage(preferred: readonly string[]): Language`;
  `createAppI18n(language: Language)` (vue-i18n, `legacy: false`, `de` as the type source of `en`).
- Produces: `type PageTextsInput = Partial<Record<Language, { title?: string; intro?: string }>>` (Task 7's
  `SettingsTexts` must stay assignable to it) and
  `pageTexts(texts: PageTextsInput | undefined, language: Language): { title: string; intro: string }` — the
  custom text if non-empty after trimming, else the default of spec 4.6 (exact strings from the spec table).

- [ ] **Step 1: Failing tests:** `pickLanguage(['de-AT','en'])` → `de`; `['fr-FR','en-GB']` → `en`; `['fr']` → `en`;
  `[]` → `en`. `keys.test.ts`: same nested keys in `de` and `en`. `pageTexts` with `{de:{title:'  '}}` → default title;
  with a title → it. `no-bare-text.test.ts` parses every `.vue` template under `src/` (except `ui/`) with
  `@vue/compiler-dom` and fails on text nodes with letters outside `{{ }}`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Message keys are grouped by page (`app`, `password`, `manage`, `settings`, `rules`,
  `texts`, `access`, `clients`, `backendStatus`, `about`, `problems`, `common`). Texts are written when the pages
  need them (Tasks 11–16); this task adds `common` and the keys the frame uses.
- [ ] **Step 4: Run** `npm run check` → PASS.
- [ ] **Step 5: Commit:** `"Extension: vue-i18n with German and English, browser language, custom page texts"`.

### Task 6: ChurchTools layer and its fake [security-critical]

**Files:**
- Create: `src/ct/client.ts`, `ct/api.ts`, `ct/types.ts`, `ct/errors.ts`, `src/dev/fake-churchtools.ts`
- Test: `ct/client.test.ts`, `ct/contract-cases.ts`, `ct/fake.contract.test.ts`

**Interfaces:**
- Produces: `instanceBaseUrl(): string` (`window.settings.base_url` inside ChurchTools, `location.origin` otherwise);
  `retryAfterMs(response): number` (seconds or HTTP date, at least 60,000); `class NotAuthenticatedError`,
  `class CtForbiddenError { missing?: string }`, `class CtRateLimitedError { retryAfterMs }`.
- Produces: `interface CtApi` with `whoami(): Promise<{ id: number; firstName: string; lastName: string }>`;
  `globalPermissions(): Promise<Permissions>`; `moduleId(key: string): Promise<number | null>` (`400` → null);
  `categories(moduleId)`; `values(moduleId, categoryId)`; `createValue / updateValue / deleteValue`;
  `groupMembers(groupId: number): Promise<PersonOption[]>`; `group(groupId): Promise<{ id; name; memberCount }>`;
  `person(id): Promise<PersonOption>`. `createCtApi(): CtApi` (real, via `@churchtools/churchtools-client`) and
  `createFakeChurchTools(seed: FakeCtSeed): CtApi & FakeControls` (in-memory; `FakeControls` sets the current person,
  permissions, groups, `failNext(status)`).
- Produces: `ct/contract-cases.ts`: `defineCtContract(name: string, make: () => Promise<CtApi & { knownPersonId: number;
  knownGroupId: number; moduleKey: string }>)` — the cases are written once and run in `fake.contract.test.ts` and
  in Task 18 against the test instance.

- [ ] **Step 1: Failing tests:** contract cases: anonymous `whoami` (id −1 or 0) throws `NotAuthenticatedError`;
  unknown module key → `null`; categories without `view custom category` are absent; value CRUD round trip; group of
  which the person is a member is readable, another → `CtForbiddenError`. Client: `retryAfterMs` for `'120'`, an HTTP
  date, `'5'` (→ 60,000).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** `api.ts` documents each measured quirk in a doc comment (from `ct-extension-info.md`).
- [ ] **Step 4: Run** `npm run check` → PASS.
- [ ] **Step 5: Commit:** `"Extension: ChurchTools API layer with an in-memory fake and shared contract cases"`.

### Task 7: KV store, schemas and layout detection [security-critical]

**Files:**
- Create: `src/store/kv.ts`, `store/churchtools-kv.ts`, `store/memory-kv.ts`, `store/repository.ts`,
  `src/model/schemas.ts`, `model/layout.ts`, `model/errors.ts`
- Test: `store/repository.test.ts`, `model/schemas.test.ts`, `model/layout.test.ts`

**Interfaces:**
- Produces: `interface KvBackend` (categories by name, values, create/update/delete; mirrors the API), `MemoryKv`
  (`failFromWrite?: number`, records writes).
- Produces valibot schemas and types: `SettingsV2`, `AccessV2`, `MachineClient`, `SettingsTexts` (spec 6.1, with the
  limits of Global Constraints; `machineClients[].id` `^[a-z0-9-]{3,40}$`; `publicKeys` decode to 32 bytes).
- Produces: `class ExtensionStore(kv: KvBackend)` with `readSettings(): Promise<Read<SettingsV2>>`,
  `readAccess(): Promise<Read<AccessV2>>`, `saveSettings(next: SettingsV2, expectedRevision: number): Promise<void>`,
  `saveAccess(…)`; `type Read<T> = { state: 'missing' } | { state: 'invalid'; issues: string[] } | { state: 'newer';
  schema: number } | { state: 'ok'; value: T; valueId: number; duplicates: number }`.
- Produces: errors `ConflictError { current: number }`, `ValueTooLargeError`; `isOldLayout(settingsRaw: unknown,
  categoryNames: string[]): boolean` (spec 6.3).

- [ ] **Step 1: Failing tests:** tolerant read keeps unknown fields and writes them back; strict write rejects
  `passwordLength` 11 and 65 and a 61-character title; a value over 10,000 characters → `ValueTooLargeError` before
  any write (`MemoryKv` records no write); stale `expectedRevision` → `ConflictError`; save raises `revision` by 1;
  duplicates: read returns the highest value ID, save deletes the others; `schema: 3` → `newer`;
  `isOldLayout` true for `{adminUsers: []}` without `schema`, for `{readAccessUsers: []}`, for a `setupCompleted`
  category; false for a v2 value.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run check` → PASS.
- [ ] **Step 5: Commit:** `"Extension: KV repository with v2 schemas, revisions and old-layout detection"`.

### Task 8: Backend client, Problem Details and the fake backend [security-critical]

**Files:**
- Create: `src/backend/http.ts`, `backend/api.ts`, `backend/problems.ts`, `src/dev/fake-backend.ts`,
  `backend/contract-cases.ts`
- Test: `backend/problems.test.ts`, `backend/http.test.ts`, `backend/fake.contract.test.ts`,
  `src/guards/problem-coverage.test.ts`

**Interfaces:**
- Produces: `class BackendProblem extends Error { slug: string; status: number; detail?: string; violations?:
  string[]; retryAfter?: number }`, `class BackendUnreachable`, `class UnexpectedResponse { status }`;
  `problemMessageKey(error): string` (spec 8.2 table → i18n keys under `problems.*`).
- Produces: `interface BackendApi` with `login(code, codeVerifier, redirectUri): Promise<LoginResult>`
  (`{ accessToken; expiresIn; admin: boolean; version: string }`), `getEntry(personId): Promise<'set' | 'none'>`,
  `putEntry(personId, body: { primaryPwd?: string; secondaryPwd?: string }): Promise<{ generated?: string }>`,
  `deleteEntry(personId, primaryPwd?: string): Promise<void>`, `selfTest(write?: boolean): Promise<SelfTestResult>`.
  `createBackendApi(baseUrl: string, token: () => string | null): BackendApi`; `backendBase(url: string): string`.
- Produces: `createFakeBackend(options): BackendApi & FakeBackendControls` implementing backend spec 4.3–4.9 for
  persons (policy, primary password, problem types, `admin`, `version`).

- [ ] **Step 1: Failing tests:** `backendBase('https://x.example/pw/')` → `https://x.example/pw/v1`; non-JSON error
  body → `UnexpectedResponse`; `TypeError` from `fetch` → `BackendUnreachable`; abort after 15 s (fake timers) →
  `BackendUnreachable`; `password-invalid` keeps `violations`; `retryAfter` parsed. Contract cases (fake now, real in
  Task 18): `200`/`204`/`404 entry-not-found`, `password-invalid` with `violations`, `primary-password-required`,
  `invalid-primary-password`, login shape. `problem-coverage.test.ts` reads `../backend/docs/problems.md`, collects
  every `#slug` heading, and fails for a slug without a `problemMessageKey` mapping.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run check` → PASS.
- [ ] **Step 5: Commit:** `"Extension: backend client with Problem Details, fake backend and shared contract cases"`.

### Task 9: Login, session and renewal [security-critical]

**Files:**
- Create: `src/backend/pkce.ts`, `backend/auth.ts`, `src/app/useSession.ts`, `src/views/AuthCallbackView.vue`
- Test: `backend/pkce.test.ts`, `backend/auth.test.ts`, `app/useSession.test.ts`

**Interfaces:**
- Produces: `createPkce(): Promise<{ verifier: string; challenge: string }>` (43–128 chars, S256 base64url);
  `authorizeUrl(origin, clientId, redirectUri, state, challenge): string`.
- Produces: `class Auth` with `startPageLogin(returnPath: string): never` (stores `{state, verifier, returnPath}` under
  `sessionStorage['cps-login']`, then `location.assign`), `completePageLogin(query): Promise<string /* returnPath */>`,
  `loginInPopup(): Promise<void>` (opens the callback in a popup; resolves on a matching `postMessage`; rejects
  `PopupBlocked` or `PopupClosed`), `token(): string | null`, `expiresInMs(): number`, `clear()`. Token stored as
  `sessionStorage['cps-token'] = {accessToken, expiresAt, admin, version}`.
- Produces: `useSession()` → `{ admin: Ref<boolean>, backendVersion: Ref<string | null>, ensureFresh(): Promise<void>
  (renew via popup if < 120 s; must be called in a click handler), call<T>(fn: () => Promise<T>): Promise<T> (on
  401 token-expired: popup login, then fn once more), needsRenewal: Ref<boolean> (true after PopupBlocked) }`.

- [ ] **Step 1: Failing tests:** callback with a wrong `state` throws and stores no token; the popup message from
  another origin is ignored; a matching message triggers `login()` with the opener's verifier; `call()` retries exactly
  once on `token-expired` and not on `forbidden`; a blocked popup sets `needsRenewal` and keeps the caller's input
  (the promise rejects with `PopupBlocked`, nothing is reset); `invalid-token` with no unsaved input starts a page
  login, with unsaved input sets `needsRenewal`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** The callback view: in a popup, `postMessage({code, state}, location.origin)` and
  `window.close()`; as a page, `completePageLogin` then `router.replace(returnPath)`.
- [ ] **Step 4: Run** `npm run check` → PASS.
- [ ] **Step 5: Commit:** `"Extension: OAuth login with PKCE, callback route, popup renewal and retry"`.

### Task 10: Password rules and the password flow [security-critical]

**Files:**
- Create: `src/password/rules.ts`, `password/flow.ts`, `shared/password-policy-cases.json` (repository root)
- Modify: `backend/tests/Unit/Domain/PasswordPolicyTest.php` (reads the shared cases)
- Test: `password/rules.test.ts`, `password/flow.test.ts`

**Interfaces:**
- Produces: `type Rule = 'too-short' | 'too-long' | 'missing-letter' | 'missing-digit' | 'missing-symbol' |
  'invalid-character'` (the backend's `violations` codes); `checkPassword(pw: string, minLength: number): Rule[]`;
  `SYMBOLS = '!@$%&*-_+=?.'`.
- Produces: `type FlowState = { step: 'overview' } | { step: 'choose'; mode: 'generate' | 'custom' } | { step:
  'result'; generated?: string }`; `nextAfterOverview(settings): 'choose' | 'generate-now'` (generate-now iff
  `!allowCustomPassword && !requirePasswordForPasswordChange`); `canSubmit(state, input, settings): { ok: boolean;
  reason?: string /* i18n key */ }`.
- Shared cases file: `[{ "password": "...", "minLength": 14, "violations": ["missing-digit"] }, …]` with at least the
  boundaries 13/14/128/129 characters, each missing class, a space, a tab, `ä`, `#`, `€`, an emoji, and a trailing
  newline.

- [ ] **Step 1: Failing tests:** `rules.test.ts` iterates the shared cases; `rules flags a trailing space as
  invalid-character`; `flow.test.ts`: generate-now for (false, false) and choose for the other three combinations;
  `canSubmit` false for custom without a valid password, for a required but empty primary password.
  `PasswordPolicyTest` iterates the same JSON (the backend's `PasswordPolicy::violations()` must return the listed
  codes).
- [ ] **Step 2: Run** `npx vitest run src/password` and `composer test -- --filter PasswordPolicyTest` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run check` and `composer check` in `backend/` → PASS.
- [ ] **Step 5: Commit:** `"Extension: password rules mirrored from the backend with shared test cases; flow logic"`.

### Task 11: App state, routes and frame [security-critical]

**Files:**
- Create: `src/app/app-state.ts`, `app/useAppState.ts`, `app/version.ts`, `app/services.ts`, `src/router.ts` (all
  routes of spec 4.1), `views/NotFoundView.vue`, `views/WaitingView.vue`, `views/StateView.vue` (no-access,
  update-needed, backend-error, version-mismatch), placeholder views for Tasks 12–16
- Modify: `App.vue` (frame by role + `<ConfirmDialog/>`), `main.ts`
- Test: `app/app-state.test.ts`, `app/version.test.ts`, `src/app.test.ts` (app layer, mounted)

**Interfaces:**
- Consumes: `CtApi`, `ExtensionStore`, `Auth`, `BackendApi` (Tasks 6–9).
- Produces: `type AppState = 'loading' | 'no-access' | 'migration-needed' | 'update-needed' | 'setup-needed' |
  'backend-error' | 'version-mismatch' | 'user' | 'admin'`; `computeAppState(inputs): AppState` (pure, rows of spec
  3.2 in order); `sameMajorMinor(a: string, b: string): boolean` (ignores `+…`).
- Produces: `provideServices(services: Services)` / `useServices()` with `Services = { ct: CtApi; store:
  ExtensionStore; auth: Auth; backend: (baseUrl: string) => BackendApi; language: Language }` — the app gets real or
  fake services from `main.ts`; tests mount with fakes.
- Produces: `settingsEditor: { settings: boolean; access: boolean }` from `globalPermissions` (spec 3.1 row 3).
- Produces: `setupCapable: boolean` = `ctpassstore['create custom category'] === true`. Provisional: the wizard spec
  replaces it with its full list of rights. In `setup-needed` and `migration-needed`, everyone sees the waiting text;
  setup-capable people additionally see that the new setup assistant comes with the next version (spec 5.2).

- [ ] **Step 1: Failing tests:** `computeAppState` one case per row of spec 3.2, plus precedence (old layout beats a
  missing `backendUrl`); `sameMajorMinor('0.1.3','0.1.0+abc-dirty')` true, `('0.2.0','0.1.9')` false. App test:
  normal user → card frame, no nav; admin → sidebar with the four entries; settings editor with failed backend login →
  `backend-error` with a link to `/settings/backend`; unknown path → not-found with a link to `/`; the user card has a
  footer link to `/about` (spec 4.1); setup-capable people in `setup-needed` see the extra note, others only the
  waiting text.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run check` → PASS. Manual: deploy the build to the test instance and open
  `/ccm/ctpassstore/settings/rules` directly; it must load the app (spec 14.2). Record the result in
  `ct-extension-info.md` section 2.
- [ ] **Step 5: Commit:** `"Extension: app state from spec 3.2, routes, frame by role"`.

### Task 12: „Mein Passwort“ [security-critical]

**Files:**
- Create: `src/views/PasswordView.vue`, `src/password/PasswordFlow.vue` (states 2 and 3, reused by Task 13),
  `password/usePasswordEntry.ts`
- Modify: `i18n/de.ts`, `i18n/en.ts` (`password.*`, texts exactly as spec 4.2)
- Test: `views/PasswordView.test.ts` (app layer)

**Interfaces:**
- Produces: `<PasswordFlow :person-id :for-name? :settings :has-entry @done>` — `for-name` set means admin mode
  (warning banner and confirm dialog, Task 13).
- Produces: `usePasswordEntry(personId)` → `{ status: Ref<'loading'|'set'|'none'|'error'>, reload(), generate(primaryPwd?),
  setCustom(pw, primaryPwd?), remove(primaryPwd?) }`.

- [ ] **Step 1: Failing tests** (fakes): pill text for `set` and `none`; no delete button for users; hint
  „Dein bisheriges Passwort funktioniert danach nicht mehr.“ only when an entry exists; direct path generates on click
  and shows state 3; „Selbst wählen“ absent when not allowed; rules tick live; result shows the password with a copy
  button inside the field and the warning banner; „Fertig“ clears the plaintext; `invalid-primary-password` shows at
  the field; `password-invalid` marks the returned rules; `too-many-attempts` shows minutes from `retryAfter`;
  `timeout on generate warns that the outcome is unknown`; `token expiry does not clear the shown password`; blocked
  popup shows „Sitzung erneuern“ and keeps the typed password.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** `ensureFresh()` runs in the click handlers of „Neues Passwort festlegen“ and the submit
  button; requests go through `session.call()`.
- [ ] **Step 4: Run** `npm run check` → PASS.
- [ ] **Step 5: Commit:** `"Extension: Mein Passwort with direct path, choice, rules and one-time result"`.

### Task 13: „Passwörter verwalten“ [security-critical]

**Files:**
- Create: `src/views/ManageView.vue`, `src/admin/manage.ts`
- Test: `views/ManageView.test.ts`

**Interfaces:**
- Consumes: `PasswordFlow`, `usePasswordEntry`, `PersonPicker`, `CtApi.groupMembers`, `AccessV2.groups.users.groupId`.
- Produces: `searchUsers(members: PersonOption[], query: string): PersonOption[]` (case- and accent-insensitive on
  name parts; members loaded once per page visit).

- [ ] **Step 1: Failing tests:** search finds „Müller“ for „mul“ and „Mül“; only members of the users group are offered;
  `/manage/:personId` restores the selection after reload; the warning banner „Du legst gerade das Passwort für
  {name} fest.“ is shown above the flow; with an entry, a confirm dialog naming the person comes before sending;
  „Löschen“ is a danger dialog with focus on „Abbrechen“ and, when required, the admin's password field inside it;
  `person-not-found` shows its text; selecting oneself shows the normal flow without banner; missing „view group“ right
  shows a banner naming it.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run check` → PASS.
- [ ] **Step 5: Commit:** `"Extension: Passwörter verwalten with search in the users group, banner and confirmations"`.

### Task 14: Settings overview, rules and texts [security-critical]

**Files:**
- Create: `src/views/settings/SettingsView.vue`, `settings/RulesView.vue`, `settings/TextsView.vue`,
  `src/admin/useSettingsForm.ts`
- Test: `views/settings/RulesView.test.ts`, `TextsView.test.ts`, `SettingsView.test.ts`

**Interfaces:**
- Produces: `useSettingsForm<T>(load: () => Promise<Read<T>>, save: (value: T, revision: number) => Promise<void>)` →
  `{ value, dirty, saving, savedAt, error, conflict, save(), discard() }` plus a router leave guard asking via
  `useConfirm` when `dirty`.

- [ ] **Step 1: Failing tests:** overview cards as spec 4.4 (Sicherung and Einrichtung hidden for non-setup-capable
  admins; cards without the right disabled with the reason; the Backend & Status pill shows ✓ for a passing
  `selfTest()` and „⚠ 2 Probleme“ for two failed checks; the Zugriff pill shows the number of machine clients); Save and Discard disabled until a change; „Gespeichert“
  with `role="status"`; `second save with a stale revision reports a conflict`; leaving with changes asks; length
  field rejects 11 and 65; texts show the default under each empty field and count characters to 60/300.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run check` → PASS.
- [ ] **Step 5: Commit:** `"Extension: settings overview, Passwortregeln and Texte with conflict detection"`.

### Task 15: „Zugriff“ and machine clients [security-critical]

**Files:**
- Create: `src/views/settings/AccessView.vue`, `settings/ClientFormView.vue`, `src/admin/machine-clients.ts`
- Test: `admin/machine-clients.test.ts`, `views/settings/AccessView.test.ts`, `ClientFormView.test.ts`

**Interfaces:**
- Produces: `slugFromName(name: string): string` (lowercase ASCII, umlauts transliterated, other characters → `-`,
  trimmed to 40, at least 3 or empty); `parsePublicKey(text: string): Uint8Array | null` (base64 or base64url, exactly
  32 bytes); `validateClients(clients: MachineClient[]): ClientIssue[]` (duplicate `id`, shared key, empty keys —
  backend spec 3.2).

- [ ] **Step 1: Failing tests:** `slugFromName('WLAN RADIUS')` → `wlan-radius`, `('Ü')` → `''`; keys of 31 and 33
  bytes rejected; the same key in two clients flagged for both; the access page shows the warning banner, the users and
  admins groups with name and member count and „In ChurchTools öffnen ↗“; „Gruppe ändern“ is shown disabled with the
  hint that it comes with the setup assistant (spec 12.6); a deleted group shows the error; removing a client asks
  with „Wirkt innerhalb von 5 Minuten.“; the ID can't be edited after creation.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run check` → PASS.
- [ ] **Step 5: Commit:** `"Extension: Zugriff with groups and machine clients"`.

### Task 16: Backend & Status, Über [security-critical]

**Files:**
- Create: `src/views/settings/BackendView.vue`, `src/views/AboutView.vue`, `src/admin/backend-url.ts`,
  `src/app/links.ts`
- Test: `admin/backend-url.test.ts`, `app/links.test.ts`, `views/settings/BackendView.test.ts`,
  `views/AboutView.test.ts`

**Interfaces:**
- Produces: `normalizeBackendUrl(input: string): { ok: true; url: string } | { ok: false; reason: 'not-https' |
  'credentials' | 'query' | 'fragment' | 'invalid' }`.
- Produces: `guideUrl(version: string): string`, `releaseUrl(version)`, `licenseUrl(version)` — tag
  `extension-v<x.y.z>` for a clean version, `main` for `+sha` builds; repository `https://github.com/lub90/ct-pass-store`.

- [ ] **Step 1: Failing tests:** `backend url rules` (`https://a.example/` → `https://a.example`; `http://…`, with
  `user@`, `?x`, `#y` rejected); `guideUrl('0.1.0')` contains `/blob/extension-v0.1.0/`, `guideUrl('0.1.0+abc')` contains
  `/blob/main/`; self-test list with ok/fail dots; the write test needs its own button; About shows both versions,
  „© 2025 Lukas Block · MIT-Lizenz“ linked to `LICENSE` at the tag, and the third-party license link.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run check` → PASS.
- [ ] **Step 5: Commit:** `"Extension: Backend & Status with self-test, Über with versioned links"`.

### Task 17: Demo mode and real mode for development [security-critical]

**Files:**
- Create: `src/dev/demo-data.ts`, `src/dev/services.ts`
- Modify: `main.ts`, `vite.config.ts`, `extension/README.md` (development section), `extension/docs/development.md`

- [ ] **Step 1: Failing test:** `npm run build` output contains none of the demo data strings (extend `check-dist`
  with the marker `__DEMO__` that `demo-data.ts` contains).
- [ ] **Step 2: Run** → FAIL (if the demo branch isn't tree-shaken).
- [ ] **Step 3: Implement:** `import.meta.env.DEV && import.meta.env.MODE !== 'real'` selects `dev/services.ts`
  (fakes with invented data, persisted in `localStorage`, a small floating switch for user/admin/states); `--mode real`
  uses the proxy and the configured backend URL. Credential files are created with mode `600` (documented).
- [ ] **Step 4: Run** `npm run check` → PASS; `npm run dev` shows the password card with demo data.
- [ ] **Step 5: Commit:** `"Extension: demo mode by default, real mode through the dev proxy"`.

### Task 18: Contract layer against ChurchTools and the backend [security-critical]

**Files:**
- Create: `extension/tests/contract/ct.contract.test.ts`, `tests/contract/backend.contract.test.ts`,
  `tests/contract/setup.ts`, `tests/contract/oauth-code.ts`, `scripts/sanitize-fixture.js`,
  `vitest.contract.config.ts`

**Interfaces:**
- Consumes: `defineCtContract` (Task 6), the backend contract cases (Task 8), the OAuth steps of
  `OAuthCodeFetcher` (backend plan Task 2), ported to Node.

- [ ] **Step 1:** `setup.ts` aborts with a message naming every missing variable (`CT_BASE_URL`, `CT_ADMIN_USER`,
  `CT_ADMIN_PASSWORD`, `CT_TEST_USER`, `CT_TEST_PASSWORD`, `BACKEND_URL`) — the suite is never reported as passed
  without them.
- [ ] **Step 2:** Run the shared cases against the real instance and the real backend (needs the backend plan done).
  Recorded responses go to `tests/contract/fixtures/` only after `sanitize-fixture.js` (names, host, tokens, hashes).
- [ ] **Step 3: Run** `npm run test:contract` → PASS against the test instance. Any difference from the fakes is fixed
  in the fake (and in `ct-extension-info.md` if it's new behavior), never by loosening the case.
- [ ] **Step 4: Commit:** `"Extension: contract layer keeps the fakes honest against ChurchTools and the backend"`.

### Task 19: Browser tests

**Files:**
- Create: `extension/playwright.config.ts`, `extension/e2e/password.spec.ts`, `e2e/admin.spec.ts`,
  `e2e/layout.spec.ts`, `e2e/docs-screenshots.spec.ts`

- [ ] **Step 1:** Specs against `npm run dev` in demo mode, Chromium and WebKit, at 1280 px and 375 px:
  generate and copy a password; admin sets someone else's password (banner, confirm); `layout.spec.ts` asserts
  `document.documentElement.scrollWidth <= innerWidth` on every route, every button and input at least 44 px high under
  `hasTouch`, input font size 16 px at 375 px; dialog focus trap and Escape.
- [ ] **Step 2: Run** `npm run test:browser` → PASS. Screenshots go to `extension/docs/images/`.
- [ ] **Step 3: Commit:** `"Extension: browser tests for flows, phone layout and documentation screenshots"`.

### Task 20: CI, release and user guide

**Files:**
- Create: `.github/workflows/extension.yml`, `.github/workflows/extension-release.yml`,
  `extension/scripts/release-check.js` (+ test), `extension/docs/user-guide.md`
- Modify: `extension/CHANGELOG.md`, root `README.md`, `TODO.md`

- [ ] **Step 1: Failing test** for `release-check.js`: tag `extension-v0.1.0` = `package.json` = `package-lock.json` =
  a dated `## [0.1.0] - YYYY-MM-DD` section, and `MAJOR.MINOR` = `backend/VERSION`; each mismatch fails with a message
  naming it.
- [ ] **Step 2: Run** `npx vitest run scripts/release-check.test.js` → FAIL.
- [ ] **Step 3: Implement** `release-check.js`; run the test again → PASS.
- [ ] **Step 4:** CI job `extension` (`permissions: contents: read`): `npm ci` → lint → typecheck → test → build →
  build check → `npm audit --audit-level=high`. Release workflow on `extension-v*.*.*`: release check, build, ZIP, GitHub
  release with the CHANGELOG section as notes.
- [ ] **Step 5:** `CHANGELOG.md` `0.1.0`: new design, login through ChurchTools, admins through a group, both
  languages; and the note that the minimum password length is now 12, that existing passwords keep working, and that
  users may want to set a new one. User guide: pages, phone use, the versioning sentence of `versioning.md` section 4,
  screenshots from Task 19.
- [ ] **Step 6: Run** `npm run check` → PASS. **Commit:** `"Extension: CI, release workflow, CHANGELOG and user guide"`.

## Review point B, round 1 — follow-up tasks (2026-11-14)

Added from the end-of-branch reviews (Superpowers final review, security-reviewer, test-reviewer full depth). Each runs
with subagent-driven development, TDD and the per-task reviews like the tasks above.

### Task 21: Duplicate settings and access values fail closed [security-critical]

**Files:** Modify `src/store/repository.ts`, `src/app/useAppState.ts`, settings pages / `SettingsFormPage.vue`,
`specs/extension-spec.md` 6.2, `specs/ct-extension-info.md`.

- [ ] Normal users: a `settings` or `access` category with more than one value reads like the backend reads it (fail
  closed: no backend login, nothing sent; a clear state for admins/editors). Never let the newest id win silently.
- [ ] Editors and admins see the duplicates (plain text, cut, isolated) and choose which value stays before any save
  deletes the others; a save never deletes unseen values. Revision- and id-guarded.
- [ ] Spec 6.2 says what was built; ct-extension-info.md records the 2026-11-14 CSRF measurement (cookie SameSite=None;
  cross-site text/plain form refused with 401 „CSRF-Token is invalid“; same-origin JSON needs no token).
- [ ] Commit: `"Extension: duplicate settings and access values fail closed and are shown to editors"`.

### Task 22: Backend audit trail and shared-fixture CI [security-critical]

**Files:** `backend/src/Application/SetPassword.php`, `DeletePassword.php`, `Application/Auth/MachineTokens.php`,
the access/settings cache refresh, `.github/workflows/backend.yml`, backend tests, backend CHANGELOG.

- [ ] On success, log at `info` „<principal> set|deleted the password of person <target>“ (ids only, never a password).
- [ ] On each `access` refresh, log at `notice` when the set of enabled machine clients (ids, permissions, key
  fingerprints) differs from the last one seen; a rate-limited usage summary per client (e.g. first use per hour with id,
  address, request count).
- [ ] Log at `notice` when the parsed `backendUrl` differs from the last one seen.
- [ ] `backend.yml` also runs on `shared/**`.
- [ ] Commit: `"Backend: audit log for admin changes, machine clients and the backend address; CI on shared fixtures"`.

### Task 23: Page-level hardening and test gaps [security-critical]

**Files:** `ui/PersonPicker.vue`, `password/PasswordFlow.vue`, `views/settings/BackendView.vue`, tests across
`src/`, `vitest.config.ts`, `playwright.config.ts`, `scripts/check-dist.js`.

- [ ] Person names isolated (`<bdi>` / U+2068–2069) in the picker, the replace dialog text and the banner.
- [ ] Settings pages in `backend-error`: app tests that a settings editor can open Backend & Status, save a new address
  through the danger dialog, and that Rules and Access render their forms (spec 3.1.2).
- [ ] BackendView registers its unsaved address with `trackUnsaved`; a self-test after `invalid-token` settles.
- [ ] Test gaps: 2xx with a non-JSON content type refused; `latest++` in `usePasswordEntry.change()` pinned or removed;
  the overview's own rights check; check-dist refuses zero bundles and pins the 8-character secret boundary;
  ConfirmDialog Escape `stopPropagation`; „Sitzung erneuern“ success then the next submit is sent; the 50 ms race in
  `services.test.ts`; unit config `passWithNoTests: false`; Playwright output folder per run.
- [ ] Commit: `"Extension: isolated person names, backend-error settings tests and remaining test gaps"`.

### Task 24: Contract variants and one instance run [security-critical]

**Files:** `tests/contract/backend.contract.test.ts`, `tests/contract/backend-sandbox.ts`.

- [ ] Run the backend subject in both settings variants (primary password required on/off, custom passwords on/off)
  through a sandbox-side settings override — never by changing the instance's settings.
- [ ] One `npm run test:contract` run against the instance (also covers the preflight change of 2620400); cleanup
  verified.
- [ ] Commit: `"Extension: contract cases in both settings variants against the real backend"`.

### Task 25: Release pipeline hardening

**Files:** `.github/workflows/*.yml`, `.gitleaks.toml`, `extension/docs/development.md`.

- [ ] Pin actions by commit SHA (at least in the release workflows, with the version in a comment).
- [ ] Publish the release ZIP's SHA-256 (and, if cheap, a build-provenance attestation).
- [ ] Narrow the source-file allowlists in `.gitleaks.toml` to the invented values (`condition = "AND"` + regexes).
- [ ] Commit: `"CI: SHA-pinned actions, release checksum, narrower gitleaks exceptions"`.

### Task 26: Docs and spec match what was built

**Files:** `specs/extension-spec.md`, `extension/docs/*.md`, `extension/CHANGELOG.md`, `backend/CHANGELOG.md`, root
`README.md`, `TODO.md`, `src/i18n/*`, small code tidy-ups.

- [ ] Spec: header status; mark the wizard-dependent parts as deferred (5.1/12.3, 13.4.6, 16.3/16.4, 13.1 WebKit
  pending); 4.7 status-dot wording; 4.8 settings-right rule; 13.2 reference; E15 heading names the settings editors.
- [ ] Docs: setup.md and README describe the current install (no wizard yet, release ZIP); CHANGELOG and user guide say
  the browser language; CHANGELOGs don't promise a migration this version doesn't ship (release waits for the wizard);
  user guide: review machine clients when an admin leaves.
- [ ] Texts: no dead-end pointers to „Einrichtung“ while it is a placeholder (or hide the cards); placeholder wording for
  users; remove unused i18n keys and duplicate texts; consistent apostrophes; fix the intlify parent-scope warning.
- [ ] Tidy-ups: one callback-path matcher; one trailing-slash helper; stale comments; stale TODO items; the
  `inlineDynamicImports` deprecation.
- [ ] Commit: `"Docs and spec describe what 0.1.0 contains; texts and small tidy-ups"`.
