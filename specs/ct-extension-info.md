# ChurchTools Extensions – Platform Notes

Practical knowledge about how ChurchTools extensions (a.k.a. "custom modules") behave, for anyone building one.
Most of it was observed on ChurchTools 3.136 (build 32882, 2026). ChurchTools doesn't document much of this, and it
may change between versions, so verify anything critical against your own instance.

---

## 1. Ground rules for investigating ChurchTools behaviour

- **A `404` from the API proves nothing.** Routes you're not allowed to use are invisible. Always test while logged
  in, with sufficient permissions, before concluding that something doesn't exist.
- **An empty list doesn't prove that nothing exists.** Missing permissions often produce an empty list rather than an
  error.
- **The OpenAPI spec is filtered per user.** It only shows endpoints the current user may call. Even as an admin with
  the feature enabled, the spec may contain the `CustomModule*` schemas but no `/custommodules` paths at all, so
  those types have to be written by hand.
- **Check the ChurchTools Academy first** (https://churchtools.academy) for rules, then measure against the instance.
  The API shows states; the docs show rules.
- **Test against a dedicated test instance, not the demo and not production.** ChurchTools provides developer instances
  free of charge while an extension is being developed, but charges for them if they're used productively.

## 2. Packaging, installing, updating, deleting

- The build output (`dist/`) is zipped with `dist/` as the top-level folder and uploaded under
  **System settings → Extensions → Add extension** (or `<instance>/custom/modules/overview`). There you set name,
  shorty (= extension key), description and sort index. The menu label comes from this form, not from the extension.
- The extension is served under `/ccm/<extension-key>/`. Set Vite's `base` accordingly.
- The instance must have custom modules enabled: `GET /api/config` contains `feature_custommodule: "1"`. On some
  instances ChurchTools has to enable it on request.
- Managing extensions requires the separate permission **"administer custom modules"**. "administer settings" or
  "administer persons" isn't enough (`POST /custommodules` then returns `401`).
- **Update = Edit + upload the new ZIP to the existing module.** This keeps all data.
- **Delete + reinstall is NOT an update.** Deleting an extension removes:
  - all its categories and data values
  - its permissions on every role, including permissions an admin assigned manually
  - its entry in the permission catalog
  - the uploaded ZIP

  A reinstall under the same key gets a **new module ID** and starts empty. Plain ChurchTools objects the extension
  created (groups, wiki categories, users) stay behind.
- Deletion supports a preview: `DELETE /custommodules/{id}?dry_run=true` returns `409 "Dry Run Output"` with
  `deletable` and references; `dry_run=false` deletes (`204`).
- If your extension creates groups or other ChurchTools objects, store their IDs in its settings and offer an
  "uninstall setup" step that users must run **before** deleting the extension. Otherwise nobody knows afterwards
  which objects belonged to it.
- ChurchTools has no automatic updates from GitHub. Show the installed version somewhere in the UI.
- Build asset names carry a content hash. Browser tabs that stay open for a long time (kiosks, dashboards) will request
  files that no longer exist after an update. Prefer a single bundle without code splitting, and reload on
  module-load errors.

## 3. Runtime environment

- **No iframe.** ChurchTools renders its own page (navigation, its own Vue app, `<base href>`) and injects the
  extension's script and stylesheet into the **same document**. The extension renders in the content area below the
  main navigation.
- **CSS leaks in both directions.**
  - The host declares `@layer theme, base, oldcss, components, utilities` (Tailwind v4). Unlayered CSS beats layered
    CSS.
  - ChurchTools utility classes also apply to identically named classes inside your extension.
  - ChurchTools defines a global Vuetify theme as `:root` CSS variables. If you use Vuetify yourself, expect clashes,
    and avoid defining variables with the same names.
  - Scope your styles carefully, and don't let your styles break the host UI.
- **Host design tokens are available** as semantic CSS variables on `:root`, e.g.
  `--color-{basic|accent|info|success|warning|critical|error|…}-{primary|secondary|…}`, `--font-sans` (Lato),
  `--text-base` (14px) and `--radius-*`. A `.dark` class switches them for dark mode. Always provide fallbacks.
- **There is no public design system.** ChurchTools' internal styleguide packages aren't on npm.
- **Content Security Policy (sent as a header, also under `/ccm/`):**
  - `script-src` has **no `'unsafe-inline'`**, so the build must not emit any inline `<script>`. Watch out for things
    like Vite's modulepreload polyfill.
  - `style-src` allows `'unsafe-inline'`.
  - `img-src *`: external images work.
  - There is no `media-src`, so it falls back to `default-src 'self'`: **external videos are blocked**.
  - `child-src *`: iframes are allowed, but a `srcdoc` iframe inherits the parent CSP.
  - `connect-src *`.
- **Routing:**
  - Any unknown sub-path `/ccm/<key>/<anything>` returns `200` with the extension's `index.html`, so real history
    routes work.
  - Add a catch-all route that shows a proper error page; otherwise an unknown path renders an empty content area.
  - An unknown extension key (`/ccm/<unknown>/`) returns `404`.
  - Without the module's `view` permission, the page is served **without the extension's script**.
- **The page embeds settings** as JSON in `<script type="application/json" id="ct-settings-json">`: `base_url`,
  `files_url`, `csrfToken`, version, the module list, the current user and a copy of the permissions. **Don't read
  permissions from it.** That copy is pruned and encoded differently (objects instead of arrays, empty entries
  removed). Use the API instead.
- Use `window.settings.base_url` in production and fall back to an env variable in development.

## 4. Authentication

- **Inside ChurchTools** the extension runs within the user's session. `GET /whoami` returns the current user; no
  separate login is needed.
- **Local development:**
  - `POST /login` with credentials from `.env`, only in development mode.
  - CORS must be configured on the instance for `http://localhost:5173`. By default CORS isn't configured and
    `access_control_allow_credentials` is `false`.
  - Safari blocks the session cookie on plain `http://localhost` and across domains. Fix: a Vite dev proxy
    (`/api → https://<instance>`) plus HTTPS (e.g. mkcert). Even better: authenticate inside the proxy with a login
    token, so the browser never sees credentials.
- **Never give anything that ends up in the bundle the `VITE_` prefix unless it may be public.** Vite inlines
  `import.meta.env.VITE_*` at build time. Keep instance URLs and tokens out of `dist/`, and consider a build check that
  fails if `*.church.tools` appears in the output.
- **Login tokens:**
  - A login token is effectively a **permanent password**. It stays valid until the user's password is changed, and
    there's **no admin endpoint to revoke** a token. Changing the password in the UI invalidates it immediately.
  - A token can be obtained via `POST /api/login/token` (username/password).
  - `?login_token=<token>&user_id=<id>` on a page URL logs the browser in.
  - Treat tokens like passwords: don't pass them to third-party services, and prefer short-lived credentials where
    possible.
- **Sessions last a fixed 24 hours.** Using a session doesn't extend it, and "Remember me" doesn't either.
  Long-running clients must re-authenticate on their own.
- **A browser holds only one ChurchTools session.** Different accounts need separate browsers or profiles.
- **A failed or missing login can look like "no data".** Anonymous requests to some endpoints return empty results
  instead of `401`, so check `/whoami` explicitly.
- Checking a user's password via `POST /api/login` creates a real session each time. Rate-limit that yourself.

## 5. The key-value store (custom data)

Hierarchy: **Module → Data categories → Data values.** Each value is a JSON string.

Endpoints:

```
GET    /custommodules                                   list all modules
GET    /custommodules/{extensionKey}                    get a module by its key (see note below)
GET    /custommodules/{moduleId}
GET    /custommodules/{moduleId}/customdatacategories
POST   /custommodules/{moduleId}/customdatacategories
PUT    /custommodules/{moduleId}/customdatacategories/{categoryId}
DELETE /custommodules/{moduleId}/customdatacategories/{categoryId}
GET    /custommodules/{moduleId}/customdatacategories/{categoryId}/customdatavalues
POST   /custommodules/{moduleId}/customdatacategories/{categoryId}/customdatavalues
PUT    /custommodules/{moduleId}/customdatacategories/{categoryId}/customdatavalues/{valueId}
DELETE /custommodules/{moduleId}/customdatacategories/{categoryId}/customdatavalues/{valueId}
```

- **Finding the module:** Use `GET /custommodules/{extensionKey}` to get a module by its key; this works in practice.
  Cache the module ID and category IDs.
  - Some calls have been seen failing with `400 validation.integer` because the key was taken for a numeric ID. If
    that happens, check the exact URL your client actually sends (see the slash pitfall below).
  - Another way is to list `GET /custommodules` and filter by `shorty` on the client. That's more cumbersome, and
    possibly less secure, since it fetches every module the user can see rather than only your own.
- **Slash pitfall when joining URLs (e.g. Guzzle / the ChurchTools PHP client):** Resolving a relative path against a
  base URL follows RFC 3986.
  - The base URL must **end** with a slash (`https://<instance>/api/`). The ChurchTools PHP client's `SimpleClient`
    does this for you.
  - Paths must **not start** with a slash (`custommodules/…`, not `/custommodules/…`). A leading slash resolves against
    the domain root and silently drops `/api`.
  - Without the trailing slash on the base, the last segment (`api`) gets replaced instead.
  - Both mistakes produce wrong URLs and confusing errors rather than an obvious failure.
- A freshly installed module returns an **empty list** from `GET /custommodules` for users without module
  permissions, even admins.
- **Data model** (current builds):
  - Categories have only `customModuleId`, `name`, `shorty`, `description` and `data`. There's no schema and no
    security level.
  - Values have only `id`, `dataCategoryId` and `value`. Older type snapshots also list `domainId`, `domainType`,
    `schema` and `securityLevelId`; those fields don't exist on current builds.
- **Limits:** 10,000 characters per value, 2,000 characters for a category's `data`. Check sizes before saving.
  Binary data (images as data URIs) doesn't fit.
- **No key, no version, no ETag, no transactions, no server-side filtering.** You always read a whole category and
  filter on the client. Consequences:
  - Store your own identifier (slug or entity ID) inside the JSON; don't rely on the server `id` as a stable address.
  - Concurrent writes can create duplicates or overwrite each other silently. Put a `revision` in the JSON: read and
    compare before writing, and detect conflicts instead of overwriting blindly. Make reads tolerant of duplicates.
  - Multi-value saves aren't atomic. Order writes so that references never dangle (children first, index last).
  - Performance scales with category size. Cache, and keep categories small.
- **Validate on the client** (e.g. with a schema library), because the server doesn't.
- **Version persisted data** and migrate it on read. Readers should tolerate newer data: ignore unknown fields, skip
  unknown types.
- The extension creates its categories itself on first run (setup wizard). That needs the `create custom category`
  permission, which is only required once.
- Put all KV access behind **one repository layer**, so you can mock it in tests and absorb API changes in one place.
- **Plan for backup and restore.** Because a reinstall wipes everything, offer an export and import of all categories
  and values.

## 6. Permissions

- Read them via **`GET /api/permissions/global`** → `data[<extensionKey>]`:

  ```json
  {
    "view": true,
    "view custom category": [4, 10],
    "create custom category": false,
    "edit custom category": [],
    "delete custom category": [],
    "view custom data": [4, 10],
    "create custom data": [],
    "edit custom data": [],
    "delete custom data": []
  }
  ```

  `view` and `create custom category` are booleans; the rest are **lists of category IDs**. Missing permissions are
  `false` or `[]`, never missing keys.
- **Admin rights don't include module rights.** Right after installation **nobody** can see the extension, admins
  included, until module permissions are assigned. Say so in your setup docs.
- Permissions are **additive** across person status, groups and roles. A permission granted only through a group
  disappears when the group is deleted, which can lock out the person running the setup. Group permissions only apply
  while the group is "active".
- **Permissions can be provisioned through the API.** Groups and group-role permissions can be created and fully
  removed through the API, so a setup wizard can create the groups and assign the module permissions itself instead
  of relying on manual configuration. It should then re-check them and warn about over-privileged groups.
  - Role permissions are identified by **numeric auth IDs** (e.g. `GET /api/permissions/group_role/{id}`,
    `GET /api/groups/{id}/roles`, `PUT/DELETE /permissions/person/{id}` with `{authId}`).
  - The catalog that maps IDs to names is only available from the legacy AJAX API (`POST ?q=churchauth/ajax`,
    `func=getMasterData`).
  - Module permission IDs are assigned at install time; don't hard-code them across instances.
- `/permissions/global` may be cached briefly after changes. Other lists (e.g. `GET /groups`) can also be stale for a
  few seconds after deletes.
- Different operations need different permissions: deleting a group only needs group management rights, but updating
  the extension's settings needs `edit custom data`. **Probe whether a save is allowed before a destructive
  multi-step operation**, or you can leave inconsistent state behind.
- `GET /persons/{id}/groups` returns the group ID as a **string** in `group.domainIdentifier`.
- **The server enforces permissions**; the UI should only hide what would fail anyway. Show users which permissions
  they're missing.

## 7. API behaviour and limits

- **Rate limit: about 600 requests per minute per IP address.** Exceeding it returns `429`, with no `X-RateLimit-*`
  headers and not necessarily a `Retry-After`. Recommended handling: wait at least 60 seconds (longer if `Retry-After`
  says so), then back off exponentially.
  - The limit is **per IP**. All devices behind one NAT, or all users of one backend server, share it. Count your
    requests per operation and cache aggressively.
  - Avoid synchronized bursts: add jitter to polling, and stagger starts after an outage.
- `churchtools-client` has a built-in rate-limit interceptor (`setRateLimitInterceptor`) that retries after a fixed
  30 seconds. Make sure that fits your own timeouts.
- `churchtools-client` uses axios; arrays are encoded as `ids[]=1&ids[]=2`.
- `GET /api/config` (also anonymously) includes `timezone`; `Intl` is sufficient for time zone maths.
- `GET /api/info` returns basic church information.

## 8. Files, images, wiki

- There's **no file storage for extensions**. The workable option is a dedicated **wiki category**:
  - Upload with `POST /api/files/wiki_<categoryId>/<pageGuid>`. Wiki pages are addressed by GUID.
  - Creating a wiki category requires explicit booleans `inMenu` and `fileAccessWithoutPermission`, otherwise `400`.
  - `inMenu: false` doesn't hide the category from editors; it moves to a collapsed "Hidden" section.
  - Upload limit: 128 MB per file.
  - Videos from your own instance work, but viewers need wiki permissions.
- **Uploaded files get two URLs:**
  - `fileUrl` (`?q=public/filedownload…`) requires a login.
  - `imageUrl` (`/images/{fileId}/{hash}`) is **served anonymously, even if the category has
    `fileAccessWithoutPermission: false`**. Only the hash protects it. Treat uploaded images as effectively public.
- **The image service defaults to 150×150.** `w` or `h` alone overrides only one side. Always pass **both `w` and `h`**,
  plus `fit` (`max`/`contain` fit without cropping, `crop` crops centered, `fill` pads, `stretch` distorts, no `fit`
  crops).
- Images are cached (`max-age=604800`) but have no ETag or `Last-Modified`.
- The church logo is available anonymously at `/logo`, but only at 150×150.

## 9. Calendars and appointments (if your extension shows them)

- `GET /calendars/appointments` expands recurring series itself, including DST: one entry per occurrence with a shared
  `base.id` and its own `calculated.startDate`. Exceptions are omitted and additional dates are included.
- All-day appointments come as plain dates with an **inclusive** end date (`2026-10-16 → 2026-10-18`); timed ones as
  ISO strings with `Z`.
- Images attached to an appointment belong to the series (`base`), so they appear on every occurrence.
- **Logged-in accounts need read permission even for public calendars.** A single calendar without permission makes
  the **whole** request fail.
- Calendar colors can come as CSS color names, not only hex.
- The calendar's `randomUrl` is the secret iCal subscription URL. Treat it as a credential.

## 10. Project hygiene that pays off

- **CI on every push:** lint, typecheck (`vue-tsc`), unit tests, build.
- **A post-build check of `dist/`:** one JS bundle, no inline scripts, no instance URL or token.
- **Tests never run against a live instance.** Record API responses from a test instance as fixtures, sanitize them
  (personal data, instance URLs, tokens, iCal URLs, file/image hashes), and don't commit them. Tests that need
  fixtures should show as skipped, not pass silently.
- **Never commit credentials or instance URLs.** Provide `.env-example` / `credentials-example` files instead.
- Keep a log of measured platform behaviour (what, when, how), including dead ends, so nobody investigates the same
  thing twice.
- Tag releases, keep a CHANGELOG, and document the required permissions as a table, updated whenever the setup wizard
  changes.
- Document update and uninstall procedures for admins explicitly.
