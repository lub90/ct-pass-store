# CtPassStore – Threat Model

> Started 2026-11-13 with the backend tuning file. It covers only the features listed below so far; later
> security-relevant features add their own section. The backend's full security rules are in
> [`specs/backend-spec.md`](../specs/backend-spec.md) (section 6).

## Backend tuning file (`config/tuning.php`)

Design: [`specs/backend-tuning-design.md`](../specs/backend-tuning-design.md).

> **Status 2026-11-15 (merged review): designed, not built; the plan needs revision before implementation.** The
> design allows `SETTINGS_CACHE_SECONDS` up to 3600, but the same TTL (`KvSettingsRepository::SETTINGS_TTL`, used for
> `settings`, `access` and the "access missing" record, `KvSettingsRepository.php:37,130,214,231`) now also caches
> `access`: the admin group ID and the machine clients. 3600 would stretch machine-client revocation ("within 5
> minutes", `specs/backend-spec.md` machine-client "Revocation" rule, about line 448) to about 1 h, and accepted risk #2 (admin-group change up to 20 min)
> to about 75 min. Before implementation: cap the settings/access cache at 300 s (can only be lowered), or give
> `access` its own locked TTL of at most 300 s. The scenarios and accepted risks below are **not** approved for the
> built feature until that revision; the earlier "approved with the design" note applies only to the draft.

### Assets

- The spec's security promises that depend on timing values:
  - A deleted or archived person's secondary password stops working within 10 minutes (person cache).
  - A stolen `CLEANUP_TOKEN` starts a cleanup at most once per 10 minutes, and each web run is time-bounded.
  - Brute-force, per-address and token-lifetime limits.
- The availability of the backend and the ChurchTools API budget.

### Attackers

| Attacker | Can do |
| --- | --- |
| Anonymous internet user | Send requests to the backend; can't read or write `config/` |
| Holder of a stolen `CLEANUP_TOKEN` | Call `POST /v1/cleanup` |
| Operator with write access to `config/` | Edit `tuning.php` and `credentials.php` |
| Other webspace user on shared hosting | Depends on file permissions (spec 3.1); can't write `config/` |

### Scenarios and mitigations

| Scenario | Mitigation |
| --- | --- |
| An operator unknowingly weakens a security promise through tuning | Security values are locked; values that back a promise (person cache, cleanup cooldown and deadline) can only move in the stricter direction. |
| A typo or wrong type makes the operator believe a value is active | Unknown keys, non-integers and out-of-range values stop the backend with `500 misconfigured`, naming the key and range. |
| A stolen cleanup token is used to load ChurchTools | Cooldown ≥ 600 s, web deadline ≤ 20 s, ChurchTools timeout ≤ 15 s. |
| A slow or hanging ChurchTools ties up PHP workers | ChurchTools timeout ≤ 15 s. |

### Accepted risks

- **Operators are trusted.** Anyone who can write `config/` can also change `credentials.php` or the code, so the
  tuning file isn't defended against them. Its ranges protect against mistakes, not against malice.
- **Stricter values can hurt availability.** A short person cache or settings cache means more ChurchTools calls, and
  a short ChurchTools timeout means more `502` answers. That is within the documented ranges and is the operator's
  choice.

## Whole system and admin role from a ChurchTools group

> **New 2026-11-14** (security review, review point B of `feature/admin-group`). Covers the backend as a whole and the
> admin role that moved from `settings.adminUsers` to membership in a ChurchTools group (`access.groups.admins.groupId`,
> backend spec 3.2, 4.4, D9; extension spec 6.1, 11, 16).

### Assets

- The secondary passwords in `passwordStore` (RSA ciphertext; the private key isn't on the backend). Whoever may
  **change** an entry can replace a person's secondary password and use it (e.g. WiFi/RADIUS as that person).
- The admin role: read every entry's ciphertext, set or delete every person's secondary password, run `/v1/test`.
- Machine-client registrations (`access.machineClients`): an `entries:read` client reads every entry, with no person
  behind it and no expiry.
- `settings.backendUrl`: decides where every user's browser sends their login code and their new secondary password.
- `JWT_SECRET` (signs user tokens including the `admin` claim, and the caches), `OAUTH_CLIENT_SECRET`, the service
  user's login token, `CLEANUP_TOKEN` (all in `config/credentials.php`).
- Personal data in the logs (person IDs, IP addresses; 14 days).

### Attackers

| Attacker | Can do |
| --- | --- |
| Anonymous internet user | Call `POST /v1/auth/token` and send forged tokens; no ChurchTools account |
| Logged-in user (`ctpassstore.view`) | Hold a valid user token; read `settings`; read their own groups |
| Person who controls the admin group's membership | Group leaders (roles allowed to edit members), holders of `edit group memberships`(`of grouptype`), `administer groups`, `administer persons`; anyone who can change the fields a dynamic group selects on; anyone who can join an open group whose sign-up is accepted automatically |
| Person with write rights on `access` or `settings` | Change the admin group, register machine clients, change `backendUrl` |
| Former admin | Kept a token (up to 15 min) or something they created while admin (a machine client, a key) |
| ChurchTools system admin / service-user holder | Everything the service user can do; not defensible in code |
| Holder of a stolen backup of `config/` or the cache folder | `JWT_SECRET` → forge user tokens with `admin: true` |

### Scenarios and mitigations

| Scenario | Mitigation |
| --- | --- |
| **New 2026-11-14.** A user forges or edits their token to set `admin: true` | HS256 with `JWT_SECRET`, algorithm pinned; `admin` required and a JSON boolean; tokens from before the claim existed are invalid (UserTokensTest, AuthorizationApiTest). |
| **New 2026-11-14.** A user claims a membership they don't have, or a pending one | Membership is read from ChurchTools with the user's own OAuth token for the `sub` that `whoami` confirmed; only `active` memberships in exactly the configured group count; `"012"`, `"1e1"` etc. never match (GroupId). |
| **New 2026-11-14.** A ChurchTools error or partial answer makes someone admin | 404/403 → not admin; 5xx/timeout/malformed → no token at all (502); missing or invalid `access` → no admins and no machine clients (fail closed); the leftover `settings.adminUsers` and `settings.machineClients` are ignored. |
| **New 2026-11-14.** Someone who controls the admin group's membership (group leader, group-type or group administrator, dynamic-group criteria, auto-accepted self sign-up) adds themselves and becomes admin | **Specified 2026-11-14 (round 2); the extension part isn't built yet.** Backend spec D9 ("Consequence") and extension spec 16.1 item 4 state that controlling the membership is the admin role. Extension spec 16.4 rule 6 warns about group roles that may edit members, open/auto-accepting/dynamic groups and holders of membership-editing rights, and says when it can't determine them (extension plan). `backend/docs/setup.md` ("Choose the admin group") tells the admin how to pick the group until then. The backend logs `User <id> logged in as admin.` at every admin login (spec 4.4 step 6; LoginApiTest). |
| **New 2026-11-14.** A former admin keeps access through a machine client or key they registered while admin | Machine clients survive the admin's removal. **Deferred 2026-11-14 (round 2):** `createdBy` on „Zugriff“ and "review machine clients when an admin leaves" go to extension plan Task 15 and the user guide (Task 20); logging machine-client reads needs a sampling design at RADIUS volume. Until then, only the `createdAt` list on „Zugriff“ shows them. **Update 2026-11-14 (review point B of `feature/extension-rework`):** `createdBy`, fingerprints and every enabled client are shown on „Zugriff“ (Task 15, resolved); the user-guide advice "review machine clients when an admin leaves" is still missing (MINOR); backend logging of client changes and a rate-limited machine-client usage summary are open (IMPORTANT, see the point-B section at the end). |
| **New 2026-11-14.** Someone with write on `settings` points `backendUrl` to their own server and collects the secondary passwords users type there | ChurchTools rights on `settings` (only the admin group, extension spec 16.2 A3; rule 4 of 16.4 warns about other writers). The OAuth code is useless without the client secret, but the typed password isn't. **The users' ChurchTools passwords travel there too; accepted by the maintainer 2026-11-14 (E15), see "Extension: backend channel" below.** |
| **New 2026-11-14.** Someone with write on `access` changes `groupId` to a group they're in | Same rights as above (16.2 A3, 16.4 rule 4). Takes effect after up to 5 minutes (cache) and a new login. |
| **New 2026-11-14.** A removed admin keeps acting until their token expires | Token lifetime 15 minutes; emergency: rotate `JWT_SECRET`. |
| **New 2026-11-14.** An anonymous caller makes every login request read `settings`/`access` from ChurchTools | The address limit runs first; `settings` and `access` are cached for 5 minutes, a missing/unreadable `access` too; outages are remembered 10 s+. |
| **New 2026-11-14.** A user in very many groups makes the login page through `persons/{id}/groups` | At most 100 pages of 100; more → no token (502) for that user only. Accepted for now (round 2 ruling, see the accepted risks). |
| **New 2026-11-14.** Another webspace user plants an `access` cache entry with their own group or machine client | Cache records are MAC'd with a key derived from `JWT_SECRET` and bound to their name; files `600`, folder `700`. |
| **New 2026-11-14.** The contract test leaves a normal test user with "login to external system", or an OAuth client, on the test instance | Restored in `tearDownAfterClass` and on setup failure; only the shared test instance, never production. |

### Accepted risks

- **Proposed 2026-11-14: the 15-minute window.** A person removed from the admin group (or from `view`) stays admin
  until their token expires. Emergency revocation is rotating `JWT_SECRET`.
- **Proposed 2026-11-14: changing the admin group takes up to 20 minutes** (5 minutes cache plus 15 minutes token).
- **Proposed 2026-11-14: ChurchTools system admins and the service user are trusted.** They can grant themselves any
  right, add themselves to the admin group or read `passwordStore` directly; the backend can't defend against them.
- **Proposed 2026-11-14: a stolen `JWT_SECRET` forges admin tokens.** Same as before the change (the secret already
  forged any user's token); mitigation is file permissions and rotation.
- **Proposed 2026-11-14: every role in the admin group counts** (extension spec 16.1.1). A church that adds observers
  in another role to that group makes them admins; documented, not enforced.
- **Proposed 2026-11-14: an access-only outage of ChurchTools blocks logins** for its duration (502/503), as a
  settings outage already does; the alternative would silently demote admins.
- **Proposed 2026-11-14 (round 2): up to 100 sequential group pages per login.** Only members of very many
  groups are affected, and only their own logins slow down; stopping at the first match is a later optimisation.

## Extension (frontend): ChurchTools layer and KV store

> **New 2026-11-14** (security review, review point A of `feature/extension-rework`, Tasks 6 and 7). Covers the Vue
> extension that runs inside the ChurchTools page with the user's session cookie (`src/ct/`, `src/store/`,
> `src/model/`; extension spec 5, 6, 8.3, 16). Login, token storage and the backend client (Tasks 8, 9) add their
> scenarios when they're reviewed.

### Assets

- The user's ChurchTools session: the extension's code acts with every right the user has, not only module rights.
- The integrity of `settings` (above all `backendUrl`, `oauthClientId`, the password policy and `texts`, which every
  user's browser trusts) and of `access` (admin group, machine clients).
- The confidentiality of `access` (who is admin, which machine clients exist): readable only by the admin group.
- The names and IDs of the users group's members, visible to admins through "view group".

### Attackers

| Attacker | Can do |
| --- | --- |
| Logged-in user | Read `settings` through the API directly, bypassing the UI; call any ChurchTools endpoint their rights allow |
| Settings editor (write on `settings` and/or `access`) | Store any JSON the KV accepts, including values the extension's schemas reject, duplicates and unknown fields |
| Script on the ChurchTools page (another extension, a compromised ChurchTools asset) | Everything the user's session can do; read the extension's memory and `sessionStorage` (E8) |
| Malicious or compromised npm package in the bundle | Same as a script on the page |

### Scenarios and mitigations

| Scenario | Mitigation |
| --- | --- |
| **New 2026-11-14.** A settings editor stores a malformed or hostile `settings`/`access` value (wrong types, huge numbers, `__proto__` keys, broken JSON, keys that make the decoder throw) to crash the app or smuggle a value past the checks | Every value is parsed with valibot; broken JSON, wrong types and malformed keys read as `invalid`, never throw (`repository.test.ts`, `schemas.test.ts`); valibot's object schemas skip `__proto__`/`constructor`/`prototype`; unknown fields are copied with data-property semantics. |
| **New 2026-11-14.** A settings editor sets `backendUrl` to `http://…`, to a URL with credentials, a query or a fragment | Rejected on save and read as `invalid` (`setup-needed`); mirrors backend spec 3.2. Pointing it at another `https://` host is the open scenario of the section above. |
| **New 2026-11-14.** A settings editor registers two machine clients with the same `id` or the same key (also base64 vs base64url) | The extension refuses to save it (the backend would disable both). |
| **New 2026-11-14.** A settings editor writes a `schema` > 2 to force `update-needed` for everyone | Same rights as changing `settings` at all; reported to admins with the version. |
| **New 2026-11-14.** Two admins save at the same time and one silently overwrites the other (e.g. one removes a machine client, the other's save brings it back) | `revision` compared right before writing (`ConflictError`); a residual race remains because the KV has no compare-and-set (accepted risk below). |
| **New 2026-11-14.** Fields of the old layout (`adminUsers`, `readAccessUsers`, `machineClients`) stay in `settings`, readable by every user, and become active again if an old backend is ever deployed | `RETIRED_KEYS`: left out of every read and removed on every save, also when the caller passes them (`repository.test.ts`, resolved in round 2 of review point A). The migration must still write a v2 value once so they leave storage. |
| **New 2026-11-14.** An expired session (fixed 24 h) makes ChurchTools answer reads anonymously, so `settings` looks missing and setup-capable people are offered the setup wizard | Every request sends `X-OnlyAuthenticated: 1` (`setNeedsAuthentication(true)`), so an expired session is a `401` → `NotAuthenticatedError` (`api.test.ts`). |
| **New 2026-11-14.** A value from an unvalidated source (e.g. a string `personId`) is put into a request path and redirects the call to another ChurchTools endpoint with the user's session | `assertId` rejects anything but a positive safe integer before every request (`CtInvalidIdError`, `api.test.ts`). |
| **New 2026-11-14.** Someone with write on `access` (e.g. an admin about to leave) stores a machine client that the backend enables but the extension hides, or that no save can remove | Resolved in round 3 of review point A. Both sides read clients by the same rules (`name` and `createdAt` required, canonical keys only, the same reason codes), pinned by the shared fixture `shared/access-client-cases.json`, which `AccessParserTest` and `machine-clients.test.ts` both run. The extension lists every client the backend enables in `value.machineClients`, and every other stored entry in `unusable` (index, raw id, reasons). Saves keep unusable entries unchanged unless `saveAccess(…, dropUnusable)` names them, so every stored client is visible and can be removed. „Zugriff“ (Task 15) must show `unusable`. |
| **New 2026-11-14.** A write without a CSRF token once ChurchTools starts requiring it | `setLoadCSRFForAPI()` sends `CSRF-Token` on every REST write (`client.test.ts`, `api.test.ts`). |
| **New 2026-11-14.** The extension shows people who can't use it (waiting or archived members) as users or admins | Only `active`, non-archived members are listed and counted (`api.test.ts`, contract cases). |
| **New 2026-11-14.** The in-memory fake or demo data end up in the production bundle | `dev/` isn't imported by production modules; `check-dist.js` fails on the demo marker. |
| **New 2026-11-14.** A vulnerable HTTP library in the bundle (axios SSRF, form-data CRLF) | Updated in Task 6 (`npm audit` prod clean at that time); CI runs `npm audit --audit-level=high` (Task 20). |
| **New 2026-11-14.** A settings editor puts phishing wording into `texts` (e.g. "type your ChurchTools password here") | Length limits only (60/300); texts are rendered as text, never as HTML or i18n messages (must stay so in Task 12). Same trust as `backendUrl`. |

### Accepted risks

- **Proposed 2026-11-14: the extension has the user's full ChurchTools session.** Any script on the page, including a
  compromised dependency of this extension or another extension, can act as the user. The extension keeps its
  dependencies few and audited; it can't defend against the page it runs in.
- **Proposed 2026-11-14: concurrent saves can still overwrite each other** in the short window between the read and
  the write, because the ChurchTools KV has no version or compare-and-set.
- **Proposed 2026-11-14: settings editors are trusted for content.** They can set `backendUrl`, `texts` and the policy
  within the schema; the extension only enforces the form, not the intent (see the `backendUrl` scenario above).
- ~~**Proposed 2026-11-14: the extension and the backend read duplicates differently.**~~ **Withdrawn 2026-11-15
  (Task 21, a8b95a3):** no longer a risk to accept. Both sides now fail closed on several values in `settings` or
  `access` (extension spec 3.2 row 4a, 6.2: no login, nothing sent to any backend address; the backend requires
  exactly one value). Editors see every value and choose which stays; no save or removal deletes a value nobody has
  seen. What remains: whoever can create a value can stop the service until an editor resolves it (availability only,
  see the Task 21 rows in the point-B section).

## Extension (frontend): backend channel

> **New 2026-11-14** (security review, review point A of `feature/extension-rework`, Task 8). Covers the extension's
> client for the backend (`extension/src/backend/http.ts`, `api.ts`, `problems.ts`), the fake backend
> (`extension/src/dev/fake-backend.ts`) and the shared contract cases (extension spec 7.3, 8.2; backend spec 4.1–4.9).
> Login, token storage and renewal (Task 9) add their scenarios when they're reviewed.

### Assets

- The user's **ChurchTools password** (`primaryPwd`), sent in the body of `PUT`/`DELETE /v1/entries/{id}` whenever
  `requirePasswordForPasswordChange` is on (the default). Whoever receives it can log in to ChurchTools as that user,
  with every right they have, not only the extension's.
- The backend token (15 minutes, bearer): sets or deletes the user's entry, and every entry for an admin.
- New secondary passwords (custom ones in the request, a generated one once in the response).
- The OAuth code, PKCE verifier and redirect URI sent to `POST /v1/auth/token`.

### Attackers

| Attacker | Can do |
| --- | --- |
| Settings editor (write on `settings`; the admin group, so also whoever controls its membership, D9) | Decide `backendUrl`, i.e. where every user's browser sends the items above |
| Network attacker | Only with a non-HTTPS `backendUrl` or a broken TLS setup |
| Operator of a server the backend URL points to (by mistake: typo, expired domain, old host) | Receive and answer every request |
| Script on the ChurchTools page | Read the token and the typed passwords anyway (accepted risk of the section above) |

### Scenarios and mitigations

| Scenario | Mitigation |
| --- | --- |
| **New 2026-11-14.** A settings editor points `backendUrl` to their own HTTPS server, which answers like the backend, and collects the **ChurchTools passwords** (and new secondary passwords, and tokens) of every user who changes a password; a ChurchTools system admin among them gives full control of ChurchTools | **Accepted, confirmed by the maintainer 2026-11-14** (see accepted risks; extension spec E15 and 4.8). Only the ChurchTools write right on `settings` (16.2 A3). The Backend & Status page warns when the address is changed (Task 16); "mail all admins when `backendUrl` changes" is in `TODO.md`. |
| **New 2026-11-14.** A wrong or malicious backend answers with crafted Problem Details or success bodies to inject text, fake states or crash the app | Problem only with `application/problem+json` and a `#slug`; unknown members dropped; `violations` strings only; `retryAfter` finite and ≥ 0; success shapes checked per endpoint (`login`, `selfTest`, `putEntry`); anything else is `UnexpectedResponse` (`http.test.ts`). `detail` and self-test `message`s are attacker-controlled text: never shown to users, admins see them only as plain text (Tasks 12–16 must not use `v-html`). |
| **New 2026-11-14.** The bearer token is sent to another host through a redirect, or ambient cookies go along | `redirect: 'error'` (a redirect is `BackendUnreachable`), `credentials: 'omit'`, `cache: 'no-store'` (`http.test.ts`). |
| **New 2026-11-14.** The token is sent with the login request, or to a backend other than the one that issued it | Login sends no `Authorization` header (`http.test.ts`). Binding the token to the backend base it came from: resolved in Task 9 (`Auth.bound()`, `auth.test.ts`; see "login, token and session" below). |
| **New 2026-11-14.** The client is handed a non-HTTPS base URL or one with credentials and sends the token and passwords over it | `createBackendApi` refuses anything but `https:` without userinfo (`BackendConfigError`, which doesn't echo the URL); `http://localhost`/`127.0.0.1` only with the explicit `allowLocalHttp` option, to be tied to the dev build in Task 17 (`http.test.ts`, resolved in round 2). **Since Task 17 (ce50897):** the option is removed; `https:` only in every mode (`http.test.ts`, `dev-boundary.test.ts`). |
| **New 2026-11-14.** A token, password or `detail` ends up in an error message, the console or an error's `cause` | Errors carry slug and status only; fetch errors are rethrown without cause; programming-error problems log slug and status only (`http.test.ts`). |
| **New 2026-11-14.** A person id from an unvalidated source changes the request path (`/entries/1/../test`) | `personPath` accepts only positive safe integers before any request (`http.test.ts`). |
| **New 2026-11-14.** A hanging backend keeps a form busy forever | 15 s per request including the body (`http.test.ts`, fake timers). |
| **New 2026-11-14.** "No password" is shown for any `404` (wrong URL, gone person), so a user sets a new one or an admin misreads the state | Only the slug `entry-not-found` is "none"; other `404`s reject (`http.test.ts`). |
| **New 2026-11-14.** The fake backend (accepts `ct-password`, keeps passwords in memory) ships in the production bundle and users "store" passwords that never reach the backend | Not imported by production modules today. `check-dist.js` only looks for `__DEMO__`, which the fake doesn't contain (finding F4); Task 17 must cover every `dev/` module. **Resolved in Task 17 (ce50897):** every `dev/` module carries the marker in code (`markers.test.ts`); see "build/dev boundary" below. |
| **New 2026-11-14.** A settings editor collects OAuth codes by pointing `backendUrl` elsewhere and exchanges them at ChurchTools | The backend's OAuth client is confidential (client secret); a code with the PKCE verifier alone must not be exchangeable. **Resolved 2026-11-14 (measured in Task 18):** no secret → `400 invalid_request`, wrong secret → `401 invalid_client` (contract harness section below). |
| **New 2026-11-14 (Task 16).** A `backendUrl` change is written through „Backend & Status“ without the E15 warning and danger dialog (Enter in the field, a second Save while the dialog is open, edits or a reload while it is open) | `useSettingsForm` `beforeSave`: what is asked about is a copy of what is written; a second save while asking is ignored; a reload during the question drops the save; Enter submits only a valid form; the save is revision-guarded (`useSettingsForm.test.ts` „beforeSave“, `BackendView.test.ts`). A stored trailing slash is no change (no false warning). |
| **New 2026-11-14 (Task 16).** A typed address, or one saved but not yet reloaded, receives a request, the token or a ChurchTools password | No pre-save reachability check; the self-test uses the startup address only; `reloadSettings()` keeps the startup `backendUrl`; `tokenFor()` withholds the token from any other base (`BackendView.test.ts` „the address the app talks to“). **Since 1037d32 (F3):** without settings at startup, `reloadSettings()` never adopts a `backendUrl`/`oauthClientId` from a later read (`app.test.ts`). |
| **New 2026-11-14 (Task 16).** The address shown in the warning, the dialog or „Geprüft wird …“ is not the host the browser connects to, so an admin (or a co-admin checking later) approves or overlooks a foreign server | Invisible/format characters (`\p{Cf}`) refused in new or changed addresses (field and store), addresses in `<bdi>`. **Resolved 2026-11-14 (F1/F2, round 2 of review point A, Task 16, 1037d32):** a new or changed address is refused (`host-encoding`, field and store) when its host part is not printable ASCII, contains `%`, or differs from `URL.host` (case aside; `:443` allowed). This covers percent escapes, IDN look-alikes (enter the `xn--` form), fullwidth letters and dots, numeric/short IPv4 forms (`2130706433`, `127.1`, `0x7f…`), non-canonical IPv6 and odd ports (`:0443`, `:`); dotted IPv4, `[::1]`, other ports and a trailing dot pass unchanged. A stored address the browser rewrites is still read (backend parity) and shown with its real host (`connectedHost`) in „Geprüft wird …“ and the dialog's „Bisher:“. |
| **New 2026-11-14 (Task 16).** `backendUrl` is changed without the page: directly in the KV store through the ChurchTools API by anyone with write on `settings`, or later by „Einrichtung“ or a backup restore | Accepted under E15 for the direct write (no warning possible). Later tasks that write `backendUrl` (setup, restore) must reuse the same warning and dialog. Detection: `TODO.md` (mail all admins); a backend log line when the parsed `backendUrl` differs from the last one seen would be an independent signal (F4, carried to review point B). **Evaluated at review point B (2026-11-14): MINOR, not release-blocking.** A changed `backendUrl` already breaks every machine client (the backend checks their assertions' `aud` against it), which is a loud natural signal; the log line is still cheap and recommended. **Resolved 2026-11-14 (Task 22, 12dbb73):** `SettingsChangeLog` logs `The backend address changed from <old> to <new>.` at `notice` on the first load from ChurchTools after a change (at most one settings-cache TTL, and before any machine client can use the new value), state in the signed security store under its lock. Residual (MINOR, new 2026-11-14): the value is logged raw; the log escaping covers ASCII controls only, so a stored address with bidi controls (accepted risk #12) or U+2028/U+0085 can make that very line display a misleading host in a Unicode-aware log viewer. **Resolved 2026-11-15 (823d1ce, round 2 of review point A, Task 22):** the log processor also escapes `\p{Cc}`, `\p{Cf}`, U+2028 and U+2029 as `\u{XXXX}` in messages and context (`LoggerTest`). Residuals (MINOR, new 2026-11-15): a string with any invalid UTF-8 byte gets only the ASCII escape, so Unicode controls in the same string pass (only reachable through text that isn't JSON-decoded, e.g. exception messages); `mb_ord` needs `ext-mbstring`, which isn't declared in `composer.json` (the polyfill is dev-only), so on a host without it the first logged Unicode control throws inside the logger. |
| **New 2026-11-14 (Task 16).** The self-test is run by a non-admin, or the write test runs unasked | Backend: `GET /v1/test` checks the token's admin claim before anything runs; only `write=1` exactly runs the write checks. Extension: offered only to admins with the settings right; the write test only on its own button; renewal via `ensureFresh()` inside the click; names, messages and `detail` are plain text. |
| **New 2026-11-14 (Task 16).** „Über“ links become an open redirect or allow tab-nabbing | Built only from the repository constant and a version matching `x.y.z` (else `main`); `target=_blank` with `rel="noopener noreferrer"` (`links.test.ts`, `AboutView.test.ts`). |

### Accepted risks

- **Proposed 2026-11-14 (Task 16): read-parity gap for odd stored addresses.** A stored `backendUrl` with bidi
  controls in the host passes PHP `parse_url` (machine clients keep working) but fails the
  browser URL parser, so the extension reads the settings as invalid and fails closed (no login, no requests).
  New addresses with such characters can't be saved through the extension.
- **Accepted 2026-11-14 (confirmed by the maintainer): the admin group is trusted with `backendUrl`** (extension spec
  E15). Whoever can change it (the admin group and everyone who controls its membership, D9) can make users' browsers
  send their ChurchTools password (when `requirePasswordForPasswordChange` is on), new secondary passwords and backend
  tokens to another server. The admin group must therefore be as trustworthy as ChurchTools administrators. Normal
  users get no prompt or display (they can't judge it). Mitigations: the change warning on Backend & Status (Task 16);
  later, mailing all admins on a change (`TODO.md`).
- **Proposed 2026-11-14: the backend is trusted for content within the contract.** A malicious backend can lie about
  stored entries, rules or self-test results; the extension only checks shapes.
- **Proposed 2026-11-14: redirects are failures.** A backend URL that redirects (e.g. `http` → `https`, a moved host)
  shows "unreachable" instead of following, so the token and passwords are never re-sent elsewhere.

## Extension (frontend): login, token and session

> **New 2026-11-14** (security review, review point A of `feature/extension-rework`, Task 9). Covers the OAuth login
> with PKCE, the callback route and the backend token in the browser (`extension/src/backend/pkce.ts`, `auth.ts`,
> `extension/src/views/AuthCallbackView.vue`, `extension/src/app/useSession.ts`; extension spec E7, E8, 7.1, 7.2;
> backend spec 4.4, D4; backend plan 5.1).

### Assets

- The backend token (HS256 bearer, 15 minutes, claims `sub`, `username`, `admin`) in memory and in
  `sessionStorage['cps-token']`, bound to the backend base it came from.
- The login data of a running page login (`state`, PKCE verifier, return path, backend address) in
  `sessionStorage['cps-login']`; a popup login keeps `state` and verifier in memory only.
- The OAuth authorization code in the callback URL and in the popup's `postMessage`.
- The integrity of "who is logged in": the token must belong to the person whose ChurchTools session the page shows.

### Attackers

| Attacker | Can do |
| --- | --- |
| Foreign website the user visits | Open or link to the callback URL with any query, open the extension in a window it controls, post messages to it |
| Next person at a shared computer (church office) | Use the same browser tab after the previous user logged out of ChurchTools |
| Script on the ChurchTools page | Read `sessionStorage` and the extension's memory (accepted, E8 and the KV section above) |
| Wrong or misconfigured backend | Answer the login with tokens it then rejects |

### Scenarios and mitigations

| Scenario | Mitigation |
| --- | --- |
| **New 2026-11-14.** Login CSRF: a foreign site sends the user's tab to the callback with the attacker's own code, so the user works in the attacker's account | Page login: `state` (256 bits, `getRandomValues`) must equal the stored one exactly; the stored login data is removed before any check, so it's single-use (`auth.test.ts`). Popup: only a message whose `source` is the popup, whose `origin` is our own and whose `state` is the in-memory one is taken. |
| **New 2026-11-14.** A foreign page opens the callback URL itself (popup state `p.…`) to receive a code through `postMessage` | The callback posts only with its own origin as target (never `*`), so a cross-origin opener gets nothing (`forwardPopupCallback` tests). |
| **New 2026-11-14.** A foreign window or a replayed message hands the opener a code | `source`/`origin`/`state` checks; the listener is removed after the first match; a 5-minute deadline closes the popup and ignores later messages (`auth.test.ts`). |
| **New 2026-11-14.** Open redirect through the remembered return path | `safeReturnPath` on store and on read: only app-relative printable-ASCII paths, no `//`, backslashes, `%2F`/`%5C`, broken encoding, overlong paths or the callback itself (case-insensitive); `router.replace` stays inside the app. |
| **New 2026-11-14.** The code stays in the address bar or history after a failed callback | The view replaces the URL with the bare path; a malformed popup state posts nothing; the callback fails closed if the login data can't be removed; errors carry no code, state, verifier or token and nothing is logged. A stolen code is useless without the client secret (verification carried to Task 18). |
| **New 2026-11-14.** A token issued by one backend is sent to another after `backendUrl` changes | The token record carries its backend base; `bound()` drops it on a mismatch (`auth.test.ts`; F3 of Task 8 resolved). |
| **New 2026-11-14.** **Shared tab:** user A logs out of ChurchTools, user B logs in in the same tab within 15 minutes and the extension reuses A's token from `sessionStorage` (A's role, A's username for the primary-password check; with `requirePasswordForPasswordChange` off, an admin A's token lets B change everyone's secondary password) | **Resolved 2026-11-14 (F1, round 2 of review point A, Task 9, 946c98d).** The stored token carries the person from its `sub`; `token()`/`info()`/`expiresInMs()` give nothing until `configure()` and `bindPerson(whoamiId)` ran; a token of another person is dropped; a popup renewal for another person is refused (`PersonMismatch`), the old token dropped and a page login started without resending (`auth.test.ts`, `useSession.test.ts`; contract case checks `sub` = caller, Task 18). Task 11 must call `bindPerson` at startup — **done in Task 11 (d3d471c):** startup calls `configure()` and `bindPerson(whoami.id)` before any login decision and before `completePageLogin` (`app.test.ts` call-order tests). Still to check by hand: whether ChurchTools' logout clears `sessionStorage` (not needed for the defence any more). |
| **New 2026-11-14.** A backend that rejects its own fresh tokens (`invalid-token`, e.g. differing `JWT_SECRET` across instances) makes the page log in again and again without user action; every loop counts against the per-address login limit (30/min) and locks out a whole parish NAT | **Resolved 2026-11-14 (F2, round 2).** `cps-login-done` records a completed page login; a token problem (or a renewal for another person) within 60 s doesn't log in again but sets `loginLoop` / rejects `LoginLoop` → `backend-error` (`useSession.test.ts`). **Carry to Task 11:** the startup page login must consult `recentPageLogin()` too, so a token dropped at startup right after a login doesn't loop. **Done in Task 11 (d3d471c):** startup without a usable token and with a recent page login shows `backend-error` without redirecting (`app.test.ts`, 60 s boundary tested). |
| **New 2026-11-14.** A user edits `cps-token` to `admin: true` to get admin rights | The flag only drives the display (`Session.admin` documented display-only, reset when backend or person change); the backend takes the role from the signed claim (backend spec 4.3). |
| **New 2026-11-14.** ChurchTools sends `Cross-Origin-Opener-Policy` on its OAuth pages, cutting the popup's opener | Fails closed: the opener sees the popup as closed → „Sitzung erneuern“; the callback without opener shows the error and posts nothing. **Measured 2026-11-14:** ChurchTools sends no COOP/COEP/CORP on `/oauth/authorize`, so the opener survives. |
| **New 2026-11-14.** A popup renewal or a retry runs twice at once and mixes states | Overlapping renewals share one promise (`useSession`); each popup uses a fresh state and verifier. |

### Accepted risks

- **Proposed 2026-11-14: the backend token isn't revoked on ChurchTools logout.** It stays valid until it expires
  (15 minutes); there is no backend logout. Emergency: rotate `JWT_SECRET`. (The same-tab reuse is finding F1, not
  part of this risk.)
- **Proposed 2026-11-14: login data of an abandoned page login stays in `sessionStorage`** until the next callback or
  the tab closes. The verifier is useless without a code and the client secret.
- **Proposed 2026-11-14: any page that loads the callback with a bogus query during a running page login aborts that
  login** (the login data is single-use). The user reloads; no access is gained.

## Password policy and secondary passwords (client mirror, ct-radius contract)

> **New 2026-11-14** (security review, review point A of `feature/extension-rework`, Task 10). Covers the password
> policy (backend `PasswordPolicy`, backend spec 5.1), its client-side mirror (`extension/src/password/rules.ts`), the
> password flow (`extension/src/password/flow.ts`, extension spec 4.2), the shared fixture
> `shared/password-policy-cases.json` and the fake backend. The backend is the enforcing side; the extension only gives
> feedback before sending.

### Assets

- The secondary passwords themselves: used for WiFi/RADIUS (ct-radius decrypts them with its private key), so whoever
  knows or guesses one gets network access as that person.
- The character-set contract with ct-radius (spec 5.1 rule 1): a password the backend stores but ct-radius rejects
  locks the person out of WiFi; a character ct-radius mishandles could break its parsing or configuration.
- The person's ChurchTools password, typed in the same form (`primaryPwd`) when `requirePasswordForPasswordChange` is on.
- A generated password while it's on screen (flow state `result`, the copy button, the clipboard).

### Attackers

| Attacker | Can do |
| --- | --- |
| Logged-in user | Bypass the extension and send any `secondaryPwd` straight to `PUT /v1/entries/{own}` |
| Developer or maintainer changing one side only | Change the symbol set, the length rule or the order of codes in the backend or the extension |
| Someone in WiFi range or on the RADIUS path | Try passwords online against RADIUS, or capture an authentication exchange to crack offline (depends on the EAP method ct-radius uses) |
| Person at the user's screen or a clipboard manager / clipboard-reading app | See or read a generated password after it's shown or copied |

### Scenarios and mitigations

| Scenario | Mitigation |
| --- | --- |
| **New 2026-11-14.** A user skips the extension's checks and stores a password that breaks the policy (too short, forbidden characters, over 128 bytes so encryption fails) | The backend checks every `secondaryPwd` itself (spec 4.6 step 3, 5.1); length first, so huge input costs nothing; the request body has a size limit (4.1). The client check is feedback only (`canSubmit` documented "the backend decides again"). |
| **New 2026-11-14.** Client/server drift: the extension's mirror accepts what the backend rejects (user sees a confusing error) or rejects what the backend accepts (user can't set a valid password) | Both sides run the same 151 cases from `shared/password-policy-cases.json` (`PasswordPolicyTest::testSharedCases`, `rules.test.ts`), including every allowed character in a valid case, length boundaries at 12/14/20/64/128/129 bytes, UTF-8 byte counting, and the code order; the fake backend uses `checkPassword`, so it can't drift from the mirror. Both sides also test every ASCII/byte value against their own literal set. **Resolved 2026-11-14 (94c8d59, 4117a4d):** the shared fixture now pins all 128 ASCII characters on both sides (186 cases). |
| **New 2026-11-14.** The backend's allowed set is widened (e.g. `#`, `'`, a space) without changing ct-radius, so stored passwords fail at RADIUS or a character reaches ct-radius that it mishandles | Spec 5.1 rule 1 names the set a contract with ct-radius; the literal is pinned in tests on both sides of this repo. **Not pinned across repositories:** ct-radius doesn't run the shared fixture. Recommendation: let ct-radius's tests consume `shared/password-policy-cases.json` (or a published copy). |
| **New 2026-11-14.** Unicode tricks (normalization forms, look-alike Cyrillic letters, zero-width or no-break spaces, lone surrogates, NUL) make the two sides count or classify differently | Only ASCII is allowed, so normalization never matters; length counts UTF-8 bytes on both sides; zero-width space, NBSP, Cyrillic `а`, emoji and NUL are in the fixture; a lone surrogate is `invalid-character` on the client and invalid JSON for PHP. Nothing is trimmed on either side. |
| **New 2026-11-14.** A user picks a weak custom secondary password that passes the policy (e.g. `Password2024!`) and it's guessed or cracked from a captured WiFi exchange | Minimum 12 characters (configurable up to 64) with three classes; generation is the default and recommended choice (spec 4.2); admins can switch `allowCustomPassword` off. No blocklist or strength estimate: proposed accepted risk below. Online guessing at RADIUS is ct-radius's concern. |
| **New 2026-11-14.** A user reuses their **ChurchTools password** as the secondary password, so ct-radius (and anyone who can decrypt `passwordStore`) holds the ChurchTools password in plaintext | Not prevented. The policy usually rejects it by accident only if the ChurchTools password has forbidden characters. Cheap mitigation (MINOR recommendation): when both `primaryPwd` and `secondaryPwd` are sent, the backend rejects equal values; the extension can warn the same way before sending. **Still open 2026-11-14 (review point B):** feature decision for the maintainer (`TODO.md`). |
| **New 2026-11-14.** A generated password lingers: in flow state after the user leaves, in the clipboard, or in a browser password manager under the wrong site | Extension spec 4.2: „Fertig“ drops the plaintext from memory. **Carry to Task 12:** clear the `result` state on unmount/navigation, never persist it (no `sessionStorage`), `autocomplete="new-password"` on the secondary-password fields and `autocomplete="current-password"` on the ChurchTools-password field; clipboard contents can't be cleared reliably (proposed accepted risk). **Done in Task 12 (cd63753, 205df11):** the plaintext lives only in `PasswordFlow` refs, dropped on „Fertig“, „Abbrechen“, after saving and on unmount; a generated password that arrives after the unmount is not kept (tested with a held PUT since d514258); nothing reaches storage, the address or the console; autocomplete values as required (`PasswordView.test.ts`). |
| **New 2026-11-14.** The one-click „generate now“ path (no custom passwords, no primary password required) lets someone at an unlocked screen replace the user's secondary password without any confirmation | By design (extension spec 4.2, no confirm dialog for one's own password); only possible with `requirePasswordForPasswordChange` switched off by an admin, and it locks the user out of WiFi rather than giving the attacker the old password (the new one is shown to whoever is at the screen, though). Part of the accepted risk of switching off the primary-password check. |
| **New 2026-11-14 (Task 12 review).** `custom-password-not-allowed` reloads the settings from the KV store mid-session (`app.reloadSettings()`); if `backendUrl` changed meanwhile (typo, moved host, or a settings editor), every later request is built for the **new** address while `Auth` stays configured for the old one, so `auth.token()` hands the old backend's token (an admin token for admins) and the next write's `primaryPwd` to the new host | **Resolved 2026-11-14 (F1, round 2 of review point A, Task 12, d514258).** Two layers: `reloadSettings()` keeps `backendUrl`/`oauthClientId` from startup (a new address takes effect only on the next page load, through `configure()`); and every backend client is built by `backendFor(auth)` with `auth.tokenFor(baseUrl)`, which gives the token only when `backendBase(baseUrl)` equals the configured base (none before `configure()`), so no future caller can send it elsewhere (`PasswordView.test.ts` with a stubbed `fetch`: no request reaches the new address; `auth.test.ts`, `services.test.ts`). |
| **New 2026-11-14 (Task 12 review).** The custom form holds a `current-password` and a `new-password` field, i.e. it looks like a change-password form to browser password managers; after the XHR save they may offer to **update the saved ChurchTools login** with the secondary password (or save the generated one shown in the result field) | Partly handled (MINOR finding F2 of Task 12): the read-only result field has `autocomplete="off"` (d514258, tested). The change-password heuristic on the custom form is **carried to Task 19** (real-browser check; consider a hidden `username` field with a distinct value). The user can decline the prompt; accepting breaks ChurchTools autofill and stores the WiFi password under the ChurchTools origin. **Update 2026-11-14 (Task 19):** autocomplete attributes verified in Chromium; the real password-manager prompt is on the manual check list (`extension/docs/development.md`, „Manual checks on the test instance“), still open. |
| **New 2026-11-14 (Task 12 review).** Shoulder surfing: the generated password is shown in clear by default (the eye hides it); while typing a custom password the list of disallowed characters could echo parts of it | Generated in clear is a design choice (shown once, to be noted; proposed accepted risk below). Masked custom field: disallowed characters are named by kind only (space, control, non-ASCII, other symbol); actual characters only while revealed (`PasswordView.test.ts`). |
| **New 2026-11-14 (Task 12 review).** A write lands after the person left the form (navigation during the request) or its answer is lost (timeout, 502): the stored secondary password changed but nobody saw the new one, and the page shows a stale status | Every write (whatever its outcome) bumps a per-person change counter; every mounted entry of that person reads its status again; timeout or off-contract answer after sending says the outcome is unknown; „Abbrechen“ is disabled while a request runs (`PasswordView.test.ts`, `usePasswordEntry.test.ts`). The person sets a new one. |
| **New 2026-11-14 (Task 12 review).** „Mein Passwort“ acts for a person taken from the address or for someone else after a ChurchTools login change | `personId` only from startup's whoami (`app.personId`), never a route param; nothing is requested unless the app state is `user`/`admin` with a known person; the backend authorizes from the signed `sub`; a renewal for another person is `PersonMismatch` → page login (`PasswordView.test.ts` "checks its own rights", `useSession.test.ts`). |

### Accepted risks

- **Proposed 2026-11-14: no blocklist or strength meter for custom secondary passwords.** The policy is composition and
  length only; a common pattern passes. Churches that need more switch `allowCustomPassword` off (generated passwords
  have about 6.2 bits per character, 74+ bits at 12 characters).
- **Proposed 2026-11-14: the ct-radius character-set contract is enforced by convention across repositories** until
  ct-radius runs the shared fixture.
- **Proposed 2026-11-14: a copied generated password stays in the system clipboard** (and in clipboard managers) after
  „Fertig“; the extension can't clear it reliably.
- **Proposed 2026-11-14: switching off `requirePasswordForPasswordChange` lets anyone at an unlocked, logged-in screen
  replace the user's secondary password in one click** and see the new one.
- **Proposed 2026-11-14 (Task 12): the generated password is shown in clear by default** in state 3 (the eye hides it),
  so whoever looks at the screen at that moment sees it. It is meant to be noted once.
- **Proposed 2026-11-14 (Task 12): the typed ChurchTools password stays in memory while the form is open**, also after
  a failed attempt, an unknown outcome or while „Sitzung erneuern“ is pending, so the person needn't type it again; it
  is dropped on „Abbrechen“, success and leaving the page. A script on the page can read it anyway (accepted above).
- **Proposed 2026-11-14 (Task 12): a write that lands after the person left the page replaces the secondary password
  without anyone seeing the new one.** The status is re-read; the person generates another.

## Extension (frontend): app state, startup and routing

> **New 2026-11-14** (security review, review point A of `feature/extension-rework`, Task 11, 4117a4d..d3d471c).
> Covers the startup flow and app state of extension spec 3.2 (`extension/src/app/useAppState.ts`, `app-state.ts`),
> the routes of spec 4.1 (`extension/src/router.ts`), the frame by role (`App.vue`, E3) and the state texts
> (`views/StateView.vue`). The OAuth callback handling moved here from `AuthCallbackView.vue`.

### Assets

- The OAuth code and `state` in the callback URL while startup runs.
- The decision which frame, navigation and pages are drawn (display only: the backend authorizes every request from
  its signed token, ChurchTools every KV write from its rights).
- Problem details of the backend (`detail`), shown to settings editors only.
- The availability of the login for a whole parish (login loops count against the backend's per-address limit).

### Attackers

| Attacker | Can do |
| --- | --- |
| Foreign website the user visits | Link the user to any app path, including `/auth/callback` with any query and any return path |
| Logged-in plain user | Type any app path (`/manage`, `/settings/*`), edit `sessionStorage`, read the app's JavaScript |
| Wrong or misconfigured backend | Answer the login with errors, odd versions or `detail` texts containing markup |
| ChurchTools outage or rate limit | Make whoami, rights or KV reads fail or hang during startup |

### Scenarios and mitigations

| Scenario | Mitigation |
| --- | --- |
| **New 2026-11-14.** A page or the admin frame renders before the state is known (flash of a role, of data, or of the admin navigation) | `computeAppState` returns `loading` until startup ends, also while a page login leaves; the login error is set before `loading` ends; `App.vue` draws `RouterView` only when `showsRoute` allows it (`user`/`admin`, or settings pages for editors in `backend-error`). Tests for row 1 (no page, no nav while ChurchTools or the settings answer). |
| **New 2026-11-14.** A ChurchTools outage makes the app look "not set up" or grants a role without rights being known | Any failed ChurchTools read is `backend-error`; unknown `view` without a recorded failure is `no-access` (fail closed); a login without a version or with a malformed one is `version-mismatch`, never a role (`app-state.test.ts`, 54 precedence pairs). |
| **New 2026-11-14.** A plain user sets `admin: true` in `cps-token` or calls `/manage` directly to get the admin frame | Display only; the backend checks the signed `admin` claim on every request. Pages of Tasks 12–16 must check their own rights and show no data without them (carry from the Task 11 task review). **Resolved 2026-11-14 (M2, fb02f78):** routes carry `meta.requires` (`admin`: `/manage`, `/manage/:personId`, `/settings/backup`, `/settings/setup`; `editor`: the other settings pages); `routeView` draws the missing-rights banner instead of the page for anyone else, also in `backend-error` (`app.test.ts`, `app-state.test.ts`). |
| **New 2026-11-14.** Startup uses the previous person's token or decides on a login before the person is known | `configure()` + `bindPerson(whoami.id)` before any login decision and before `completePageLogin`; no `Auth` call before ChurchTools and the settings are read (`app.test.ts`). |
| **New 2026-11-14.** Open redirect after the login through the remembered return path or a crafted callback link | `safeReturnPath` (login, token section); `router.replace` only navigates inside the app; the callback route itself is never a return path. |
| **New 2026-11-14.** Login loop without user action (`oauth-code-invalid`, a dropped token right after a login), locking out a parish NAT through the login rate limit | `oauth-code-invalid` retries once per 60 s per tab (`claimLoginRetry`, false when storage can't hold the marker); a dropped token within 60 s of a page login is `backend-error` without redirect; every other callback failure is `backend-error`; „Erneut anmelden“ is a click (`auth.test.ts`, `app.test.ts`). |
| **New 2026-11-14.** The code leaks from the address bar, history or `Referer` | The URL is replaced on every exit of the callback (success, failure, early exit, setup needed); the old entry is replaced, not pushed. **Resolved 2026-11-14 (M1, fb02f78):** startup copies the query and replaces the address with the bare `/auth/callback` before any ChurchTools read and before the popup forwards (`app.test.ts`: whoami sees `/auth/callback` only). The initial page load itself still carries the code (unavoidable). A stolen code is useless without the backend's client secret (verification carried to Task 18). |
| **New 2026-11-14.** A backend `detail`, version or problem text injects markup or script | Rendered with `{{ }}` only (no `v-html` in `src/`); `detail` only for settings editors; problem slugs map to a fixed key table; minutes clamped 1..60 (`app.test.ts`: `<b>` shown as text). |
| **New 2026-11-14.** The code of a page login started against backend A is exchanged at A after `settings.backendUrl` changed to B | The token is dropped by `bound()` (backend mismatch), so it's never used against B; **Resolved 2026-11-14 (M3, fb02f78):** `completePageLogin` throws `LoginStateError` before the exchange when the stored backend base differs from the configured one (`auth.test.ts`). Without `configure()` it still uses the stored backend; the app always configures first (call-order tests), so this path is unused. |

### Accepted risks

- **Proposed 2026-11-14: frame and navigation follow the stored token's `admin` flag without a backend round-trip at
  startup.** A user who edits it sees the admin frame with empty pages; the backend refuses every admin request.
- **Proposed 2026-11-14: settings editors get the settings pages in `backend-error`** (spec 3.1.2), so a broken backend
  can be fixed; those pages read and write ChurchTools KV under ChurchTools' own rights.

## Extension (frontend): „Passwörter verwalten“ (an admin acting for another person)

> **New 2026-11-14** (security review, review point A of `feature/extension-rework`, Task 13, 49a271f..fb7ea82).
> Covers extension spec 4.3: `extension/src/views/ManageView.vue`, `src/admin/manage.ts` (`searchUsers`,
> `parsePersonId`), the `forName`/`hasEntry` part of `src/password/PasswordFlow.vue`, and the route
> `/manage/:personId?` (`meta.requires: 'admin'`).

### Assets

- Every other person's secondary password: an admin can replace it (and receives a generated one in clear) or delete
  it. Replacing it locks the person out of WiFi/RADIUS until they get the new one; whoever learns it can log in as them.
- The admin's own ChurchTools password, typed in the flow or inside the delete dialog when
  `requirePasswordForPasswordChange` is on (backend spec 4.6/4.7: always the caller's own).
- The member list of the users group (names and person IDs), read with the admin's ChurchTools session.

### Attackers

| Attacker | Can do |
| --- | --- |
| Foreign website or mail | Send the admin a link to `/manage/<any id>` or `/manage/<garbage>` |
| Plain user | Open `/manage` directly, edit the stored token's `admin` flag, call the backend with any person ID |
| Person with a crafted ChurchTools name | Put markup or vue-i18n message syntax (`{x}`, `@:`, `|`) into their first/last name or title |
| Admin in a hurry | Pick the wrong person, answer a stale dialog, double-click, navigate while a dialog is open |
| Admin (malicious) | Everything the backend allows the `admin` claim; not defensible in the UI |
| Holder of a stolen admin token (15 min) | The same requests as the admin, without the UI |

### Scenarios and mitigations

| Scenario | Mitigation |
| --- | --- |
| **New 2026-11-14.** A plain user opens `/manage` or fakes the admin flag to act for others | Display only. The route is `requires: 'admin'` (missing-rights banner) and the page itself loads nothing (no `access`, no members, no entry) unless the app state is `admin` (`ManageView.test.ts` „the page checks its own right“, „a plain user loads nothing“). **The real check is the backend's:** PUT/DELETE/GET of another person's entry only with the signed `admin` claim (backend spec 4.3), the primary password checked is the caller's and counts against the caller (4.6, 6.3), existence check before PUT (D7). |
| **New 2026-11-14.** A crafted link `/manage/<id>` makes the page act on someone outside the users group or on a malformed ID | `parsePersonId` accepts only plain decimal positive safe integers; the person must be in the loaded member list, otherwise a notice and no request at all (tests for outsider, unknown, `abc`, `05`, `0`, `-2`, `1e1`, 20 digits). A link only selects; every change needs a click and, for others with an entry and for deleting, a confirm dialog. Clickjacking: ChurchTools sends `X-Frame-Options: SAMEORIGIN`. |
| **New 2026-11-14.** A confirm dialog fails open (replace or delete goes through without a yes) | Only `confirmed: true` proceeds; Escape, backdrop and „Abbrechen“ give `false`; an unanswered dialog never resolves (nothing sent). The replace question is asked unless the status was known to be `none` when the flow opened, and once a status read becomes `loading`/`error`/`set` it stays asked (I1 fix, tests „pending“/„failing“). Delete is a danger dialog with focus on „Abbrechen“. |
| **New 2026-11-14.** A stale dialog (opened for person A) is answered after navigating or switching to person B | The flow is keyed by person and unmounts on a switch, so its `alive` guard drops the send; the delete re-checks `alive` and that the selected person is still the one named in the dialog before sending (M1 tests). The stale dialog stays visible but sends nothing (task-review N2, accepted UX). |
| **New 2026-11-14.** Double click sends two changes or opens two queued dialogs | `pending` set synchronously before the first `await` on both buttons; `busy` in the flow (M2 tests). |
| **New 2026-11-14.** Plaintext of person A survives a switch to person B | Picker hidden while the flow is open; a switch via the address closes the flow; the flow clears typed and generated values on unmount and drops a generated password that arrives later („switching to another person … drops what was typed“). |
| **New 2026-11-14.** The admin's ChurchTools password in the delete dialog persists | Kept only in the dialog's ref, cleared on confirm, cancel, close and unmount; `autocomplete="current-password"`; sent only in the DELETE body via `backendFor` (token and body only to the configured backend). |
| **New 2026-11-14.** A ChurchTools name injects markup or message syntax into the banner or dialogs | Names are passed only as named parameters or `{{ }}` / an `I18nT` slot, never as part of a message; no `v-html` (test „ChurchTools names are plain text“ over list, card, banner and both dialogs). |
| **New 2026-11-14.** Backend `detail` leaks internals to the wrong reader | `detail` only for admins/settings editors (the page's reader is an admin), as plain text under „Details“. |
| **New 2026-11-14.** The admin picks the wrong one of two members with the same name | **Resolved 2026-11-14 (98a76ea):** „ID {id}“ under every name in the picker, on the card and in both dialogs (`ConfirmDialog` `subject: {name, detail}`, plain text); the ID comes from the loaded member list and the dialog's person is the one acted on (flow keyed by person, delete re-checks the person). The search also matches a digit word against the ID, but only within the users-group member list, so it reaches nobody outside it. |
| **New 2026-11-14.** An admin's change of someone else's password can't be attributed afterwards | The backend logs successful writes and deletes with the target person and entry only (`KvPasswordRepository`), not the acting principal; only the login line `User <id> logged in as admin.` can be correlated. **Open (MINOR, backend carry):** log `<principal> set/deleted the password of person <target>` at `info`. **Raised to IMPORTANT at review point B (2026-11-14):** several accepted risks (admin group trusted, E15) rely on detection after the fact, and this is the only trace of an admin taking over someone's WiFi identity; fix before release. **Resolved 2026-11-14 (Task 22, 12dbb73; review point A security APPROVED):** `SetPassword` and `DeletePassword` log `User <admin> set/deleted the password of person <target>.` at `info` after the write, IDs only (`LoggingApiTest` admin-for-other, delete, failed-change-logs-nothing). Residual (MINOR): "deleted" is logged even when no entry existed. |

### Accepted risks

- **Proposed 2026-11-14: the users-group restriction is a UI convenience.** The backend lets the `admin` claim set,
  read or delete the entry of **any** existing ChurchTools person (backend spec 4.3, 4.6), not only users-group
  members. An admin (or a stolen admin token) can create an entry for a non-member with devtools; the admin role is
  already trusted as much as a ChurchTools admin (E15). Whether consumers such as ct-radius also check the users group
  is their contract.
- **Proposed 2026-11-14: replace without a question after a concurrent change.** If the status was `none` when the flow
  opened and someone else sets a password meanwhile (another admin, the person in another tab), the admin's write
  replaces it without the confirm dialog; the backend has no conditional write.
- **Proposed 2026-11-14: the member list is read once per visit.** A person removed from the users group during the
  visit stays selectable until the page is opened again; the backend would accept the change anyway (see above).
- **Proposed 2026-11-14: the target's person ID ends up in the browser history** (`/manage/<id>`); IDs only, no names.

## Extension (frontend): settings overview, „Passwortregeln“ and „Texte“

> **New 2026-11-14** (security review, review point A of `feature/extension-rework`, Task 14, 98a76ea..40f4b4e).
> Covers extension spec 4.4–4.6: `extension/src/admin/useSettingsForm.ts`, `src/views/settings/{SettingsView,
> SettingsFormPage,RulesView,TextsView}.vue`, the `repair {kept, broken}` part of invalid `settings` reads
> (`src/store/repository.ts`) and the routes `/settings`, `/settings/rules`, `/settings/texts` (`requires: 'editor'`).
> The KV store rules themselves are in the section "ChurchTools layer and KV store" above.

### Assets

- The password policy every user's flow and the backend follow (`requirePasswordForPasswordChange`,
  `allowCustomPassword`, `passwordLength`): weakening it weakens every secondary password set afterwards.
- `backendUrl` and `oauthClientId` in the same stored value: these pages must carry them through unchanged (E15).
- `texts`: shown to every user on „Mein Passwort“.
- Unknown and old-layout data in `settings` that a save might drop, and the conflict detection (`revision`).
- The self-test result (`GET /v1/test`, admin only) and the admin token it is sent with.

### Attackers

| Attacker | Can do |
| --- | --- |
| Plain user | Open `/settings/*` directly, fake the stored token's `admin` flag |
| Settings editor of `settings` (not admin) | Everything ChurchTools allows on the category: any JSON through the API, bypassing these pages |
| Two editors at once (or one in two tabs) | Save stale copies over each other |
| Someone who stores a broken value (bug, manual edit, partial old tool) | Make `settings` `invalid` mid-visit, with or without a usable `revision` |

### Scenarios and mitigations

| Scenario | Mitigation |
| --- | --- |
| **New 2026-11-14.** A plain user or a forged admin flag opens the rules or texts page to change the policy | Display only: route `requires: 'editor'` and each page reads nothing unless `settingsEditor.settings` (from the ChurchTools rights at startup); the real gate is ChurchTools' `edit custom data` on `settings` for every KV write (`RulesView.test.ts`/`TextsView.test.ts` „without edit custom data … nothing read“). A forged admin flag on the overview triggers a `readAccess` that ChurchTools refuses (no data) and a self-test the backend refuses (signed claim). |
| **New 2026-11-14.** Saving rules or texts changes, drops or reverts `backendUrl`/`oauthClientId` (E15) | Both pages save the whole value of their **own fresh read**, so the two fields go back exactly as stored (only the trailing-slash normalization both sides apply); a change by someone else in between bumps `revision` and is a conflict, never an overwrite (`RulesView.test.ts`, `TextsView.test.ts` keep backendUrl/oauthClientId and unknown fields). `app.reloadSettings()` after a save keeps the startup address (Task 12 F1). |
| **New 2026-11-14.** The repair of an invalid stored value invents, drops or weakens something | Repair only for `schema` 2 with an integer `revision`, only on „Passwortregeln“, only as an explicit save the editor sees first; refused when `backendUrl` or `oauthClientId` is present but invalid; valid fields kept as stored, missing or broken rules get `true`/`false`/16 (a stored length above 64 → 64, since 4bd4cc2, `settings-repair.ts`); unknown fields survive through the store's merge; old-layout values (no `schema`) get no repair, so their migration data stays (`repository.test.ts` „invalid reads say what a repair keeps“). |
| **New 2026-11-14.** A stale copy overwrites a newer value | `revision` compared right before writing; on a mismatch nothing is written and the page says so (conflict tests on both pages). Residual race: accepted risk of the KV section. **Resolved 2026-11-14 (4bd4cc2):** `revision` must be a safe integer 0..`MAX_SAFE_INTEGER`−1; a stored integer outside that range reads `invalid` without a revision (no repair) and every save is refused (`InvalidValueError`), never treated as 0 (`repository.test.ts` for −1, 2^53−1, 2^60 and the top usable value). A non-integer stored revision still counts as 0 (Task 7 ruling); no settings page can save over it because such a read is `invalid` without a form. |
| **New 2026-11-14.** A save silently removes data the editor never saw (invalid `texts`, retired v1 fields) | Read issues are listed in a banner before any save („shows dropped parts … before saving“); retired v1 fields are removed by design (KV section). |
| **New 2026-11-14.** Custom texts inject markup or vue-i18n syntax into every user's page | Bound as input values and shown with `{{ }}` only, never through `$t`, no `v-html` in `src/`; title ≤ 60 and intro ≤ 300 checked in the page and again by the store schema („custom texts are plain text … shown literally here and on Mein Passwort“). **Since 4bd4cc2:** bidi embedding/override/isolate controls (U+202A–202E, U+2066–2069) are refused at the field and by the texts schema (stored ones drop `texts` with an issue); a text of only whitespace and format characters (`\p{Cf}`, e.g. U+200B) counts as empty, so the default shows (`isBlankText`). Phishing wording itself stays the trusted-editor accepted risk of the KV section. |
| **New 2026-11-14.** The self-test sends the admin token to another host, or its messages leak details | Sent through `services.backend(url)`, which attaches the token only to the configured backend (`tokenFor`), with `write` explicitly false (pinned since 4bd4cc2); shown as counts only („never the messages“); not run for non-admins. |
| **New 2026-11-14.** Unsaved changes are lost, or a half-edited policy is left behind unnoticed | Leave guard (router confirm and `beforeunload`) while dirty; nothing is written before Save. |
| **New 2026-11-14.** Admins revisiting the overview make the backend's self-test (service user reads of persons, `passwordStore`, rights) run again and again, using ChurchTools rate limits shared with ct-radius and the cleanup job | **Resolved 2026-11-14 (4bd4cc2):** a successful result is kept in app state for 5 minutes per backend address (failures aren't cached); admin only, read-only. The pill may lag a fresh problem by up to 5 minutes (display only). |

### Accepted risks

- **Proposed 2026-11-14 (Task 14): repair is reachable only when `settings` break during a visit** (with a broken value
  at startup the app is `setup-needed`, and only the setup wizard or a manual fix helps).

## Extension (frontend): „Zugriff“ and machine clients

> **New 2026-11-14** (security review, review point A of `feature/extension-rework`, Task 15, 4bd4cc2..655d907).
> Covers extension spec 4.7: `extension/src/views/settings/{AccessView,ClientFormView}.vue`,
> `src/admin/machine-clients.ts`, the `unusable` list and `saveAccess(…, dropUnusable)` of `src/store/repository.ts`.
> The reading rules themselves are in the section "ChurchTools layer and KV store" above; the backend's
> `AccessParser` decides what is enabled.

### Assets

- The set of machine clients the backend enables with `entries:read`: each one can read every secondary password.
- The match between what admins see on „Zugriff“ and what the backend enables (no hidden or look-alike reader).
- The ChurchTools person ID in `createdBy` (whoever added a client), readable by the admin group and the service user.

### Attackers

| Attacker | Can do |
| --- | --- |
| Admin with write on `access` who is about to leave (or a compromised admin account) | Store any JSON in `access` through the API, bypassing the form; wants a reader that survives their removal from the admin group |
| Remaining admin | Acts on what „Zugriff“ shows; can be misled by look-alike entries |
| Settings editor without write on `access` | Opens the pages directly |

### Scenarios and mitigations

| Scenario | Mitigation |
| --- | --- |
| **New 2026-11-14.** A new client gets read access the editor didn't intend | `permissions: []` for a new client until the toggle is turned on; the toggle writes only `entries:read`; unknown permissions are dropped on read with an issue and grant nothing in the backend. |
| **New 2026-11-14.** Two clients share a key (also base64 vs base64url), or a new client takes the id or key of a stored entry the backend disables | Keys compared as bytes on the spot and over the whole list (`validateClients`, same rules as `AccessParser`); the store refuses a collision with a preserved unusable entry (`InvalidValueError`). |
| **New 2026-11-14.** A removal drops another entry than the one confirmed (stale index, concurrent save) | Removal of a client filters by id and saves with the read's revision; removal of an unusable entry sends index **and** raw id and the store refuses if either changed (`ConflictError`). Residual race without revision change: KV accepted risk. |
| **New 2026-11-14.** A stored `id`, `name` or group id reaches markup or a link | Plain-text interpolation only; the group link is built from the ChurchTools base URL and a positive integer group id (`groupPageUrl`), never from stored text; raw ids of unusable entries are isolated (`<bdi>`) and cut to 40. **Resolved 2026-11-14 (98f25d4):** client, creator and group names in `<bdi>`, dialog strings wrapped in U+2068/U+2069; bidi controls refused in new or changed names (form and store), stored ones kept (backend parity). **Resolved 2026-11-14 (f27edfe):** a disabled entry's name is cut to 60, its `createdAt` is shown as a date only if it is a real calendar date, else isolated and cut to 60. |
| **New 2026-11-14.** A departing admin makes `access` invalid as a whole in a part the backend ignores (e.g. `groups.service.createdBySetup: "x"`, `groups.users`), and plants a reader client: the backend still enables it, but „Zugriff“ shows only the invalid banner and no client list | **Resolved 2026-11-14 (d1d86f1, 98f25d4):** `ok` and `invalid` reads carry `clientEntries` (every stored entry: raw value, reasons, parsed client if enabled); „Zugriff“ lists the active ones also on an invalid value and says the backend still uses them. `removeClients(revision, refs)` removes entries from any value with a usable revision, changes only `machineClients` and `revision`, and refuses on a revision, index, raw-id or entry-JSON mismatch. **Resolved 2026-11-14 (f27edfe):** a stored non-integer `revision` counts as 0 for `removeClients` (as on save; `clientsRevision` on invalid reads), an out-of-range integer is still refused; fractional or out-of-range indices are refused (`ConflictError`). |
| **New 2026-11-14.** A departing admin adds a second entry with the id of a legitimate client (own key, `entries:read`): both are disabled; the remaining admin, seeing two identical „radius – ID doppelt“ rows, removes the legitimate one and so enables the planted reader, which then looks like the real client | **Resolved 2026-11-14 (98f25d4):** every row (active and disabled) shows name, permission, `createdAt`/`createdBy` and a fingerprint per key (first 16 characters of base64url(SHA-256(key bytes)), display only; key equality is still checked on the bytes); the confirm names every entry the removal would enable (`newlyEnabled`) and, for a duplicate id, suggests removing all. **Since f27edfe:** 16 characters (96 bits), so grinding a look-alike key is out of reach. |
| **New 2026-11-14.** A settings editor without write on `access` opens „Zugriff“ or the client form | Nothing is read unless `settingsEditor.access`; ChurchTools enforces `edit custom data` on every KV write. |

### Accepted risks

- **Proposed 2026-11-14 (Task 15, round 2): a self-written SHA-256 is used for key fingerprints.** It is display
  only, on public data, tested against `node:crypto` at the padding boundaries; no security decision depends on it.
- **Proposed 2026-11-14 (Task 15): `createdBy` keeps the creator's person ID** as long as the client exists (an
  audit note, visible to the admin group and the service user only; a creator ChurchTools no longer shows is listed by
  ID). Removing the client removes it.
- **Proposed 2026-11-14 (Task 15): the admin group is trusted to manage machine clients.** Whoever writes `access` can
  add a reader; the extension only makes every enabled client visible and removable, it can't prevent an admin from
  adding one. Detection after the fact relies on admins reviewing „Zugriff“ and, since Task 22 (2026-11-14), on the
  backend's `notice` lines for every change of the enabled clients.

## Extension (frontend): build/dev boundary and secrets in the dev setup

> **New 2026-11-14** (security review, review point A of `feature/extension-rework`, Task 17, 1037d32..ce50897).
> Covers extension spec 13.5/13.6: demo mode (`extension/src/dev/`), real mode through the Vite dev proxy
> (`scripts/dev-proxy.ts`, `vite.config.ts`), `envPrefix`, `scripts/check-dist.js` and the credential files of the
> development setup (`.env`, `phpunit.xml`, `credentials.php`, recorded fixtures).

### Assets

- `CT_LOGIN_TOKEN`: a ChurchTools login token, effectively a permanent password of its account (valid until that
  account's password changes), with every right of that account on the instance in `CT_BASE_URL`.
- Old `.env` values (`VITE_USERNAME`, `VITE_PASSWORD`) from before the rework, and the backend's dev credential files.
- The integrity of the production bundle: no fake backend or fake ChurchTools (they would "store" passwords that never
  reach the backend), no demo data, no dev credentials, the backend login on, `https://` only.

### Attackers

| Attacker | Can do |
| --- | --- |
| Website the developer visits while `npm run dev -- --mode real` runs | Send cross-site requests to `http://localhost:5173` (simple requests reach the server; Vite's default CORS hides responses; `allowedHosts` stops DNS rebinding) |
| Other user or process on the developer's machine or LAN | Reach the dev server port (all local users; the LAN with `--host`); read world-readable files |
| Anyone with read access to the repository or a release | Find a committed `.env*` file or credentials inlined into `dist/` |
| Mistaken developer or CI job | Build with a non-production mode or `NODE_ENV`, or deploy without `check-dist` |

### Scenarios and mitigations

| Scenario | Mitigation |
| --- | --- |
| **New 2026-11-14.** Demo code, fakes or demo data ship in the production bundle | Literal `import.meta.env.DEV && MODE !== 'real'` in `main.ts` (only importer of `dev/`, `dev-boundary.test.ts`); every `dev/` module carries `__DEMO__` in code (`markers.test.ts`, minified); `check-dist` fails on the marker and on `DEMO_STRINGS` in every text file and fails closed when they can't be loaded; `build.test.ts` proves a development build is caught. Verified on a real `npm run build` (review 2026-11-14). Supersedes the Task 8 F4 entries above. |
| **New 2026-11-14.** A `VITE_*` value of an old `.env` (password) is inlined into a build | `envPrefix: 'CPS_PUBLIC_'` (nothing uses it); `CT_*` read only by `vite.config.ts` for `serve` outside preview (`dev-proxy.test.ts`); `check-dist` fails on the key names. Verified: no `.env` value inlined into `dist/`. |
| **New 2026-11-14.** The login token reaches the browser, logs, error messages or `vite preview` | Added server-side as a proxy header only; `devProxy` errors never repeat values (tested); no proxy for build or preview (tested); `CT_BASE_URL` must be `https://` without userinfo. |
| **New 2026-11-14.** A cross-site page makes the developer's dev proxy send writes to the real instance with the login token (confused deputy / CSRF on localhost) | **Resolved 2026-11-14 (e7b216c, round 2 of review point A, Task 17):** `proxyRefusal` refuses a non-loopback or malformed `Host` (DNS rebinding; HTTP/2 without `Host` fails closed), `Sec-Fetch-Site` other than `same-origin` (also `same-site` from other localhost ports, and `none`), and an `Origin` other than the dev server; the rule's `bypass` answers 404 and forwards nothing; the `proxyReq` handler re-checks the same (immutable) headers before adding the token and destroys refused requests; `Cookie` and `Origin` are dropped. No `ws` on the rule, so upgrades are never proxied (`dev-proxy.test.ts`). Residual: very old browsers without fetch metadata can send cross-site GETs (no side effects expected; responses aren't readable). |
| **New 2026-11-14.** Real mode with `--host`, or on a shared machine, lets others use the token through the proxy | **Resolved for the network 2026-11-14 (e7b216c):** `realModeGuard` stops the dev server in mode `real` unless `server.host` is unset, `localhost`, `127.0.0.1` or `::1`; docs warn. Other users and processes on the same machine can forge every header: accepted risk below. |
| **New 2026-11-14.** The token is put into `.env.real` (Vite's file for `--mode real`) and committed | **Resolved 2026-11-14 (e7b216c):** `.env.*` ignored (`.env-example` stays tracked); secret scanning in CI (Task 20). |
| **New 2026-11-14.** A production bundle without backend login (`backendLogin: false`) or with `http://localhost` backends | `http://` removed from the backend client entirely (`http.test.ts`, `dev-boundary.test.ts`); `backendLogin` is `!DEV`, so `true` in a normal build. A build with `NODE_ENV=development --mode real` gets `false` and passes `check-dist` (fails closed: no login); Task 20 should assert a production build. |
| **New 2026-11-14.** Credential files readable by other local users | Docs: `install -m 600` before filling in, `chmod 600` for existing files, migrate and delete old `VITE_*` lines (`extension/docs/development.md`). |

### Accepted risks

- **Proposed 2026-11-14 (Task 17): the demo state lives in `localStorage` of the dev origin** (`cps-demo-state`, plain
  text): invented data, plus anything the developer types in demo mode (custom passwords). Development only; don't type
  real passwords into the demo.
- **Proposed 2026-11-14 (Task 17): real mode covers the ChurchTools side only.** No backend login on the dev server
  (no `/oauth` proxy, which would authorize as the token's user without asking); backend flows are tested on the hosted
  test build and in the contract and browser checks.
- **Proposed 2026-11-14 (Task 17, round 2): local processes and users can use the real-mode proxy.** Header checks
  stop browsers, not a program on the same machine (which can send any `Host`, `Origin` and `Sec-Fetch-Site`). A process
  of the developer's own account could read `.env` anyway; on a shared machine other accounts could reach the loopback
  port too, so real mode belongs on a single-user machine.
- **Proposed 2026-11-14 (Task 17): a login token is a long-lived credential.** Use a dedicated test account on a test
  instance with only the rights needed; changing that account's password revokes it.

## Extension contract-test harness and the shared test instance

> **New 2026-11-14** (security review, review point A of `feature/extension-rework`, Task 18, e7b216c..373ecc5).
> Covers `extension/tests/contract/` (setup, ChurchTools session, OAuth code fetcher, instance helpers, backend sandbox,
> recording), `scripts/sanitize-fixture.js`, and the facts it measured (`specs/ct-extension-info.md`).

### Assets

- `CT_API_TOKEN` (the service user's login token) and the admin and normal test users' passwords from the backend's
  gitignored fixtures.
- The temporary OAuth client's secret, the sandbox's per-run `JWT_SECRET`, OAuth codes and backend tokens.
- The shared test instance's state: the installed extension's `settings`/`passwordStore`, the test users' rights,
  groups and OAuth clients.

### Attackers

| Attacker | Can do |
| --- | --- |
| Reader of test output (terminal, CI log, agent transcript, ledger) | Read anything printed in assertion messages, errors or unhandled rejections |
| Other local user or process on the developer's machine | Reach the sandbox's loopback port; read world-readable temp files; see process arguments in `ps` |
| A crashed or interrupted run | Leave temporary objects, grants, probe values or a running sandbox behind |
| A second contract run at the same time (the backend's contract suite, another developer or agent) | Delete or change the other run's objects |

### Scenarios and mitigations

| Scenario | Mitigation |
| --- | --- |
| **New 2026-11-14.** A credential shows up in test output | Error messages carry method, path, status and `redactBody` only; OAuth errors name only parameter names; the login error names only the fixture id. **Resolved 2026-11-14 (250b71f):** `ctApiFor`'s last response interceptor passes errors through `scrubAxiosError` (HTTP errors keep only status, headers and data; network errors become a plain message with the code), so `config`/`request` with `Authorization: Login <CT_API_TOKEN>` never reach an unhandled rejection (`helpers.unit.test.ts`, also through `ctApiFor`). `redactBody` now uses the sanitizer's `SECRET_KEY`. |
| **New 2026-11-14.** Credentials visible in `ps`, files or git | The sandbox gets everything through its environment (`/proc/<pid>/environ` is owner-only); its arguments are the port and the router path; `sandbox/credentials.php` holds no values; cache and log folders under a 0700 `mkdtemp`, deleted on stop; recorded fixtures 0600 in a 0700, gitignored folder. |
| **New 2026-11-14.** Another local user talks to the sandbox (127.0.0.1) | Only `POST /v1/auth/token` works without a token, and it needs a fresh ChurchTools code; the JWT secret is 256 random bits per run; no `CLEANUP_TOKEN`, so no cleanup route. |
| **New 2026-11-14.** The `https→http` mapping or `HTTPS=on` leaks into production | `vi.stubGlobal` in test code only, for `https://backend.contract.invalid` (never resolves); `HTTPS=on` only in `tests/contract/sandbox/router.php`; `backend/public` and `src/backend/http.ts` unchanged. |
| **New 2026-11-14.** The run changes real data on the test instance | Backend half refuses to start if a touched fixture person has a `passwordStore` entry; temporary groups/clients carry one name and are removed (also stale ones at start); the login right is granted for the temporary client only and removed with a grant comparison. **Resolved 2026-11-14 (250b71f):** the real subject names `writeCategoryId` (`passwordStore`, found by name) and every write case and the cookieless probe use it; a missing category fails the case. `CtSession` checks every absolute URL (any scheme) against the instance origin. |
| **New 2026-11-14.** A crashed run leaves things behind | Next start removes stale groups and clients by name, and before deleting a stale client the normal user's login right for it. **Since 250b71f:** the PHP child is killed on `exit`, `SIGINT` and `SIGTERM` (not on `SIGKILL` of the test process: residual); stale `cps-backend-sandbox-*` folders are removed at start; `passwordStore` probe leftovers fail closed (documented). **Residual (MINOR, new 2026-11-14):** the folder sweep runs over the whole of `os.tmpdir()`: a same-prefix folder of another local user makes `rmSync` throw and the sandbox start fail (nuisance only; symlinks are removed, not followed). Limit it to folders owned by the current uid and ignore errors. **Resolved 2026-11-14 (2620400):** `sweepStaleDirs` only touches own-uid folders. |
| **New 2026-11-14.** Two runs at the same time on one instance | Not prevented; the runs delete each other's objects and fail loudly. **Since 250b71f:** `docs/development.md` says one contract run per instance at a time. |
| **New 2026-11-14.** Recorded fixtures keep personal data | `sanitize-fixture.js` blanks secret keys, names and contact keys, the host, JWTs, e-mails and long opaque runs. **Since 250b71f:** `comment`, `memo`, `country`, `dateOfBirth`, `job`, `sexId`, `imageUrl`/`familyImageUrl` are replaced; long runs are kept only when they look like a lower-case URL path. Residual: still a denylist; new ChurchTools fields need adding. |
| **New 2026-11-14 (measured fact).** ChurchTools accepts REST writes with `Authorization: Login` and no cookie and no or a bogus CSRF token | A login token is a complete bearer credential: whoever holds `CT_API_TOKEN` (backend `credentials.php`, `phpunit.xml`, the dev `.env`) can write every KV category the service user can, CSRF doesn't apply. The dev proxy's own origin checks (Task 17) are therefore the only CSRF defence there. Not measured: whether cookie-authenticated REST writes from a foreign site are accepted (SameSite of the ChurchTools session cookie, content types); if so, a page visited by a settings editor could rewrite `settings` (e.g. `backendUrl`). Worth one manual check on the test instance. **Raised at review point B (2026-11-14), see the point-B section:** a cross-site *create* (POST) is enough, because the extension reads the duplicate with the highest ID. |
| **New 2026-11-14 (measured fact).** A leaked OAuth code is exchanged without the backend | Confirmed refused: no secret → `400 invalid_request`, wrong secret → `401 invalid_client`. Closes the "To verify" item of the backend-channel section. |
| **New 2026-11-15 (Task 24, e45d5e5).** The sandbox's settings/admin override (`CPS_SANDBOX_SETTINGS`, `CPS_SANDBOX_ADMIN_GROUP_ID`, `tests/contract/sandbox/SandboxChurchTools.php`) reaches a real deployment, so a host environment variable could switch off the primary-password check or name an admin group | The wrapper lives in `extension/tests/contract/sandbox/` (namespace `CtPassStore\ContractSandbox`, not under the backend's PSR-4 root `src/`), is loaded only by `require_once` in the sandbox's `router.php`, and nothing in `backend/src` or `backend/public` reads `CPS_SANDBOX_*`; the backend release zip is built from `backend/` only and the extension zip from `dist/` only. Residual: `router.php` duplicates `Kernel::bootstrap()`'s wiring (drift possible; test fidelity only; since f0ab667 `bootstrap()` names the copy, and `sandbox-overrides.unit.test.ts` runs the wrapper and the router, with dummy values and no network, in `npm test` where PHP and `backend/vendor` exist). |
| **New 2026-11-15 (Task 24).** The settings variants or the admin subject change the shared instance (settings written, a group created, someone made admin) | Override is read-side only: exactly two booleans replaced in the settings value as read; a made-up `access` category with id `-1`; every write to the overridden categories throws `LogicException` (`sandbox-overrides.test.ts`); the admin group is an existing group the normal user is already an active member of, found with a read-only `GET /persons/{id}/groups`. Inside the admin sandbox every active member of that group counts as admin, but only the normal user holds the temporary client's login right and the JWT secret is per run, so nobody else can obtain a token there. |
| **New 2026-11-15 (Task 24).** The run locks the normal test user out of ChurchTools (failed `POST /login`) | The wrong-primary-password cases run only in the "strict" variant: 3 deliberately failed ChurchTools logins per subject, 6 per run (up to 18 if each is answered `upstream-rate-limited` and retried by `patiently`); the harness's own `CtSession.login` retries only `429` (correct password) and never a refused login; the backend login (`POST /v1/auth/token`) is never retried. ChurchTools' failed-login policy for the test instance is not measured. **Resolved 2026-11-15 (f0ab667):** the wrong-password cases run for strict/user only (`wrongPrimaryPasswordCases: false` elsewhere), so 3 deliberately failed ChurchTools logins per run, each followed by a successful one; `patientApi` (`tests/contract/patience.ts`) never resends a PUT/DELETE whose primary password differs from the correct one (`patience.unit.test.ts`); `docs/development.md` states the count. Residual: ChurchTools' lockout policy stays unknown (deliberately not probed); covered by the proposed accepted risk below. |
| **New 2026-11-15 (Task 24).** A hook or case times out while a rate-limit wait is running, `afterAll` cleans up, and the still-running set-up or case creates objects afterwards (temporary OAuth client and login grant, a running sandbox, a `passwordStore` entry of a touched person) | `vi.setConfig` raises only `testTimeout` (600 s); `hookTimeout` stays 180 s while `beforeAll` can wait up to 180 s per login (several logins). Leftover client and grant are removed by name at the next start; a leftover entry makes the next run refuse to start (fail closed); sandbox children die with the test process (not on `SIGKILL`). **Resolved 2026-11-15 (f0ab667):** `hookTimeout` 900 s (set in `vi.setConfig` and on `beforeAll`/`afterAll`), above the 540 s worst case of the set-up's three fixture logins. A case that passes its 600 s `testTimeout` can still write after cleanup (fails closed at the next start). |

### Accepted risks

- **Proposed 2026-11-14 (Task 18): the contract run needs the admin fixture's password and a temporary "login to
  external system" grant** for the normal test user (maintainer-approved), on the test instance only.
- **Proposed 2026-11-14 (Task 18): the "admin" backend subject uses a token minted with the sandbox's own secret**,
  because the test instance has no admin group; the real admin login path is not exercised against ChurchTools.
  **Narrowed 2026-11-15 (Task 24, e45d5e5):** the admin subjects now log in for real on a sandbox whose backend sees
  a made-up `access` value naming an existing group of the normal user (membership read from ChurchTools as in
  production); only one wire check still uses a minted token.
- **Proposed 2026-11-15 (Task 24): a contract run makes a bounded number of deliberately failed ChurchTools logins
  for the normal test user** (3 per run since f0ab667, never resent), on the test instance only; ChurchTools' lockout
  policy for it is unknown.

## Whole system after the extension rework (review point B of `feature/extension-rework`)

> **New 2026-11-14** (security review, review point B, full branch `91d78ec..feature/extension-rework`). Looks across
> the sections above: login → token bound to backend and person → set/replace/delete (self, as admin) → settings,
> access and backend changes → machine-client reads. Only scenarios not covered above are listed.

### Attack paths considered (attacker's view)

| Attacker | Most promising path | Gain | Defended? |
| --- | --- | --- | --- |
| Outsider (no account) | Make a settings editor's browser write the KV store cross-site (CSRF), see below | Every user's ChurchTools password (E15 path without the rights) | **Measured 2026-11-14 (Chromium):** ChurchTools refuses cookie-only cross-site writes (`401` „CSRF-Token is invalid“; `no-cors` sends no cookie). **Since Task 21 (a8b95a3):** a planted second value is never used anyway (fail closed), so even a working CSRF create would only stop the service. Firefox not measured. |
| Outsider | Login CSRF / code theft via the callback, open redirect | Account confusion | Yes (state, origin checks, `safeReturnPath`; sections above) |
| Plain user | Fake `admin` in `cps-token`, call `/manage`, call the backend directly | Nothing | Yes (display only; backend checks the signed claim) |
| Plain user | Craft their ChurchTools name with bidi controls | Confusing admin dialogs | Mostly (IDs shown; since 48242ba names isolated on „Passwörter verwalten“; plain-text isolate escapable by an embedded U+2069, see row below; **resolved 2026-11-15, ea0ec4c**: controls inside are replaced) |
| Admin / settings editor (malicious or departing) | Change `backendUrl` (E15), plant a machine client, replace someone's secondary password | ChurchTools passwords, all secondary passwords, WiFi as another person | Accepted (E15, trusted admin group); **detection** relies on logs that don't exist yet. **Updated 2026-11-14 (Task 22, 12dbb73):** detection now exists in the backend log: `notice` for a changed enabled machine-client set and `backendUrl`, `info` for every set/delete with actor and target, hourly usage summary per client with addresses (setup.md lists what to look for). Admin-group changes are logged at `notice` too since 823d1ce (2026-11-15). |
| Stolen admin token (15 min) | Replace / delete entries | WiFi identity of others | Bounded by lifetime; **attributable since Task 22** (`User <admin> set/deleted the password of person <target>.`) |
| ChurchTools system admin / module uploader | Replace the extension bundle, read `passwordStore` | Everything | Accepted (trusted) |
| Stolen backup of `config/` | Forge admin tokens | Admin role | Accepted (rotate `JWT_SECRET`) |

### Scenarios and mitigations

| Scenario | Mitigation |
| --- | --- |
| **New 2026-11-14 (point B).** A foreign page visited by a settings editor sends a cross-site `POST …/customdatacategories/{settings}/datavalues` (a form or `no-cors` fetch with a `text/plain` JSON body). It **creates** a second `settings` value with the attacker's `backendUrl`. The extension reads the duplicate with the **highest** ID (`store/repository.ts` `load()`), so every user's browser sends codes, ChurchTools passwords and new secondary passwords to the attacker. The backend refuses duplicate `settings` (`misconfigured`), which doesn't help because the extension no longer talks to it. The next editor save keeps the attacker's value and **deletes the original**; duplicates are not shown anywhere in the UI (spec 6.2 "reported to admins" isn't implemented). The same works for `access` (a planted reader becomes enabled after the next save on „Zugriff“). | **Open (IMPORTANT).** (1) Measure on the test instance whether ChurchTools accepts cookie-only cross-site REST writes (manual check in the point-B report). (2) Whatever the result, don't let a newer duplicate win silently: read duplicates of `settings` fail closed for users (like the backend), or take the **lowest** ID, show the duplicates to editors and let them choose before a save deletes anything. Ids are small integers and the module/category ids are readable by every user, so they can be guessed. **(1) Measured 2026-11-14 (Chromium):** not reachable on this ChurchTools version (cross-site form → `401` „CSRF-Token is invalid“, `no-cors` sends no cookie; recorded in `specs/ct-extension-info.md`). **(2) Resolved 2026-11-15 (Task 21, a8b95a3; review point A security APPROVED with MINORs):** several values in `settings`/`access` are read as `duplicates`. At startup that is row 4a (`backend-error`): no `configure`, no login, no backend call, even with a stored token (tested). `reloadSettings` never takes over an address, and the self-test cache and popup renewal use the startup address. `save`, `saveAccess` and `removeClients` refuse while duplicates exist. `resolveDuplicates` deletes only if the stored values are exactly the ones shown (ids and full texts), writes the kept value first, and raises its revision above every shown one, so stale pages get a conflict. Every settings page and Zugriff show the values (plain text, cut, `<bdi>`, real host, invisible-character and "differs" marks). |
| **New 2026-11-15 (Task 21 review).** Someone who can create a value (or a future working CSRF create) plants a second `settings` value that copies the real one but changes `backendUrl` to a look-alike, and puts it first in the list (highest id). They hope an editor clicks the first „Diesen Wert behalten“. The confirm names only value ids | Partly: every field is shown with a "differs" mark, the real host (`xn--` for IDN) and an invisible-character note, and a warning says a value may have been planted. **Open (MINOR):** name the kept `backendUrl` and real host in the confirm when it differs, and label which value was created last. Mark differing machine-client sets on `access`. Compute "differs" on the full value, not on the 120-character cut, and show long hosts from the right. **Mostly resolved 2026-11-15 (75a2197, re-check APPROVED):** the confirm names the differing fields of the kept value (address; groups and enabled clients with fingerprints, isolated), the oldest value comes first and the newest is labelled „zuletzt angelegt“, "differs" compares full values and client sets in any order, and a rewritten host is shown in full (at most 253 characters) or cut from the left. **Still open (MINOR):** a keepable ASCII host longer than about 110 characters (`https://passwords.gemeinde.de.<padding>.evil.tld`) has no rewritten host, so the card and the confirm show only the 120-character cut from the start. Show the host of every `backendUrl` in full or from the right. **Resolved 2026-11-15 (f71cbce, re-check APPROVED):** every parseable address shows `URL.host` (what the browser connects to: IDN as `xn--`, percent escapes decoded, userinfo stripped, port included) on the card and in the confirm, in full up to 253 characters, longer ones cut from the left. Path padding can't push the host's ending out of view, and a port only adds a few digits at the end. |
| **New 2026-11-15 (Task 21 review).** A planted duplicate with `schema: 3` puts everyone into `update-needed` (row 4 beats 4a). Editors don't get the settings pages there and are told to update an extension that has no newer version | Availability only: nothing is used or sent. **Open (MINOR):** when the newer value is one of several, show row 4a (with the chooser; the newer one isn't keepable) or name the duplicates in the update text for editors. **Resolved 2026-11-15 (75a2197):** a newer value among several is row 4a; editors get the chooser and the newer value can't be kept. A single newer value is still row 4. |
| **New 2026-11-15 (Task 21 review).** A planted duplicate with `revision` = `MAX_REVISION` makes every `resolveDuplicates` choice fail ("out of range"). With `MAX_REVISION - 1`, the kept value ends at the maximum and the next save fails | Availability only. Resolving then needs the ChurchTools admin UI. **Open (MINOR):** name the blocking value in the error, or leave unkeepable or out-of-range revisions out of the raise when they belong to values being deleted. **Partly resolved 2026-11-15 (75a2197):** only keepable values count for the raise, and the error names the blocking value. A *keepable* planted value with `revision` = `MAX_REVISION` still blocks every choice; it has to be deleted in the ChurchTools admin UI. **Proposed accepted risk (availability only; the attacker can stop the service by planting a value anyway).** |
| **New 2026-11-15 (Task 21 review).** Keeping a planted value takes over its stored `backendUrl` unchanged, even one a save would refuse (`newBackendUrlProblem`: IDN or `%` in the host, invisible characters). Later saves keep it, because an unchanged address isn't checked again | The card shows the real host and the invisible-character note. **Open (MINOR):** ask again in the confirm for such an address, or don't offer to keep it. **Resolved 2026-11-15 (75a2197):** such a value isn't keepable (the chooser says why, and the store refuses it too). |
| **New 2026-11-15 (Task 21 re-check).** The planted value is the only keepable one when the real value is unkeepable for its own reasons: a legacy `backendUrl` with an IDN or rewritten host (not keepable since 75a2197), a newer schema after a downgrade, or broken JSON. The attacker can't cause this without edit rights on the real value, but then the chooser offers just one button, on the value labelled „zuletzt angelegt“ | **Open (MINOR):** when the only keepable value is the newest one, say so in the card and the confirm, and point to deleting it in ChurchTools instead if nobody recognises it. **Resolved 2026-11-15 (f71cbce):** the card and the confirm say so and advise deleting it (`delete custom data`); a banner says when no value can be kept. **Open (MINOR, availability):** ChurchTools has no known UI for extension KV values, so that advice means a REST call. Offer a guarded „Diesen Wert löschen“ in the chooser (same exact-match check as `resolveDuplicates`, never the last value). **Partly resolved 2026-11-15 (Task 26, 607d0e5):** the user guide gives the REST `DELETE …/customdatavalues/<valueId>` with the needed right. A guarded delete button in the chooser stays a maintainer decision (availability only). |
| **New 2026-11-14 (point B).** Someone with `create custom category` or `edit custom category` on the module (never granted by the table, 16.2; ChurchTools admins have it) creates or renames a category to `settings`/`access`; both sides take the first category with that name | ChurchTools admins are trusted (proposed accepted risk below); the rights check (16.4, setup plan) should warn when a category name appears twice. |
| **New 2026-11-14 (point B).** A ChurchTools person name with bidi controls (U+202E …) reorders the text around it in the person picker, the selected card, the „für …“ banner of `PasswordFlow` and the replace/delete sentences, so an admin misreads whom they act on | Partly: the dialog `subject` is `<bdi>` and „ID {id}“ is shown separately. **Open (MINOR):** wrap person names in `<bdi>` (and the message parameter in U+2068/U+2069) in `PersonPicker`, `ManageView` and `PasswordFlow`, as `AccessView` already does. **Resolved 2026-11-15 (Task 23, 48242ba):** names in `<bdi>` in the picker (name and detail), the selected card and the „für …“ banner; the replace and delete sentences wrap the name in U+2068/U+2069 (`isolate()`); no name reaches a live region or aria label (the dialog reads the `<bdi>` subject). **Residual (MINOR, new 2026-11-15):** `isolate()` (`admin/machine-clients.ts`) wraps the text without neutralizing isolate/embedding controls inside it; ChurchTools person names are not filtered, so a name containing U+2069 closes the isolate early and a following U+202E reorders the rest of the dialog sentence (an unmatched U+2066–2068 instead swallows the rest of the sentence into the isolate). The same applies to stored machine-client names and duplicate fields (bidi controls kept for backend parity). Recommended: strip or replace U+202A–202E and U+2066–2069 inside `isolate()` (one change for all callers) and test with a name containing U+2069 U+202E. `<bdi>` elements are isolated by the browser's layout and not affected. **Resolved 2026-11-15 (ea0ec4c, re-checked in point B round 2):** `isolate()` moved to `src/ui/text.ts` and replaces U+202A–202E and U+2066–2069 inside the text with U+FFFD before wrapping (all callers: ManageView, AccessView, DuplicatesChooser); the avatar initials skip `\p{Cf}` (ef94538). |
| **New 2026-11-14 (point B).** A machine client (planted or with a leaked key) reads every entry, and nobody can tell from the backend logs, because neither changes to the enabled client set nor machine-client use are logged (`MachineTokens::verify` checks a self-signed assertion per request and logs nothing) | **Open (IMPORTANT, backend).** Log the enabled set (ids, permissions, key fingerprints) at `notice` when it differs from the last one seen (on each `access` cache refresh), and a rate-limited usage summary per client (e.g. first use per hour with client id, address and request count), which stays cheap at RADIUS volume. **Resolved 2026-11-14 (Task 22, 12dbb73; review point A security APPROVED):** `SettingsChangeLog` logs the enabled set (ID, sorted permissions, 16-char key fingerprints, never keys or names) as first seen / added / removed at `notice` on every load from ChurchTools; the backend authenticates machine clients only against loaded data, so a planted reader is logged before its first read. `FileMachineClientUsage` logs the first request per client, then at most one summary per client and hour (count, up to 10 addresses, then "more than 10"), recorded only after authentication, under the record's lock, fail open. Residuals: emptying `cache/` or rotating `JWT_SECRET` relabels the current set "first seen" (needs server write; documented in setup.md); concurrent loads around a change can log it more than once (never zero times); a tampered record logs `error` + `warning` on every request until `cache/` is emptied (server write only). **Updated 2026-11-15 (823d1ce):** the warning now says which record failed its integrity check and that changes or usage aren't logged; a failed write discards the pending notices, so nothing is reported as changed that wasn't stored. A tampered record can't silence the notices without a trace: tampering gives `error` + `warning` on each load, a reset (delete or a file with another key ID) gives "first seen" lines. All machine clients now share one usage record and lock (more contention than one per client, still one small write per request). |
| **New 2026-11-14 (Task 22 review).** A writer of `access` changes `adminGroupId` to a group they control; the new admins then act as admins | Not part of the audit record. Their admin logins (`logged in as admin`) and every change of another's password (Task 22) are logged, so the effect is detectable. **Open (MINOR):** add `adminGroupId` to `audit:settings` and log its change at `notice` like `backendUrl`. **Resolved 2026-11-15 (823d1ce):** `Admin group, first seen: …` / `The admin group changed from … to ….` at `notice` (integer IDs only; `SettingsChangeLogTest`, `AuditLogApiTest`). |
| **New 2026-11-14 (Task 22 review).** Usage records `usage:<client>` in `cache/` keep up to 11 machine-client addresses until the next summary, which never comes when the client goes quiet or is removed | Only the backend reads `cache/` (`700`/`600`). **Open (MINOR, GDPR consistency with the 14-day log rule):** drop addresses (or the record) older than 14 days, e.g. in the cleanup run, and prune records of clients no longer configured; document in spec 6.1/6.4 (Task 26 carry). **Resolved 2026-11-15 (823d1ce):** one record `usage` with an entry per client (`c:<id>`); every write drops entries whose hour began 14 days ago or more, and each load of settings/access from ChurchTools keeps only the configured clients (`prune()`, under the same lock; never creates the record). Residual (MINOR, new 2026-11-15): an entry dropped by expiry or `prune()` takes its pending count and addresses with it, unlogged, so the last hour of a planted reader that is removed again, or of a quiet client, never appears in a summary (its first request in each hour does, with its address, and the add/remove `notice`s are logged). Log the pending summary before dropping. **Resolved 2026-11-15 (f9c1ccf):** the pending summary is logged before expiry or `prune()` drops an entry; `ext-mbstring`/`ext-sodium` are required in `composer.json`; the invalid-UTF-8 fallback of `EscapeControlCharacters` escapes C1, bidi, isolate, LS/PS and U+FEFF byte-wise (rarer format characters such as U+00AD are not; acceptable). A stale `prune()` racing a just-added client only restarts that client's entry (extra "first request" line). |
| **New 2026-11-14 (point B).** A compromised GitHub Action tag in the release job (`contents: write`) or the CI job tampers with the release ZIP; a church can't check the ZIP it uploads | Release job runs no project code and builds in a read-only job. **Open (MINOR):** pin actions by commit SHA (at least `download-artifact` in the write job), publish the ZIP's SHA-256 (or a build-provenance attestation) in the release notes. **Resolved 2026-11-15 (Task 25, 091c7c6; security review APPROVED with MINORs):** M2: every `uses:` in all four workflows is pinned by a full commit SHA, and each was checked with `git ls-remote` against the official repository (setup-php's annotated tag dereferenced; all are the latest tags). M3: each release workflow is split into `build` (`contents: read`, runs npm/Composer code, computes the `.sha256`), `attest` (`id-token`/`attestations: write`, runs only `download-artifact` + `actions/attest`, SLSA provenance for the ZIP) and `release` (`contents: write`, `sha256sum --check --strict`, then `gh release create --verify-tag`). Top-level `permissions: {}`. `download-artifact` v8 fails on a digest mismatch by default. Residuals (MINOR, new 2026-11-15): the documented `gh attestation verify` doesn't pin `--source-ref`, so a genuine ZIP of another (older) tag passes when it is swapped onto a release page; the release `build` has no `package-manager-cache: false`, so adding a `packageManager` field to `package.json` would silently turn on a restored npm cache in the release build. **Resolved 2026-11-15 (70921be, re-checked in point B round 2):** `setup.md`/`development.md` give `gh attestation verify … --source-ref refs/tags/<tag>`, the release `build` sets `package-manager-cache: false`, `backend.yml` checks out with `persist-credentials: false`, and no workflow interpolates `${{ }}` expressions from untrusted input into `run:` scripts (tag names go through `$GITHUB_REF_NAME`). |
| **New 2026-11-14 (point B).** A credential in git history (root `.env` of 78b4913 with a non-placeholder `VITE_PASSWORD`, on `origin`) | Maintainer informed. Change that password if it was ever real; then add the finding's fingerprint to `.gitleaksignore` so CI's full-history scan doesn't stay red. **Updated 2026-11-15 (Task 25, 091c7c6):** M4: deliberately not allowlisted; `extension/docs/development.md` („Secret scan“) gives the order (rotate first, then fingerprint with a dated reason). The three source-file allowlists are now `condition = "AND"` (exact path AND exact value, checked against gitleaks 8.30.1's evaluation code), so any other secret in those files is reported; only the two PEM key files stay path-only. Still open (maintainer, pre-release): rotation and the first CI run, which is the only real test of the config. Residual (MINOR): the value regexes are unanchored, so a secret that contains the invented value as a substring would also be suppressed (anchor with `^…$`). **Resolved 2026-11-15 (70921be):** all three value regexes are anchored `^…$`. Still open (maintainer, pre-release): rotation of the historic `.env` password and the first CI run. |
| **New 2026-11-15 (Task 25 review).** A malicious or compromised npm/Composer package in the release `build` job changes the ZIP (or the release notes) before the checksum is computed | Not preventable by the job split: the attestation then truthfully says the workflow built it. Mitigated by `npm ci`/`composer install` from lock files, `npm audit`/`composer audit` in CI, and few dependencies. Proposed accepted risk below. |
| **New 2026-11-15 (Task 25 review).** A pull request edits `.gitleaks.toml` or `.gitleaksignore` to hide a secret it adds | The PR's own config is used by its scan. Both files are "reviewed like code" (development.md). Cheap extra (MINOR, optional): a CODEOWNERS entry for both files, or a CI check that the PR doesn't change them without a maintainer label. **Done 2026-11-15 (70921be):** `.github/CODEOWNERS` names the maintainer for `.github/workflows/`, `CODEOWNERS`, `.gitleaks.toml` and `.gitleaksignore`; effective only once branch protection requires code-owner reviews (maintainer, on GitHub). |
| **New 2026-11-15 (Task 25 review).** Unpinned tools in the release build: `ubuntu-latest`, `node-version: '24'`, setup-php's `tools: composer:v2` | Fetched from their vendors over TLS at run time; the actions themselves are SHA-pinned and gitleaks is pinned by sha256. Proposed accepted risk below. |

| **New 2026-11-15 (point B round 2).** An operator sets `LOG_LEVEL` to `notice` (or higher) to cut noise. The `info` lines (who set or deleted whose password, the hourly machine-client usage summaries with addresses) are then gone, and a stolen admin token or a leaked client key goes unnoticed. Only the `notice` lines about changed clients, admin group and address remain | **Open (MINOR, docs):** in `backend/docs/setup.md` („Logs and personal data“ and the `LOG_LEVEL` row), say that `notice` or higher hides set/delete attribution and usage summaries, and recommend `info`. **Resolved 2026-11-15 (ebc3fa1, point B round 3):** both places say so and recommend `info`. |
| **New 2026-11-15 (point B round 2).** `backend.yml` now also runs `npm ci` for `extension/` (sandbox override guard, ef94538). A compromised dev dependency runs in the backend CI job | The job has `contents: read`, `persist-credentials: false`, no secrets, and triggers on `push`/`pull_request` (never `pull_request_target`). Nothing is published from it. No finding; it falls under the dependency risk (#43). |
| **New 2026-11-15 (point B round 2, M8 of round 1).** `npm audit` (dev dependencies only) reports 11 moderate advisories (`glob` 9–14.0.1 GHSA-3g3m-2fjr-6pw4, `minimatch` 7–11.0.0 GHSA-g3hv-75wg-m249, through `@typescript-eslint/*` and `editorconfig`). `npm audit --omit=dev` and `composer audit` are clean (phpseclib 3.0.58 since 1a52b25) | Dev tooling only (lint, build). They act on the developer's or CI's own file patterns, not on attacker input, and are not in the bundle. CI gates on `high`. **Open (MINOR):** run `npm audit fix` (no `--force`) when upstream fixes land, or confirm as an accepted risk (index #48). |
| **New 2026-11-15 (point B round 2, M9 of round 1).** `CtApi.group()` pages through every member of a group to count the active ones, on every display of „Zugriff“ (`ct/api.ts` `activeMembers`) | Admin-only page, with the admin's own ChurchTools session; a big users group costs one paged read per visit (ChurchTools rate limits apply to that admin). Availability only. **Proposed accepted risk (index #47)**, or later: show the count only on request. |

### Accepted risks

- **Proposed 2026-11-15 (point B round 2): the „Zugriff“ page reads every member of the users and admin groups** to
  show their active counts (one paged read per group and visit, admin session). Availability only.
- **Proposed 2026-11-15 (point B round 2): moderate advisories in dev-only npm dependencies** (`glob`, `minimatch`
  through the lint toolchain) are tolerated while CI gates on `high` and the production audit is clean.
- **Proposed 2026-11-14 (point B): category names are trusted.** Both sides find `settings`, `access`, `passwordStore`
  by name, first match; whoever may create or rename categories (ChurchTools admins only) can shadow one.
- **Proposed 2026-11-14 (point B): whoever can upload the extension module (`administer custom modules`) replaces its
  code** and with it every user's session and typed passwords; same trust as ChurchTools system admins.
- **Proposed 2026-11-15 (Task 25): dependencies in the release build are trusted.** npm and Composer packages run in
  the read-only `build` job that produces the ZIP; a compromised one can change it, and the provenance attestation then
  vouches for it. Lock files, audits and few dependencies are the mitigation.
- **Proposed 2026-11-15 (Task 25): runner image, Node 24 and Composer v2 float.** Only actions (by SHA) and gitleaks (by
  sha256) are pinned.

## Hosting, deploy configuration and developer tooling (merged `feature/backend-cleanup`)

> **New 2026-11-15** (security review of the merged result `main..47c296e`). Covers what the per-branch reviews didn't
> see: the optional OPcache `php.ini` template and its denial in `public/`, the web-server rules of the release folder,
> the load-test suite and its HTTPS router, the Claude Code review workflow (`.claude/`), and how they meet the
> admin-group backend and the extension. The tuning file (first section) is **designed, not built**; nothing of it is
> in the code yet.

### Assets

- `config/credentials.php` (service-user token, `JWT_SECRET`, `OAUTH_CLIENT_SECRET`, `CLEANUP_TOKEN`) and the
  ability to rotate them after an incident (the emergency answer of several accepted risks above is "rotate
  `JWT_SECRET`").
- The production ChurchTools instance's persons and `passwordStore` (the load test writes, archives and deletes).
- The developer's real credentials (`backend/config/credentials.php`, `backend/phpunit.xml`, `extension/.env`) and
  the fixtures.
- The review gates themselves (`.claude/agents/*`, `.claude/hooks/*`, `docs/threat-model.md`).

### Attackers

| Attacker | Can do |
| --- | --- |
| Anonymous internet user | Request any path of the deployed folder; read whatever the web server serves as a file |
| Other webspace user on shared hosting | Share the PHP master or OPcache memory on some hosts; read world-readable files and `/tmp` |
| Mistaken developer | Run `vendor/bin/phpunit` with a local `phpunit.xml`, point it at the wrong instance, `git add -A` an untracked log |
| Contributor or tool with write access to the repo | Change `.claude/` agents and hooks, the threat model or the deploy rules in a PR |

### Scenarios and mitigations

| Scenario | Mitigation |
| --- | --- |
| **New 2026-11-15.** `public/php.ini` (OPcache template) is downloaded | `public/.htaccess` denies `^php\.ini$` (NC) before the routing rules (`PhpIniTemplateTest`); the template holds no secret. Hidden files (`.user.ini`, `.htaccess`) are denied only by the **root** `.htaccess`, which doesn't apply when `public/` is the web root as `setup.sh` recommends (MINOR, review 2026-11-15). |
| **New 2026-11-15.** A host that *replaces* its PHP configuration with a folder `php.ini` falls back to PHP's built-in defaults (`display_startup_errors=1`, `expose_php=1`, no `open_basedir` of the host) | `index.php` sets `display_errors=0` first; startup warnings (e.g. "Cannot load Zend OPcache") could still reach the response. Template doesn't set `display_errors`, `display_startup_errors`, `log_errors`, `expose_php` (MINOR, review 2026-11-15). |
| **New 2026-11-15.** The admin follows the template's check step, puts a `phpinfo()` file into `public/` and forgets it | Template says "delete that file again"; nothing checks it (no self-check for OPcache, `check-deploy.php` doesn't allow-list `public/`). Leaks PHP/host configuration and the caller's request headers (MINOR, review 2026-11-15). |
| **New 2026-11-15.** After an incident the operator rotates `JWT_SECRET`/tokens in `credentials.php`, but a host-level OPcache with `validate_timestamps=0` keeps serving the old compiled file | The template sets `validate_timestamps=1`, `revalidate_freq=2` (tested). Control-panel OPcache settings aren't under the backend's control; `setup.md` doesn't say to reset OPcache/restart PHP after a rotation (MINOR, review 2026-11-15). |
| **New 2026-11-15.** Another tenant reads or poisons compiled scripts through a shared OPcache | Only possible where the host shares one PHP master across accounts; `opcache.validate_permission`/`validate_root` aren't set by the template (cheap hardening, MINOR). |
| **New 2026-11-15.** A developer builds a deploy folder with `setup.sh` from a working copy that has extra files in `public/` (a local `php.ini`, a `phpinfo` probe) | `setup.sh` copies `public/` whole; `check-deploy.php` scans for instance URLs and tokens but doesn't allow-list `public/`. CI releases build from a clean checkout (not affected). |
| **New 2026-11-15.** The load suite runs against a production instance (wrong `phpunit.xml`, or plain `vendor/bin/phpunit`, which runs every suite of the local config) | `CT_API_URL` of `phpunit.xml` must equal the one in `credentials.php`; a STDERR reminder; baseline values are checked and teardown verifies them. No hard opt-in and no test-instance marker: on production it would create 20 persons, give up to 500 real persons a secondary password the run knows, and run the cleanup with `apply` (MINOR, review 2026-11-15). **Resolved 2026-11-15 (Task M3, a82881e):** explicit opt-in `CPS_LOAD_TEST=1` (exactly `1`), checked first in `setUpBeforeClass` before the prerequisites, `credentials.php` or any request (`LoadOptIn`; `LoadOptInTest` runs the class in a subprocess without the variable and asserts the skip happens before the prerequisites check); `phpunit.xml.dist` and `phpunit-example.xml` set `defaultTestSuite="Unit,Api"`, so a plain `phpunit -c phpunit.xml` no longer runs `Load` or `Contract`. Residual: an explicit opt-in with a production `phpunit.xml` (covered by accepted risk #50). |
| **New 2026-11-15.** Load-test sandbox or results leak on a shared machine | Sandbox folder `0700`, `credentials.php` `0600`, removed in teardown; results name person IDs only, but go to a predictable `/tmp/ctps-load-results.json` (umask permissions, followed symlink). **Resolved 2026-11-15 (Task M3, 527ad79):** `ResultsFile` creates the file with `fopen(…, 'x')` (`O_EXCL`) under umask `077` (mode `600`), with a random default name; a symlink at the path is refused before the open and the open handle must match the path's inode/device (`lstat`) afterwards; later writes use the handle only; an existing file is never overwritten; the path is printed (`ResultsFileTest`: mode, existing file, live and dangling symlink, umask restored). Residual (negligible): with an attacker-chosen `LOAD_RESULTS_FILE` in a shared folder, a link swapped in between the `is_link` check and the open could make PHP create an empty `600` file at the link target before the inode check refuses the run; nothing is written to it. |
| **New 2026-11-15.** The test server's HTTPS router (`BackendSandboxManager`) is reachable from the network | Binds `localhost`/`127.0.0.1`; test-only, never shipped (`check-deploy.php` forbids `tests/`). Router logic unit-tested since Task M3 (`BackendSandboxRouterTest`, fc2ddf7). |
| **New 2026-11-15.** A probe script with the service user's token stays on the shared web host used for the load-test follow-up | Not in the repository; whether it was removed is unknown to the review. Maintainer to confirm (and rotate the token if it was web-reachable). |
| **New 2026-11-15.** The security-reviewer subagent edits code despite its role | `only-threat-model-writes.sh` blocks `Write`/`Edit` outside `docs/threat-model.md` (realpath, `..`, symlinks). It doesn't cover `Bash` (which the agent has), and fails open when `jq` is missing (exit 127 isn't a blocking exit code). Process guard, not a product control (MINOR). |
| **New 2026-11-15.** A PR weakens the review gates (`.claude/`), the threat model or the deploy rules unnoticed | `CODEOWNERS` covers workflows, `CODEOWNERS`, `.gitleaks.toml`, `.gitleaksignore` only (MINOR: add `.claude/`, `docs/threat-model.md`, `backend/.htaccess`, `backend/public/`, `backend/setup/`, `backend/bin/check-deploy.php`). |
| **New 2026-11-15.** A secret file at the repository root is committed (`.env` from the old layout, an untracked browser log) | Root `.gitignore` ignores neither `.env` nor `*.log`/`*.txt` logs (the sub-folder ignores don't apply at the root); CI's full-history gitleaks scan catches it only after the push; a pre-commit hook is being added (2026-11-15). |

### Accepted risks

- **Proposed 2026-11-15 (merged review): host PHP configuration is outside the backend's control.** Whether a folder
  `php.ini` merges or replaces, and the host's OPcache settings, are the host's; the template and `setup.md` document
  the checks.
- **Proposed 2026-11-15 (merged review): developer tooling trusts the developer's machine.** The load test and the
  contract suites read the real `credentials.php`/`phpunit.xml` and write to the instance they name; the protection
  is the documented "test instance only" rule plus the URL equality check.

## Gone-persons cleanup (deleted and archived persons, `bin/cleanup.php` and `POST /v1/cleanup`)

> **New 2026-11-15** (merged review; the feature was built and reviewed on `feature/backend-cleanup` before the
> admin-group branch, but had no section here). Design: cleanup design (Q16) in `specs/`. Code:
> `Application/Cleanup/CleanupOrphans.php`, `Application/GonePersons.php`, `GuzzleChurchToolsClient::personStatus()`
> and `activePersonIds()`, `KvPasswordRepository::deleteEntriesOf()`, `Http/Controller/CleanupController.php`,
> `bin/cleanup.php`, `Infrastructure/SelfCheck/ServiceUserRightsCheck.php`.

### Assets

- Every person's `passwordStore` entries: a cleanup deletes them for good (no undo; the person must set a new
  secondary password, RADIUS/WiFi stops working for them until then).
- The promise that a deleted or archived person's secondary password stops working within 10 minutes (read check
  with the positive person cache, 600 s) and that their entry is eventually removed (data minimisation).
- `CLEANUP_TOKEN` (in `credentials.php`; opens only `POST /v1/cleanup`).
- The ChurchTools API budget shared with logins and RADIUS reads.
- Person IDs of deleted persons in the logs (personal data, 14 daily files).

### Attackers

| Attacker | Can do |
| --- | --- |
| Anonymous internet user | Call `POST /v1/cleanup` with guessed tokens; the route exists only when `CLEANUP_TOKEN` is set (else `404`) |
| Holder of a stolen `CLEANUP_TOKEN` (web-cron service, its logs, a leaked `credentials.php`) | Start a dry run or `apply=1` run |
| ChurchTools (bug, maintenance, restore) or something between backend and ChurchTools (proxy, WAF, captive page) | Answer a person lookup wrongly |
| Admin who changes the service user's rights | Make persons invisible to the service user |
| Shell user on the host | Run `php bin/cleanup.php --apply` (same trust as the operator; can read `credentials.php` anyway) |
| Concurrent writers | A person (or admin) setting a password while a cleanup runs; a second cleanup |

### Scenarios and mitigations

| Scenario | Mitigation (verified in code 2026-11-15) |
| --- | --- |
| **New 2026-11-15.** ChurchTools (or a proxy/maintenance page) misreports existing persons as gone → bulk deletion | Only the single lookup can make a person gone (`GonePersons`); the batch call can only confirm "active" and fails closed on a wrong `total` or an unrequested ID. A `404` counts as gone only with `application/json` and `message` exactly `Person [<id>] not found.` for this ID; any other `404` is an `InvalidResponseException` (`isPersonNotFound`). A `200` must name the same ID and carry a boolean `isArchived`. Every run first checks that the service user can read **all** persons (`assertReadable`: `view`, `view alldata` for every department, `view archive`, `view hidden persons`) and that `settings` are valid; any lookup failure before the first delete aborts the run. Dry run is the default (CLI without `--apply`, web without `apply=1`). **Residual:** nothing caps how many entries one run deletes; a ChurchTools defect that returns its genuine "not found" for existing persons (or a visibility rule the right check doesn't know) would delete them all in one run. Cooldown (600 s) and the web deadline (20 s, lookups only in the first half) bound the *rate* and ChurchTools load, not this outcome; the CLI has neither. Cheap mitigation (MINOR): refuse `apply` when the gone share exceeds a threshold (e.g. > 20 % of entries or > N persons) unless forced on the CLI, and log the count at `warning`. Proposed accepted risk #51 until then. **Maintainer decision 2026-11-15: no deletion cap** (planned as Task M3, dropped); rationale and residual risk in accepted risk #51 below; optional waiting period in `TODO.md`. |
| **New 2026-11-15.** The `churchdb` deny-list is mistaken for a deletion guard | It isn't one: `ServiceUserRightsCheck` (self-check `/v1/test` only) fails when the service user has write/export/admin rights in `churchdb` or a security level above 1, which keeps a stolen service-user token read-only for persons (least privilege). It doesn't run in the cleanup. |
| **New 2026-11-15.** Stolen or guessed `CLEANUP_TOKEN` | Minimum 43 characters (`BackendConfig::MIN_CLEANUP_TOKEN_LENGTH`), shorter → route not registered; exactly one `Authorization: Bearer` header, compared with `hash_equals`; a `token` query parameter is rejected; rejected tokens count against the address (60 per 60 s, then `429`) and are logged at `warning` with the IP; the token opens nothing else (outside JWT auth). A thief gains: at most one run per 600 s (cooldown taken after authentication, before the lock, also for runs that fail), each web run bounded by the 20 s deadline; the outcome is only what the honest cron would do anyway (delete entries of gone persons). Response holds counts only. Rotation: change `CLEANUP_TOKEN` in `credentials.php` and the cron service. |
| **New 2026-11-15.** Unauthorised CLI or web caller | `bin/cleanup.php` answers `404` outside the CLI SAPI, and `bin/` is denied by the root `.htaccess` and outside `public/`; the web route needs the token. CLI runs ignore the cooldown and the deadline by design (operator trust). |
| **New 2026-11-15.** Two cleanups at once (cron + web, two web calls) | Exclusive non-blocking `flock` (`CleanupLock`, file `600`), released by the OS on crash; the second gets `cleanup-running`. |
| **New 2026-11-15.** Partial run (deadline, timeout, crash) | No delete starts after the deadline; persons not started go to `unchecked` and the next run continues; failed deletes are reported and logged at `warning`; a `404` on delete counts as done (concurrent delete). A crash leaves some persons deleted and others not, which is safe (the next run repeats the check). |
| **New 2026-11-15.** Race with a concurrent write | `deleteEntriesOf` deletes only the value IDs of one listing taken after the lookups; entries written after that listing survive. **Residual (tiny window):** a person restored (un-archived) between their lookup and that listing who sets a new password in the same seconds loses it. GET/PUT refuse gone persons independently (read check), so a gone person can't re-create an entry. |
| **New 2026-11-15.** Logs keep the IDs of deleted persons | Per-entry and per-person `info` lines name person and value IDs only (no names, no ciphertext); daily rotation, 14 files, `600`/folder `700`. Kept for audit ("who was removed when"); a deleted person's ID stays up to 14 days. Proposed accepted risk #52. |

### Accepted risks

- **Proposed 2026-11-15 (merged review): no cap on the number of entries one cleanup deletes.** A ChurchTools defect
  that reports existing persons as not found with its own error shape would remove all their entries in one run;
  recovery is that the persons set new secondary passwords. **Maintainer decision 2026-11-15: no deletion cap.**
  Rationale: ChurchTools is trusted (#3); the cleanup deletes only on ChurchTools' explicit per-person answer ("not
  found" in its exact shape for that ID, or `isArchived: true`), never on an error, a batch answer or a missing
  person; a fixed limit would block legitimate bulk cleanups by the office (e.g. archiving a whole year of leavers).
  Residual risk: a human mistake in ChurchTools (a mass archive by accident) removes the entries of all those persons
  on the next `apply` run; they must set new secondary passwords after being restored. Optional mitigation, not built:
  a waiting period before deleting (`TODO.md`; reads already refuse gone persons, so waiting costs no security).
  Still proposed until the maintainer confirms the list.
- **Proposed 2026-11-15 (merged review): deleted persons' IDs stay in the logs for up to 14 days** as the audit trail
  of the cleanup (data minimisation vs. traceability).

## Proposed accepted risks awaiting the maintainer (index, updated 2026-11-15, after point B round 3 and the merged review)

Every risk marked **Proposed** above, in one place (this is the only index; section lists above are the details).
Only E15 (`backendUrl` trust, „Backend channel“) is confirmed by the maintainer. **The tuning-file risks are not
approved for the built feature:** the tuning design is "designed, not built" and its plan needs revision first
(settings/access cache max 300 s or a separate `access` TTL, see the tuning section); only the draft was discussed.
**Merged review 2026-11-15 (47c296e):** #49–#52 new; no open IMPORTANT or CRITICAL scenario. Status after point B round 3 (ebc3fa1): no open IMPORTANT or CRITICAL scenario; #11 withdrawn; #47 and
#48 new in round 2; nothing new in round 3. **Not recommended for
confirmation:** "the extension and the backend read duplicates differently" (KV section), because of the cross-site
create scenario in the point-B section; it should be replaced by a fail-closed rule. **Done 2026-11-15 (Task 21,
a8b95a3):** #11 is withdrawn.

| # | Section | Risk |
| --- | --- | --- |
| 1 | Whole system / admin group | The 15-minute window after removal from the admin group |
| 2 | Whole system / admin group | Changing the admin group takes up to 20 minutes |
| 3 | Whole system / admin group | ChurchTools system admins and the service user are trusted |
| 4 | Whole system / admin group | A stolen `JWT_SECRET` forges admin tokens |
| 5 | Whole system / admin group | Every role in the admin group counts |
| 6 | Whole system / admin group | An access-only outage blocks logins |
| 7 | Whole system / admin group | Up to 100 sequential group pages per login |
| 8 | KV store | The extension has the user's full ChurchTools session |
| 9 | KV store | Concurrent saves can still overwrite each other (no compare-and-set) |
| 10 | KV store | Settings editors are trusted for content |
| 11 | KV store | ~~Duplicates read differently by extension and backend~~ **Withdrawn 2026-11-15:** replaced by fail closed on both sides (Task 21, a8b95a3); nothing to confirm |
| 12 | Backend channel | Read-parity gap for stored addresses with bidi controls in the host (extension fails closed) |
| 13 | Backend channel | The backend is trusted for content within the contract |
| 14 | Backend channel | Redirects are failures |
| 15 | Login | The backend token isn't revoked on ChurchTools logout |
| 16 | Login | Login data of an abandoned page login stays in `sessionStorage` |
| 17 | Login | A bogus callback during a running page login aborts it |
| 18 | Password policy | No blocklist or strength meter for custom secondary passwords |
| 19 | Password policy | ct-radius character-set contract by convention across repositories |
| 20 | Password policy | A copied generated password stays in the clipboard |
| 21 | Password policy | Switching off `requirePasswordForPasswordChange` allows one-click replacement at an unlocked screen |
| 22 | Password policy | The generated password is shown in clear by default |
| 23 | Password policy | The typed ChurchTools password stays in memory while the form is open |
| 24 | Password policy | A write that lands after leaving the page replaces the password unseen |
| 25 | App state | Frame follows the stored token's `admin` flag without a round-trip |
| 26 | App state | Settings editors get the settings pages in `backend-error` |
| 27 | Passwörter verwalten | The users-group restriction is a UI convenience |
| 28 | Passwörter verwalten | Replace without a question after a concurrent change |
| 29 | Passwörter verwalten | The member list is read once per visit |
| 30 | Passwörter verwalten | The target's person ID ends up in the browser history |
| 31 | Settings pages | Repair is reachable only when `settings` break during a visit |
| 32 | Zugriff | A self-written SHA-256 for display-only key fingerprints |
| 33 | Zugriff | `createdBy` keeps the creator's person ID |
| 34 | Zugriff | The admin group is trusted to manage machine clients (detection: backend `notice` log since Task 22) |
| 35 | Build/dev | Demo state in `localStorage` of the dev origin |
| 36 | Build/dev | Real mode covers the ChurchTools side only |
| 37 | Build/dev | Local processes and users can use the real-mode proxy |
| 38 | Build/dev | A login token is a long-lived credential |
| 39 | Contract harness | The contract run needs the admin fixture's password and a temporary login grant |
| 40 | Contract harness | The admin backend subject uses a token minted with the sandbox secret (narrowed 2026-11-15: one wire check only) |
| 46 | Contract harness (Task 24) | A contract run makes 3 deliberately failed ChurchTools logins for the normal test user (lockout policy unknown) |
| 41 | Point B | Category names are trusted |
| 42 | Point B | Whoever can upload the extension module replaces its code |
| 43 | Release pipeline (Task 25) | Dependencies in the release build are trusted (the attestation vouches for what they build) |
| 44 | Release pipeline (Task 25) | Runner image, Node 24 and Composer v2 float (only actions and gitleaks are pinned) |
| 45 | Point B (Task 21) | A keepable planted duplicate with `revision` = `MAX_REVISION` blocks resolving in the extension; delete it via the ChurchTools REST API (user guide) (availability only) |
| 47 | Point B round 2 (M9) | „Zugriff“ reads every member of the users and admin groups to count them (availability, admin session) |
| 48 | Point B round 2 (M8) | Moderate advisories in dev-only npm dependencies tolerated while CI gates on `high` |
| 49 | Hosting and dev tooling (merged review) | Host PHP configuration (folder `php.ini` merge vs. replace, host OPcache settings) is outside the backend's control |
| 50 | Hosting and dev tooling (merged review) | Developer tooling (load test, contract suites) trusts the developer's machine and writes to the instance its config names |
| 51 | Gone-persons cleanup (merged review) | No cap on how many entries one cleanup run deletes (a ChurchTools defect or a mass archive by accident removes them all); maintainer decision 2026-11-15: no cap (ChurchTools trusted, #3; deletes only on its explicit per-person answer; a cap would block legitimate bulk cleanups); optional waiting period in `TODO.md` |
| 52 | Gone-persons cleanup (merged review) | Deleted persons' IDs stay in the logs for up to 14 days (audit trail of the cleanup) |
