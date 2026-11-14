# CtPassStore Extension – Specification

> **Status: DRAFT, agreed in brainstorming on 2026-11-12.** This document describes the ChurchTools extension
> (`extension/`) after its rework: new backend API, new design, new architecture and a new rights model. It is the
> reference for the implementation plan and the extension's tests.
>
> **Related documents:**
> - [`backend-spec.md`](backend-spec.md): the backend's API. Section 11 of this spec lists the backend changes this
>   rework needs; they're carried into `backend-spec.md` by the implementation plan, not by this document.
> - [`backend-plan.md`](backend-plan.md) item 5.1: the extension's part of the backend plan, including the decisions
>   for the setup, migration, backup and restore wizards.
> - [`versioning.md`](versioning.md): versioning and compatibility of backend and extension.
> - [`reference-infoscreen.md`](reference-infoscreen.md): the reference project for design and structure.
> - [`ct-extension-info.md`](ct-extension-info.md): measured ChurchTools behavior.
>
> **Not in this spec:** the contents of the setup wizard, the migration wizard and backup/restore. They get their own
> spec together with backend item 4.6 (`/v1/setup`). This spec defines only their boundary (section 12).
>
> **Section numbers are stable.** Add new rules at the end of a section; never renumber.

---

## 1. Goals and success criteria

1. **New backend API:** the extension uses `/v1/`, logs users in through ChurchTools OAuth and never sends a
   ChurchTools login token to the backend. It understands every problem type of backend spec 4.9.
2. **Native look and clear guidance:** it looks like part of ChurchTools (host tokens, Lato, dark mode for free), and
   each page says in one or two sentences what it's for. It reuses ideas of churchtools-infoscreen, not its size.
3. **Phones:** every page works at 375 px width without horizontal scrolling, with 44 px touch targets.
4. **Clean architecture:** organized by domain, thin views, logic in pure modules with tests, one API layer per
   system, no Vuetify.
5. **Finer rights:** nobody can see who's an admin unless ChurchTools lets them see the admin group; changing the
   password policy no longer requires the same right as deciding who's an admin.
6. **Languages:** German and English, chosen by the browser.
7. **Tested like the backend:** unit and app tests in CI, contract tests against a real ChurchTools instance and the
   real backend that keep the fakes honest.
8. **Reusable:** the design system (`src/ui/`) can later move to `ct-extension-utils` and serve other extensions
   (first: the ct-radius guest management).

## 2. Decisions

| # | Decision | Why |
| --- | --- | --- |
| E1 | **Own design system instead of Vuetify** (`src/ui/`, a small `theme.css` plus about 12 components, icons from `@mdi/js`). | Native look, no collisions with ChurchTools' Tailwind, small bundle, no third-party churn across several extensions. Restyling Vuetify would mean maintaining overrides against its internals. |
| E2 | **`src/ui/` is a strict boundary** and moves to `ct-extension-utils` once a second extension (ct-radius) uses it. | The library's API is shaped by two real users instead of guesses; no `subtree push` for every change while it's young. |
| E3 | **Frame by role:** normal users get one centered card without navigation; admins get a sidebar (a dropdown on phones). | Most people only ever see their own password. |
| E4 | **Category `access`** holds the role groups (`groups`) and `machineClients`; `settings` keeps only the policy, `backendUrl` and `texts`. | Users must read `settings`, but not who's an admin; changing the policy no longer implies controlling access. |
| E5 | **Admin role from a ChurchTools group** (`groups.admins`), checked by the backend at login; replaces `adminUsers` completely. | Membership is managed in ChurchTools, visible only as ChurchTools allows. Answers backend Q22 (backend decision D9). |
| E6 | **No `setupCompleted` category.** "Set up" means: valid `settings` with `backendUrl`, which the wizard writes last. Admins see the real health from `/v1/test`. | A flag can claim what it doesn't check; one category fewer to grant. |
| E7 | **OAuth callback route** `/ccm/ctpassstore/auth/callback` is the only registered redirect URI; it forwards to the page remembered with `state`. | Login logic and app pages stay apart; one fixed URI instead of one per page. |
| E8 | **Backend token in `sessionStorage`** (15 minutes, gone with the tab). | No redirect on every reload. A script on the ChurchTools page could read it, but it could already act through the ChurchTools session. |
| E9 | **Users can't delete their own password in the UI.** The backend still allows it (spec 4.3 matrix unchanged). | The damage is limited to the user's own entry; not worth a backend change. |
| E10 | **`vue-i18n`, language from the browser** (`navigator.languages`, fallback English). German and English, informal "du". | A standard library that grows with more languages. |
| E11 | **Migration runs inside the extension,** in its own module `src/migration/`, built with the setup wizard. | Updating an extension keeps its data (`ct-extension-info.md` section 2), so data can be migrated in place, with the wizard's own rights code. |
| E12 | **No Pinia.** Local `ref`s and a few composables. | The app is small. |
| E13 | **Versioning:** backend and extension share `MAJOR.MINOR` ([`versioning.md`](versioning.md)). | Compatibility is visible in the version number and checked at release and at runtime. |
| E14 | **Rights model as one table** (section 16): each role maps to a ChurchTools group; the setup creates new groups or uses existing ones; the mapping can be changed later; a check compares the real rights with the table. | Least privilege that's verified, not just described; churches can reuse groups they already have. |
| E15 | **The admin group is trusted with `backendUrl`.** No prompt or display for normal users when it changes. | Whoever can change `backendUrl` can make users' browsers send their ChurchTools password (when `requirePasswordForPasswordChange` is on) and new secondary passwords to another server. The admin group, and everyone who controls its membership, must therefore be as trustworthy as ChurchTools administrators. |

## 3. Roles and app states

### 3.1 Roles

| Role | Determined by | Sees |
| --- | --- | --- |
| **User** | Backend login succeeds (`ctpassstore.view`) | „Mein Passwort“ only |
| **Admin** | Backend login answers `admin: true` (member of the admin group, E5) | Sidebar: „Mein Passwort“, „Passwörter verwalten“, „Einstellungen“, „Über“ |
| **Settings editor** | ChurchTools rights: edit on `settings` and/or `access` | The settings pages they may change; missing rights are named |
| **Setup-capable** | The ChurchTools rights the wizard needs (listed in the wizard spec) | The setup or migration wizard |

Which ChurchTools rights each role's group gets, and why, is section 16.

1. Admin and settings editor usually coincide (the wizard grants the admin group the category rights), but they're
   checked separately: one by the backend, one by ChurchTools.
2. „Einstellungen“ is shown to admins **and** to settings editors, even when the backend login fails. So a broken
   `backendUrl` can always be fixed by someone with the right.
3. „Sicherung“ (backup) and „Einrichtung“ (setup) are shown only to admins who are also setup-capable.

### 3.2 App states

The app computes one state at startup (`src/app/`), in this order. The first match wins.

| # | Condition | State | Shown |
| --- | --- | --- | --- |
| 1 | Still loading | `loading` | Frame with a muted „Lade …“ line |
| 2 | `whoami` is anonymous, or the extension's `view` permission is missing | `no-access` | „Du hast keinen Zugriff auf diese Erweiterung. Wende dich an die Verantwortlichen in deiner Gemeinde.“ |
| 3 | Old data layout (6.3) | `migration-needed` | Setup-capable: the migration wizard. Others: the waiting text (3.3). |
| 4 | Stored data has a newer `schema` than the code | `update-needed` | „Bitte aktualisiere die Erweiterung.“ (admins: with the versions) |
| 5 | `settings` missing, invalid, or without `backendUrl` or `oauthClientId` | `setup-needed` | Setup-capable: the setup wizard. Others: the waiting text. |
| 6 | Backend login fails with `no-service-access` | `no-access` | As in row 2 |
| 7 | Backend unreachable, or login fails otherwise | `backend-error` | Users: „Der Dienst ist gerade nicht erreichbar. Versuch es später noch einmal.“ Settings editors (3.1): the problem text plus a link to „Backend & Status“. |
| 8 | Backend `MAJOR.MINOR` differs from the extension's | `version-mismatch` | As in `versioning.md` section 3 |
| 9 | Login answer `admin: false` | `user` | The password card |
| 10 | Login answer `admin: true` | `admin` | The admin frame |

In row 4 („admins: with the versions“) the versions go to settings editors and setup-capable people: the app doesn't
log in to the backend in that state, so there is no `admin` answer to go by.

### 3.3 Waiting text

Shown to people who aren't setup-capable while setup or migration is needed: „Die Erweiterung wird gerade
eingerichtet. Wende dich bei Fragen an die Verantwortlichen in deiner Gemeinde.“

## 4. Pages, routes and flows

### 4.1 Routes

All routes live under `/ccm/ctpassstore/` (Vite `base` and `createWebHistory(import.meta.env.BASE_URL)`). There are
no route guards; each view checks the app state and the rights it needs. In addition, each route names the role in
the „Who“ column (`meta.requires`: admins, or admins and settings editors), and the app draws the missing-rights banner
instead of the page for anyone else (display only, like everything role-derived).

| Path | Page | Who |
| --- | --- | --- |
| `/` | Mein Passwort | everyone with access |
| `/manage`, `/manage/:personId` | Passwörter verwalten; the person stays selected on reload | admins |
| `/settings` | Settings overview | admins, settings editors |
| `/settings/rules` | Passwortregeln | settings editors |
| `/settings/texts` | Texte | settings editors |
| `/settings/access` | Zugriff | admins, settings editors |
| `/settings/access/clients/new`, `/settings/access/clients/:id` | Add or edit a machine client | settings editors of `access` |
| `/settings/backend` | Backend & Status | admins, settings editors |
| `/settings/backup`, `/settings/setup` | Defined by the wizard spec | admins who are setup-capable |
| `/about` | Über | everyone with access (users reach it through a small link in the card's footer) |
| `/auth/callback` | OAuth callback, no visible page (7.1) | – |
| anything else | „Seite nicht gefunden“ with a link back to `/` | – |

A view opened without the right shows a banner naming what's missing, never an empty page or a raw `403`.

### 4.2 Mein Passwort

The card's header shows the **title** and **explanation** from the settings texts (section 10.3) with a key icon.

**State 1, overview:**
- A pill: „✓ Passwort ist gesetzt“ (`GET /v1/entries/{own}` → `200`) or „Noch kein Passwort“ (`404 entry-not-found`).
  Any other answer is an error (section 8), never "no password".
- If set: „Aus Sicherheitsgründen können wir es dir nicht anzeigen. Wenn du es vergessen hast, setz einfach ein
  neues.“
- Button „Neues Passwort festlegen“ (or „Passwort festlegen“ without an entry).
- If an entry exists, a hint below the button: „Dein bisheriges Passwort funktioniert danach nicht mehr.“ No confirm
  dialog for one's own password.
- No delete button (E9).

**The button's target:**
- `allowCustomPassword` is `false` **and** `requirePasswordForPasswordChange` is `false`: the button sends
  `PUT /v1/entries/{own}` with an empty body right away and goes to **state 3**.
- Otherwise: **state 2**.

**State 2, set a new one:**
- `ChoiceCard`s: „Zufällig erzeugen“ (default, „Empfohlen. Wir zeigen es dir einmal an.“) and „Selbst wählen“. The
  second appears **only** if `allowCustomPassword` is `true`; without it there's no choice, only the generate path.
- „Selbst wählen“ shows a `SecretField` (eye on the right edge) and the rule list below it, ticked off live
  (`aria-live="polite"`). The rules mirror backend spec 5.1:
  1. at least `passwordLength` characters (the list also says: at most 128)
  2. at least one letter
  3. at least one digit
  4. at least one special character of `! @ $ % & * - _ + = ? .` (listed)
  5. no other characters (no umlauts, no spaces)
- If `requirePasswordForPasswordChange` is `true`: a field „Dein ChurchTools-Passwort (zur Bestätigung)“ with an eye.
- Buttons: „Passwort erzeugen“ or „Passwort speichern“, and „Abbrechen“.
- The submit button stays disabled until the input is complete; a hint says why.

**State 3, result:**
- Generated (`200`): pill „✓ Gespeichert“, the password in a monospace `SecretField` with a **copy icon inside the
  field** on the right (after a click: „✓ Kopiert“ for 2 seconds), a warning banner „Du siehst es nur jetzt. Notier es
  dir oder speicher es in deinem Passwort-Manager.“, and „Fertig“, which returns to state 1 and drops the plaintext from
  memory.
- Chosen (`204`): „✓ Gespeichert“ inline (`role="status"`), back to state 1.

**Problems:** specific texts at the field or above the button (section 8). If renewing the session needs a popup and
it's blocked, a banner „Deine Sitzung ist abgelaufen. Sitzung erneuern“ appears; everything typed stays.

### 4.3 Passwörter verwalten (admins)

- Header: „Passwörter verwalten“, „Setz oder lösch das Passwort einer anderen Person, z. B. wenn sie ihres vergessen
  hat.“
- A `PersonPicker` that searches the **members of the users group** (16.1), loaded through the admin's ChurchTools
  session with „view group“ on that group (16.2 A5). Only they can have a password, and admins don't need to see any
  other person. Without the right, a banner names it. A person outside the users group who still has an entry isn't
  found here; the cleanup and the rights check deal with that case.
- The selected person shows avatar, name and status pill (as in 4.2) and the buttons „Neues Passwort“ and „Löschen“.
  The avatar shows initials only, no ChurchTools image, to avoid extra requests.
  Under every name (search list, card, both dialogs) the ChurchTools person ID is shown small, italic and muted
  („ID 123“), so two people with the same name can be told apart. The search also finds a person by ID: each word of
  the query must match: a word matches a name part it starts, and a word of digits also matches the ID exactly or as
  a prefix; so „Anna 12“ finds an Anna whose ID starts with 12.
- „Neues Passwort“ runs the flow of 4.2 (states 2 and 3, or the direct path) for that person, with two differences:
  - A **warning banner** above the flow: „Du legst gerade das Passwort für **{Name}** fest.“
  - A **confirm dialog** before sending, if the person has a password: „Das bisherige Passwort von {Name} funktioniert
    danach nicht mehr. Fortfahren?“
  - The ChurchTools password asked for is the **admin's own** (backend spec 4.6).
- „Löschen“: confirm dialog (danger variant, focus on „Abbrechen“) naming the person, then `DELETE /v1/entries/{id}`
  with the admin's ChurchTools password if required. The password field is part of the dialog in that case. A missing
  or wrong ChurchTools password is shown above the buttons, since the dialog with the field has closed by then.
- An admin selecting themselves gets the normal flow of 4.2.

### 4.4 Settings overview

`LinkCard`s with icon, title, one sentence, status pill and chevron:

| Card | Sentence | Pill |
| --- | --- | --- |
| Passwortregeln | Länge, eigene Passwörter, Bestätigung | – |
| Texte | Titel und Erklärung pro Sprache | – |
| Zugriff | Admin-Gruppe und Maschinen-Clients | number of clients |
| Backend & Status | Adresse und Selbsttest | ✓ or „⚠ n Probleme“ from `GET /v1/test` |
| Sicherung | Daten sichern und wiederherstellen | wizard spec |
| Einrichtung | Rechte und Gruppen prüfen oder reparieren | wizard spec |

Cards the person can't use are shown disabled with the missing right, not hidden, except Sicherung and Einrichtung
(3.1.3). Sub-pages have a „‹ Einstellungen“ back link.

**Saving on every settings page:** Save and Discard are disabled until something changes; success shows as inline
„Gespeichert“ (`role="status"`). A save compares `revision` (6.1) and reports a conflict instead of overwriting:
„{Name} hat die Einstellungen inzwischen geändert. Lade neu, um die Änderungen zu sehen.“ (or without a name if
unknown). Leaving a page with unsaved changes asks first.

**Stored problems:** parts a read dropped (e.g. invalid `texts`, dropped as a whole) are listed before any save, since a
save removes them. `settings` that are invalid at startup are `setup-needed` (3.2) and no settings page shows; the
repair below covers a value that became invalid during a visit. It's explicit, on „Passwortregeln“: valid fields are
kept, broken rules get a safe value (confirmation on, custom passwords off, length 16, or 64 for a stored length above
64), and the save uses the stored `revision`. No repair is offered there if `backendUrl` or `oauthClientId` is invalid
(the rules and texts pages never write these two fields, E15) or if the value has no `schema` 2 with a usable
`revision` (a safe integer from 0 to 2⁵³ − 2; a stored revision outside that range refuses every save).

### 4.5 Passwortregeln

- Toggle „ChurchTools-Passwort zur Bestätigung verlangen“ (`requirePasswordForPasswordChange`).
- Toggle „Eigene Passwörter erlauben“ (`allowCustomPassword`), with the help text that otherwise passwords are only
  generated.
- Number „Passwortlänge“ (`passwordLength`), 12–64, with the help text: generated passwords have exactly this length,
  chosen ones at least this length.

### 4.6 Texte

One block per supported language (`de`, `en`), each with „Titel“ (at most 60 characters) and „Erklärung“ (one or two
sentences, at most 300 characters). An empty field means the default text, shown below the field; a field holding only
spaces and invisible format characters counts as empty. Bidi control characters (U+202A–U+202E, U+2066–U+2069) are
refused at the field and by the store (stored texts with them are dropped on reading like other invalid texts). Defaults:

| | Title | Explanation |
| --- | --- | --- |
| de | Mein Zweitpasswort | Ein eigenes Passwort für angebundene Dienste wie das WLAN. Es ist unabhängig von deinem ChurchTools-Passwort. |
| en | My secondary password | A separate password for connected services such as Wi-Fi. It's independent of your ChurchTools password. |

### 4.7 Zugriff

- A warning banner: „Wer hier etwas ändern kann, hat Zugriff auf alle Passwörter. Halt diesen Kreis sehr klein.“
  The same holds for the admin group: whoever controls its membership is admin (16.1). The status dot of „Admins“
  also shows the findings of rule 6 (16.4).
- **Groups:** for the roles „Nutzer“ (users) and „Admins“, the mapped ChurchTools group with name, member count, a
  status dot from the rights check (16.4), „Mitglieder verwaltest du in ChurchTools“ and a link „In ChurchTools öffnen
  ↗“. „Gruppe ändern“ starts the change flow of 16.5. A missing or deleted group is shown as an error with the fix.
  The service user's group is shown on „Einrichtung“, not here.
- **Machine clients:** every stored entry the backend enables, with name (isolated, `<bdi>`), `id`, permissions
  („darf lesen“), number of keys, a fingerprint per key, `createdAt` (and who created it), and „Bearbeiten“ /
  „Entfernen“. A green „+ Client hinzufügen“ button.
- **Key fingerprint:** the first 16 characters (96 bits) of base64url(SHA-256(the 32 key bytes)), the same whichever encoding was
  pasted. An admin compares it with the service's key, e.g. for a key in base64url:
  `printf %s '<key>' | tr '_-' '/+' | base64 -d | openssl dgst -sha256 -binary | base64 | tr '+/' '-_' | cut -c1-16`
  (add the `=` padding first if `base64 -d` asks for it). Look-alike entries (same name, different key) are told
  apart by it.
- **Falsch konfiguriert:** every stored entry the backend disables (backend spec 3.2: e.g. without `name` or
  `createdAt`, a duplicate `id`, a shared key) is listed with its position, its raw `id` (plain text, isolated, cut
  to 40 characters), its name (isolated, cut to 60), permission, `createdAt` (as is if it is a real date, otherwise
  isolated and cut to 60), `createdBy` and key fingerprints as far as present, and the reasons in words, each with
  „Entfernen“ (danger confirm). Names and ids in the dialog's list of entries a removal turns on are cut to 40.
- **Removing** (any entry): the store removes exactly that entry and changes nothing else in `access` (only
  `machineClients` and `revision`; no schema repair). It compares the read's `revision`, the entry's index, its raw
  `id` and the entry itself, and refuses if any of them no longer matches. Before confirming, the dialog names every
  entry the removal would turn on (removing one of two entries with the same `id`, or one of two clients sharing a
  key, enables the other one: name, `id`, permission and fingerprints) and, for a duplicate `id`, suggests removing all
  entries with it.
- **`access` invalid here** (e.g. `groups.service` broken) while `machineClients` is a list: the backend reads only
  `groups.admins` and `machineClients`, so it may still enable clients. The page lists the active clients (read-only,
  no „Bearbeiten“) and the broken entries, and removing works as above. As on save, a stored `revision` that is no
  integer counts as 0; an integer out of range refuses the removal (nothing can be removed here then). Groups and „+ Client hinzufügen“ need a valid value.
- The page and the client form need `edit custom data` on `access`; without it they name the right and read nothing.
- Until the setup assistant exists (12.6), „Gruppe ändern“ is shown disabled with „Kommt mit dem
  Einrichtungsassistenten.“, and no status dot is shown (the rights check comes with it).
- **Client form** (`/settings/access/clients/new` and `/:id`):
  - Name; ID proposed from the name (`^[a-z0-9-]{3,40}$`, unique, fixed after creation). A new or changed name with
    bidi control characters (U+202A–U+202E, U+2066–U+2069) is refused at the field and by the store on save; a stored
    name with them is still read (parity with the backend) and kept unchanged when other things are saved.
  - Public keys: one or more, each pasted as base64 or base64url and checked on the spot (decodes to 32 bytes; not a
    key another client uses, including stored entries the backend disables; backend spec 3.2).
  - The form opens afresh for each client path, asking first if there are unsaved changes.
  - Permission „Passwörter lesen“ (`entries:read`), off for a new client until turned on.
  - A new client gets `createdAt` as the admin's **local** calendar date (`YYYY-MM-DD`; the backend only checks that
    it is a real date) and `createdBy` = the logged-in ChurchTools person (`whoami`). Both are notes only: the client
    stays valid when that person leaves the church or the admin group. „Zugriff“ says so, and clients nobody needs
    any more are removed there. A creator ChurchTools no longer shows is listed by ID. `createdBy` is personal data
    (a person ID kept as long as the client exists; readable by everyone who can read `access`, 6.1); removing the
    client removes it.
- „Entfernen“: confirm dialog with „Wirkt innerhalb von 5 Minuten.“
- The page validates with the same rules as backend spec 3.2, so the backend never disables a client the extension
  saved.

### 4.8 Backend & Status

- Field „Backend-Adresse“ (`backendUrl`): `https://`, no query, fragment or credentials; a trailing slash is removed.
  Changing it shows a warning that machine clients sign tokens for this address (backend spec 4.4a).
  Whoever can change this address (the admin group and everyone who controls its membership) can make users' browsers
  send their ChurchTools password (when `requirePasswordForPasswordChange` is on) and new secondary passwords to another
  server; the admin group must therefore be as trustworthy as ChurchTools administrators (E15). As soon as the field
  differs from the stored address, the page warns about this, and saving asks in a danger dialog naming the old and the
  new address. The save writes only `backendUrl` into the value as read (revision-guarded). The app keeps using the
  address it started with; the new one takes effect with the next page load (everyone then logs in to the new backend),
  which the page says after saving, with a reload button. The field's rules are the store's (and the backend's
  `parse_url` check): also no empty credentials (`https://:@host`), no missing host, no whitespace, control characters
  or backslashes. A new or changed address must not contain invisible format characters (`\p{Cf}`: zero-width spaces,
  soft hyphens, bidi controls); a stored one is still read and kept, as the backend reads it. A stored trailing slash
  is no change. A new or changed address must also name the host as the browser connects to it: only ASCII, no `%` in
  the host part, and the host as written equals `new URL(…).host` (case aside), so an IDN is entered in its `xn--` form
  and `%2e` or numeric tricks are refused. A stored address whose host the browser rewrites is still read (the backend
  keeps the written host); the page then shows the real host next to it (the tested line and the dialog's „Bisher“).
  Addresses are shown isolated (`<bdi>`). A typed address is never contacted, not even without a token: there is no reachability check before
  saving; the self-test after the reload is that check.
- „Selbsttest“ (admins only, as the backend requires; settings editors who aren't admins see a note): the checks of
  `GET /v1/test` as a list with colored dots and messages (plain text); it runs once when the page opens, and a button
  runs it again. The write test (`?write=1`) is a separate button with a short explanation and never runs on its own.
  Both go to the address the app runs with. A read-only run also updates the overview's pill.
- Shows the backend version.

### 4.9 Über

- What the extension does, in two sentences.
- Extension version and, after login, backend version.
- Link „Anleitung für diese Version“ to the user guide on GitHub at the tag `extension-vX.Y.Z` (development builds:
  `main`).
- Link „Neuigkeiten“ to the release notes of that tag.
- „© 2025 Lukas Block · MIT-Lizenz“, linked to `LICENSE` at that tag; a link to the bundled license file of the
  third-party libraries.

## 5. Architecture

### 5.1 Folders

```
extension/src/
  ui/          design system: theme.css, Icon, PageFrame, PageHeader, Banner, Pill, LinkCard,
               ChoiceCard, Field, Toggle, SecretField, PersonPicker, ConfirmDialog + useConfirm,
               StatusLine
  i18n/        vue-i18n setup, de.ts, en.ts, language detection, custom texts
  ct/          ChurchTools: client.ts, api.ts (one typed function per endpoint), types.ts
  store/       KV: kv.ts (KvBackend), churchtools-kv.ts, memory-kv.ts, repositories
  model/       valibot schemas, layout detection (6.3)
  backend/     auth.ts (OAuth, PKCE, popup, token), api.ts (entries, test), problems.ts
  password/    rules.ts (mirror of backend spec 5.1), flow.ts (states of 4.2)
  admin/       manage, settings pages logic, machine-clients.ts
  app/         app state (3.2), useSession, role, version check
  views/       route pages only
  setup/       wizard (wizard spec); this spec: only the entry point and the state hook
  migration/   migration (wizard spec); this spec: only the entry point and the state hook
  dev/         demo mode: FakeChurchTools and FakeBackend for the dev server
```

1. **Views are thin:** they wire composables and components. Logic lives in `.ts` modules with a `*.test.ts` next to
   each.
2. **`ui/` imports nothing outside `ui/`** (a test checks it, 13.4). It has no texts of its own: labels come in as
   props, so it needs no i18n.
3. **One layer per system:** only `ct/` talks to ChurchTools, only `backend/` to the backend, only `store/` to the KV
   store. Everything else gets them injected, so tests can replace them.
4. **`main.ts`:** configure the ChurchTools client, then `createApp(App).use(i18n).use(router).mount('#app')`. No
   async bootstrap; the app state loads inside the frame.
5. **`App.vue`:** the frame chosen by role plus one global `ConfirmDialog`.
6. **State:** local `ref`s and the composables `useSession` (token, role, versions), `useAppState`, `useConfirm`. No
   Pinia (E12).

### 5.2 What's removed

- Vuetify, `vite-plugin-vuetify`, `@fontsource/roboto`, `@mdi/font`, `angular-route`, `node-forge` (the key pair is
  the wizard's business; it reconsiders the library).
- The subtrees `src/ct-utils/` and `src/ct-extension-utils/` in this repository (ct-radius keeps its copies until it
  moves to the shared `ui/`).
- The generated `src/utils/ct-types.d.ts` (33,000 lines) and `src/ct-utils/types/ct-types.ts`; `ct/types.ts` declares
  only the fields we read.
- `setupCompleted` and the old setup components (`src/setup/*`, `src/components/Setup*`), replaced when the wizard
  spec is built. Until then, `setup-needed` shows the waiting text to everyone, plus a note for setup-capable people
  that the new wizard comes with the next version.
- `VITE_BASE_URL`, `VITE_USERNAME`, `VITE_PASSWORD` (13.6).

## 6. Data model

### 6.1 KV categories (layout version 2)

| Category | Value (one per category, except `passwordStore`) | Read by | Written by |
| --- | --- | --- | --- |
| `settings` | `{ schema, revision, requirePasswordForPasswordChange, allowCustomPassword, passwordLength, backendUrl, oauthClientId, texts }` | users, admin group, service user | settings editors (admin group) |
| `access` | `{ schema, revision, groups, machineClients }` | admin group, service user | admin group |
| `encryptionSettings` | `{ publicKey }` (unchanged) | service user, admin group | setup wizard |
| `passwordStore` | `{ personId, secondaryPwd }` per person (unchanged, so ct-radius isn't affected) | service user | service user |

- `schema`: the layout version, `2`. `revision`: an integer raised on every save (4.4).
- `oauthClientId`: the client ID of the backend's OAuth application, written by the setup wizard. It isn't secret; the
  extension needs it for `/oauth/authorize` (7.1). Without it, the state is `setup-needed`.
- `texts`: `{ "de"?: { "title"?: string, "intro"?: string }, "en"?: {…} }`; title ≤ 60, intro ≤ 300 characters.
- `machineClients`: as backend spec 3.2 (`id`, `name`, `publicKeys`, `permissions`, `createdAt`). The extension also
  writes `createdBy` (the ChurchTools person ID of whoever added the client, 4.7; personal data, kept while the
  client exists); the backend ignores it, and an invalid `createdBy` never disables a client (shared fixture).
- `groups`: `{ "users": {…}, "admins": {…}, "service": {…} }`, each `{ "groupId": <positive integer>,
  "createdBySetup": <boolean> }`. `createdBySetup` decides what may be deleted later (16.5): the extension never
  deletes a group it didn't create.
- None of our fields is named like the KV metadata (`id`, `dataCategoryId`; `ct-extension-info.md` section 5). Inside
  `machineClients` the `id` is nested, so it doesn't clash.

### 6.2 Reading and writing

- **valibot** schemas in `model/`. Reads are tolerant: unknown fields are ignored and kept on the next write. Writes
  are strict: the value is validated and checked against the 10,000-character limit **before** it's written.
- A `schema` greater than 2 → `update-needed` (3.2.4), never a misread.
- Duplicates (several values in a one-value category) are read as the one with the highest value ID and reported to
  admins; a save removes the others.

### 6.3 Detecting the old layout

`isOldLayout()` (a pure function, used by the app state and by `migration/`) is true if any of these holds:
- `settings` has a value without `schema` that contains `adminUsers` or `readAccessUsers`;
- a category `setupCompleted` exists.

## 7. Login and backend communication

### 7.1 OAuth

1. **Startup** (no valid token in `sessionStorage`): generate `state` and a PKCE verifier (S256), store both together
   with the current path in `sessionStorage`, and redirect the page to
   `https://<instance>/oauth/authorize` (`client_id`, `redirect_uri` = `…/ccm/ctpassstore/auth/callback`,
   `response_type=code`, `scope=api`, `state`, `code_challenge`). The client ID is `settings.oauthClientId` (6.1).
2. **`/auth/callback` as a full page:** check `state`, send `POST /v1/auth/token` with code, verifier and redirect URI,
   store the token, remove `state` and verifier, and replace the URL with the remembered path.
3. **`/auth/callback` as a popup** (`window.opener` present): post `code` and `state` to the opener
   (`postMessage`, target origin = own origin) and close. The opener keeps `state` and verifier in memory, checks
   `event.origin` and `state`, and exchanges the code itself (backend plan 5.1).
4. The login answer gives `accessToken`, `expiresIn`, `admin` and `version` (section 11).

### 7.2 Keeping the session alive

- **Before opening a form and right before sending it,** inside the click handler: if fewer than 2 minutes are left,
  renew through the popup.
- **On `401 token-expired`:** renew through the popup and resend the same request once (safe: backend spec 4.1, no side
  effects before authentication).
- **Popup blocked or closed:** banner „Sitzung erneuern“; everything typed stays in memory.
- No hidden iframe.
- `401 invalid-token` or `missing-token`: drop the token and start a full login (state 1 of 7.1) only if no form has
  unsaved input; otherwise the banner.

### 7.3 Calls

- `backend/api.ts` has one function per endpoint: `getEntry`, `putEntry`, `deleteEntry`, `selfTest`, `login`.
- The base URL is `settings.backendUrl` without a trailing slash, plus `/v1`.
- Every non-2xx answer is parsed as Problem Details. A body that isn't `application/problem+json` becomes an
  `UnexpectedResponse` error with the status. A network or CORS failure becomes `BackendUnreachable`.
- Timeouts: 15 s per request (`AbortSignal.timeout`).

## 8. Errors and UX states

### 8.1 Rules

- **Loading:** a muted line („Lade …“) inside a frame that's already drawn. No spinners, no full-page loaders.
- **Empty states:** one muted sentence saying what to do next.
- **Errors:** specific red text with `role="alert"`, at the field it concerns (`aria-describedby`) or above the button.
  Never a blank page, never a raw status code alone.
- **Missing rights:** a warning banner naming them; disabled buttons have a hint why.

### 8.2 Backend problem types

`backend/problems.ts` maps each problem `type` slug (backend spec 4.9) to an error class and an i18n key. The
technical `detail` (English) is never shown to users; admins and settings editors can open it under „Details“.

| Slug(s) | Shown |
| --- | --- |
| `entry-not-found` | Not an error on `GET`: „Noch kein Passwort“ |
| `primary-password-required`, `invalid-primary-password` | At the ChurchTools password field: „Bitte gib dein ChurchTools-Passwort ein.“ / „Das ChurchTools-Passwort stimmt nicht.“ |
| `password-invalid` | The rules in `violations` turn red in the rule list |
| `custom-password-not-allowed` | „Eigene Passwörter sind gerade nicht erlaubt.“ and the settings are reloaded |
| `too-many-attempts`, `upstream-rate-limited` | „Zu viele Versuche. Versuch es in {n} Minuten noch einmal.“ (from `retryAfter`, rounded up, 1 to 60; for 1: „… in einer Minute …“) |
| `token-expired` | Handled by 7.2, not shown |
| `missing-token`, `invalid-token` | Handled by 7.2 |
| `no-service-access` | App state `no-access` |
| `forbidden` | „Dafür hast du keine Berechtigung.“ |
| `person-not-found` | „Diese Person gibt es in ChurchTools nicht mehr.“ (4.3) |
| `oauth-code-invalid` | The login is retried once, then „Die Anmeldung hat nicht geklappt. Lade die Seite neu.“ |
| `upstream-unavailable`, `upstream-invalid` | „ChurchTools antwortet gerade nicht. Versuch es gleich noch einmal.“ |
| `misconfigured`, `not-configured` | Users: „Der Dienst ist noch nicht richtig eingerichtet.“ Admins: plus „Details“ and a link to „Backend & Status“ |
| `internal-error` and any unknown slug | „Etwas ist schiefgelaufen ({status}).“ |
| all others (`invalid-id`, `invalid-body`, `not-found`, …) | Programming errors: „Etwas ist schiefgelaufen ({status}).“ and a console entry |

A test parses `backend/docs/problems.md` and fails if a documented slug has no mapping (13.4).

### 8.3 ChurchTools errors

- `403` or a `status: "fail"` answer: missing rights, named from the permission checks (`ct/`).
- `429`: „ChurchTools bremst gerade. Versuch es in {n} Minuten noch einmal.“ (`retryAfterMs`, at least 60 s; for 1: „… in einer
  Minute …“).
- An anonymous `whoami` (`id` −1 or 0) is `no-access`, not a crash.

## 9. Design system (`src/ui/`)

### 9.1 Styling

- One stylesheet `ui/theme.css`. Everything is scoped under the root class `.cps`. Shared rules use `:where(…)`, so
  their specificity stays at one class and scoped component styles override them. No `@layer`, no `!important`.
- **Tokens** read ChurchTools host variables with the light value as fallback, as in infoscreen
  (`reference-infoscreen.md` section 3): font, text, muted text, surface, panel, divider, accent, danger, create
  (green), warning, radius, base size. Dark mode follows ChurchTools' `.dark` automatically. Re-check infoscreen's
  current `theme.css` for token names before implementing.
- **Spacing** 4/8/12/16/24/32 px; **controls** 40 px high, 44 px on `(pointer: coarse)`.
- **Font:** the host's Lato; weights 400 and 700 only. No bundled UI font.
- **z-index:** menus 1000, dialog 1100 (above ChurchTools' top bar at 1040).
- **Buttons are classes:** `btn` plus `--primary`, `--create`, `--danger`, `--ghost`, `--icon`. Icon buttons have an
  `aria-label`.

### 9.2 Components

| Component | Purpose |
| --- | --- |
| `PageFrame` | The user card or the admin sidebar frame; sidebar becomes a dropdown below 48rem |
| `PageHeader` | Pale icon square, title, one or two sentences, actions on the right |
| `Banner` | `info`, `warning`, `error`: 4 px left border, pale fill |
| `Pill` | Status labels |
| `LinkCard` | Icon, title, sentence, pill, chevron; `disabled` with a reason |
| `ChoiceCard` | Radio cards; the checked one is highlighted via `:has(> input:checked)` |
| `Field`, `Toggle` | Label wrapping the control, help and error text; `Toggle` has `role="switch"` |
| `SecretField` | Eye toggle and/or copy icon inside the field on the right; copy feedback for 2 s |
| `PersonPicker` | Search with debounce, keyboard-accessible listbox; the search function is injected |
| `ConfirmDialog`, `useConfirm` | Promise-based; danger variant focuses „Abbrechen“; optional extra field (4.3) |
| `Icon` | Inline SVG paths from `@mdi/js`, only the ones used |
| `StatusLine` | Loading, empty and error lines |

### 9.3 Phone (below 48rem)

- One column; the password card fills the width; 16 px side gutter.
- The admin navigation is a dropdown at the top.
- Form buttons stretch to full width.
- Inputs use a 16 px font (prevents iOS zoom).
- No horizontal scrolling at 375 px.

### 9.4 Accessibility

- A global `:focus-visible` outline in the accent color.
- The dialog has `role="alertdialog"`, `aria-modal`, a focus trap; Esc cancels; focus returns where it was.
- Errors are tied to their field with `aria-describedby`; the rule list is `aria-live="polite"`.
- `prefers-reduced-motion` turns off transitions.
- Contrast at least WCAG AA, noted in the token comments.

## 10. Languages

### 10.1 Library and detection

- `vue-i18n` in Composition API mode (`legacy: false`). Messages are typed objects in `i18n/de.ts` and `i18n/en.ts`.
- The language is the first entry of `navigator.languages` whose primary subtag is supported (`de-AT` → `de`);
  otherwise `en`. No language switcher.
- Dates and numbers use the same locale (`Intl`).

### 10.2 Wording

- German: informal "du", calm, German quotes „…“. English: just as plain, contractions are fine.
- Each page header has one or two sentences saying what the page is for.
- Texts with parameters use named placeholders (`{name}`, `{n}`).

### 10.3 Custom texts

The title and explanation of „Mein Passwort“ come from `settings.texts[language]`; an empty or missing field falls back
to the default of section 4.6. They're plain text (escaped, never HTML).

## 11. Backend changes this rework needs

To be carried into [`backend-spec.md`](backend-spec.md), the test catalog and the backend code by the implementation
plan. Section numbers refer to `backend-spec.md`.

1. **Section 2, 3.2:** new category `access` with `groups` (6.1; the backend reads only `groups.admins.groupId`) and
   `machineClients` (moved from
   `settings`). `settings` drops `adminUsers` and `machineClients`; it may contain `schema`, `revision`, `oauthClientId`
   and `texts`, which the backend ignores. A missing or invalid `groups.admins.groupId` means no admins (fail closed) and is reported by
   `/v1/test`; it never makes the backend unusable for users.
2. **Section 4.4, 5.5:** at login, with the user's ChurchTools OAuth token, the backend checks whether the person is an
   active member of `groups.admins.groupId`. The answer becomes the token claim `admin` (boolean, required). The login answer
   gains `"admin": true|false` and `"version": "x.y.z"`.
3. **Section 4.3:** the admin role comes from the token claim `admin`, no longer from the settings. Removing someone
   from the group takes effect when their token expires (15 minutes), like revoking `view`.
4. **Section 4.8:** `/v1/test` checks only that the service user can read `access` and that `groups.admins.groupId` is a
   positive integer (check "access"). Whether the group exists is checked by the extension's rights check (16.4, rule 5),
   so the service user gets no group right. The gone-admins checks (`GoneAdmins`, `AdminUsersCheck`, the cleanup
   report's gone admins, CLI exit code 1 for gone admins) are dropped: membership lives in ChurchTools, and a deleted or
   archived person can't log in.
5. **Section 3.3:** the redirect URI is `https://<instance>/ccm/ctpassstore/auth/callback`. The backend's check of
   `redirectUri` (scheme, host, port) is unchanged.
6. **Section 6.5:** versioning by [`versioning.md`](versioning.md); tags `backend-v*.*.*`.
7. **Section 7, 8:** Q22 answered by the new decision D9 (D7 and D8 are taken by the cleanup): admin role from a
   ChurchTools group, checked at login.
8. The machine-client permission matrix and everything else of 4.3 stay as they are (E9).

## 12. Boundary to setup, migration, backup and restore

These get their own spec with backend item 4.6. Decisions already made are collected in `backend-plan.md` item 5.1.
This spec fixes only the interfaces:

1. The app states `setup-needed` and `migration-needed` (3.2) and the waiting text (3.3).
2. `isOldLayout()` (6.3) and the schemas of 6.1 are the shared definitions the wizards use.
3. `src/setup/` and `src/migration/` each have their own entry view and use only `ct/`, `store/`, `model/` and the
   provisioning code; `migration/` doesn't import from `setup/`'s views or flow, only from its provisioning modules.
4. Routes `/settings/backup` and `/settings/setup` are reserved.
5. Who may run them: setup-capable people (3.1), and after setup only admins who are also setup-capable.
6. The setup creates or assigns the role groups and grants their rights **exactly as section 16 says**. The
   provisioning code (grant, revoke, create group) is built with the wizard; the rights check (16.4) and the group
   change (16.5) use the same code and appear on „Zugriff“ and „Einrichtung“.

## 13. Tests and quality

### 13.1 Layers

| Layer | Tool | Tests | Runs |
| --- | --- | --- | --- |
| **Unit** | Vitest, jsdom | Pure modules (`password/rules`, `password/flow`, `model/`, layout detection, `backend/problems`, language detection, machine-client validation) and single `ui/` components (`@vue/test-utils`) | CI, every push |
| **App** | Vitest, jsdom | The whole app mounted against `FakeChurchTools` and `FakeBackend`: every app state of 3.2, user and admin, every flow of section 4 (direct path, confirm dialogs, warning banner, re-login with retry, blocked popup, conflict on save), every problem type of 8.2 | CI, every push |
| **Contract** | Vitest, Node | Only what a fake can't prove: ChurchTools and the real backend behave as the fakes assume (13.2) | By hand, before each release |
| **Browser** | Playwright, Chromium and WebKit, demo mode | A few flows at desktop width and at 375 px: no horizontal scrolling, 44 px touch targets, 16 px inputs, focus and dialog behavior; also produces the user-guide screenshots | By hand |

Neither the unit nor the app layer needs network access.

### 13.2 Keeping the fakes honest

- The contract cases are written **once** and run against the real system (contract layer) and against the fake (unit
  layer), as in backend spec 6.6.
- **ChurchTools cases:** KV categories and values (create, read, update, delete; `400` for a missing module key),
  the shape of `permissions/global`, `whoami` (incl. anonymous), person search, group details and member count, group
  membership read with an OAuth token, and the acceptance of the callback URI (13.7).
- **Backend cases:** `POST /v1/auth/token` (answer shape incl. `admin` and `version`), `GET/PUT/DELETE /v1/entries`
  (`200`, `204`, `404 entry-not-found`, `password-invalid` with `violations`, `primary-password-required`,
  `invalid-primary-password`), `GET /v1/test` (shape), and the Problem Details shape and CORS headers of error answers.
- **The password rules** (`password/rules.ts`) run against a shared list of test passwords that the backend's
  `PasswordPolicy` tests also use (a JSON file in `specs/fixtures/` or similar, decided in the plan), so the mirror
  can't drift.
- Without its configuration (`.env` with instance, test users, backend URL), the contract layer aborts with a message
  naming what's missing; it's never reported as passed. Recorded responses come only from the test instance, are
  stripped of personal data and tokens, and are gitignored; tests that need them are skipped visibly.

### 13.3 Code quality

- TypeScript `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`;
  `vue-tsc` for templates.
- ESLint with `eslint-plugin-vue` and `@vue/eslint-config-typescript`.

### 13.4 Guard tests

1. No hard-coded text in `.vue` templates (`no-bare-text`).
2. `de.ts` and `en.ts` have the same keys.
3. No class name in `ui/` or views matches a Tailwind utility (`collapse`, `hidden`, `flex`, …).
4. `ui/` imports nothing from outside `ui/`.
5. Every slug in `backend/docs/problems.md` has a mapping in `backend/problems.ts`.
6. Every right in the rights table (16.2, as code in `setup/rights.ts`) appears in the user guide's rights table, and
   the other way round (as infoscreen's `rights-doc.test.ts`).

### 13.5 Build check (`scripts/check-dist.js`, after every build)

- exactly one JS bundle and no inline `<script>` (ChurchTools' CSP)
- no instance host (`*.church.tools` except `example.church.tools`), no dev credentials in `dist/`
- no external fonts, no demo code (`dev/`: the marker `__DEMO__` in every module) and no demo data string
- the third-party license file is present

### 13.6 Development setup

- `.env` has `CT_BASE_URL` and `CT_LOGIN_TOKEN`, **without** the `VITE_` prefix, so they never reach the bundle. A Vite
  dev proxy forwards `/api` to the instance and adds `Authorization: Login <token>`.
- **Demo mode is the default** for `npm run dev`: `FakeChurchTools` and `FakeBackend` with invented data, so
  development never writes into a real instance. A switch uses the real instance and a real backend instead.
  - Selected in `main.ts` by the literal `import.meta.env.DEV && import.meta.env.MODE !== 'real'`, so a build drops it.
    A floating switch picks the scenario (user, admin, setup missing, no access, ChurchTools error, version mismatch);
    the demo state lives in `localStorage` (development only; the production app never uses it).
  - `npm run dev -- --mode real` covers the **ChurchTools side only** (KV values, persons, groups, rights) through the
    dev proxy for `/api`. There is no backend login on the dev server: its origin serves no `/oauth/authorize`, and
    proxying `/oauth` with the login token would authorize as the token's user without asking, so it isn't done. The
    app refuses the login there (`LoginUnavailable`: „Die Anmeldung hat nicht geklappt“) instead of leaving for a
    404. Backend flows (login, entries, self-test) are tested in the build hosted on the test instance and in the
    contract and browser checks. The backend client accepts `https://` only, in every mode. `envPrefix` is not
    `VITE_`, so no `.env` value can be inlined into a build; `vite preview` gets no proxy.
- `__APP_VERSION__` from `git describe` (`x.y.z`, `x.y.z+sha`, `x.y.z+sha-dirty`).
- `modulePreload.polyfill: false` (CSP).
- Credential files (`.env`, recorded fixtures) are created with mode `600`; the testing docs say so.

### 13.7 CI and releases

- One GitHub Actions job `extension` on every push and pull request, `permissions: contents: read`: `npm ci` → lint →
  typecheck → unit and app tests → build → build check → `npm audit --audit-level=high`.
- Release on tags `extension-v*.*.*` (`versioning.md`): a release check verifies tag = `package.json` =
  `package-lock.json` = a dated section in `extension/CHANGELOG.md`, and `MAJOR.MINOR` = `backend/VERSION`; it builds
  the ZIP and publishes a GitHub release with the CHANGELOG section as notes.
- CHANGELOG in Keep a Changelog format, written for users, no "Unreleased" section on a release.

## 14. To measure before implementation

On the test instance, recorded in `ct-extension-info.md` and as contract cases:

1. ~~ChurchTools accepts `https://<instance>/ccm/ctpassstore/auth/callback` as an OAuth redirect URI and redirects
   there.~~ **measured 2026-11-13:** yes; contract case AG-11.
2. ChurchTools serves the extension's `index.html` for that deep path (history routing under `/ccm/<key>/`).
3. ~~With a user's OAuth token (`scope=api`), `GET /api/persons/{id}/groups` lists the person's groups including the
   admin group, and shows whether the membership is active.~~ **measured 2026-11-13:** yes, `200`, the same active
   memberships as with a session, `group.domainIdentifier` a string; contract case AG-10.
4. Which endpoint and right the admin's `PersonPicker` needs (`GET /api/search` or `GET /api/persons?query=`), and what
   a person without the right gets.
5. Reading a group's name and member count, and what a person without the right gets.
6. ~~Reading all holders of a right~~ **measured 2026-11-12:** possible and complete through `getMasterData`
   (16.4 rule 4).
7. ~~Both category rights needed?~~ **measured 2026-11-12:** yes, to find a category by name (16.2 U2).
8. ~~Rights for searching persons and reading the admin group~~ **measured 2026-11-12:** „view group“ on the users
   group; the admin group is readable by membership (16.2 A4, A5).

## 15. Reference: infoscreen patterns

**Adopted:** host-token mapping, `:where()` scoping and the Tailwind class test, `PageHeader` with explanatory
sentence, settings as link cards with status pills, calm banners, promise-based confirm dialog, loading/empty/error
rules, `no-bare-text`, the KV backend interface with an in-memory fake, tolerant reads and strict writes, `revision`
conflicts, the dev proxy without `VITE_` credentials, `check-dist`, the release check, contract fixtures handled as in
the backend.

**Not adopted:** its size and large single components (`SetupView.vue`); Pinia; module lookup by listing all modules
(we use `GET /custommodules/{key}`); plan item numbers in code comments; the in-app changelog (we link to GitHub);
hand-written i18n objects without a library (E10).

## 16. Rights model

### 16.1 Roles and groups

Each role is a ChurchTools group, stored in `access.groups` (6.1):

| Role key | Default group name (created by the setup) | Members |
| --- | --- | --- |
| `users` | „CtPassStore Nutzer“ | everyone who may have a secondary password |
| `admins` | „CtPassStore Admins“ | the few people who manage other people's passwords and the settings |
| `service` | „CtPassStore API“ | only the service user (backend plan 5.1) |

1. Rights are granted to **every role of the group** (ChurchTools grants per group role). Membership in any role
   counts.
2. The person running the setup isn't a role. Their rights (setup-capable, 3.1) are listed in the wizard spec and are
   never granted by the extension.
3. Instead of a group, a church might want to grant the user rights by person status (e.g. all members). That's out of
   scope; the user group can contain whoever the church wants.
4. **Controlling the membership of the admin group equals the admin role.** The backend reads the role from the
   membership at login (backend spec 4.4, D9). Anyone who can add themselves or others to that group is admin at the
   next login. Rule 6 of 16.4 checks who can.

### 16.2 The rights table

Module rights refer to the `ctpassstore` module and its categories (`ct-extension-info.md` section 6). Every row says
why it's needed. Nothing else is granted.

| # | Role | Right | On | Why |
| --- | --- | --- | --- | --- |
| U1 | users | `view` (module) | – | The backend lets in only persons with `ctpassstore.view` (backend spec 4.4). |
| U2 | users | `view custom category`, `view custom data` | `settings` | The password page needs the policy, `backendUrl`, `oauthClientId` and the texts. Both are needed: without `view custom category` the category can't be found by name (measured 2026-11-12). |
| U3 | users | „Bei Drittsystem via ChurchTools-Benutzerkonto einloggen“ (churchcore) | the backend's OAuth client | OAuth login (backend spec 3.3). |
| A1 | admins | U1–U3 | | Admins use their own password page too. |
| A2 | admins | `view custom category`, `view custom data` | `settings` (via A1), `access`, `encryptionSettings` | Settings pages; backup. |
| A3 | admins | `create custom data`, `edit custom data`, `delete custom data` | `settings`, `access` | Saving the settings; removing duplicates (6.2). |
| A4 | admins | none: members can read their own group | the admin group | „Zugriff“ page (4.7) shows its name and member count. Measured 2026-11-12. |
| A5 | admins | `churchgroup` „view group“ | the users group | `PersonPicker` on „Passwörter verwalten“ (4.3) and the member count on „Zugriff“. It shows exactly the users group's members, and makes them findable; `view alldata` would show every person's data. Measured 2026-11-12. |
| S1 | service | `view` (module) | – | The module lookup (backend spec 4.10). |
| S2 | service | `view custom category`, `view custom data` | `settings`, `access`, `encryptionSettings`, `passwordStore` | The backend reads policy, groups, machine clients, the public key and the entries. |
| S3 | service | `create custom data`, `edit custom data`, `delete custom data` | `passwordStore` | Only the backend writes entries (backend spec 2). |
| S4 | service | `churchdb` `view`, `view alldata` (every department), `view archive`, `view hidden persons` | – | Existence checks and the cleanup of gone persons (backend spec 4.8, decision D7). |

**Never granted to any role:** `create custom category`, `edit custom category`, `delete custom category`; any write
right on `encryptionSettings` (only the setup writes it, with the setup-capable person's rights); any right on
`passwordStore` for `users` or `admins`; administrative rights (`administer settings`, `administer persons`,
`administer custom modules`) for `service`.

### 16.3 Where the table lives

- In code, once: `src/setup/rights.ts`, as data. The setup, the check and the group change read it.
- In the user guide, as a table generated from or checked against the code (13.4.6).
- The backend's own check of the service user (backend spec 4.8) must agree with rows S1–S4; a contract case runs both
  against the test instance.

### 16.4 Rights check

`checkRights(table, loadedRights)` is a pure function; the loading code lives in `setup/` and `ct/`. It reports
per group and role, with the traffic-light levels ok / warn / fail:

1. **Missing:** a right of the table is missing → **fail**, naming the right and what stops working.
2. **Too many extension rights:** a group has a `ctpassstore` right the table doesn't give its role → **warn** (for
   `service`: **fail**, matching the backend).
3. **Too many other rights:** a group **created by the setup** has rights outside the table → **warn**. Existing groups
   the church assigned keep their other rights; the check ignores them, except for `service`, where administrative
   rights are **fail**.
4. **Others with access:** any group role, group-type role, status or person outside the mapped groups that can write
   `settings`, `access` or `passwordStore`, or read `access` → **warn**, naming them. The list is complete: it comes
   from the rights master data (`getMasterData`, `ct-extension-info.md` section 6), which lists every holder; system
   admins get no module rights implicitly. If the master data can't be loaded, the check says it couldn't verify this
   instead of reporting ok.
5. **Mapping problems:** a mapped group is missing, deleted or inactive → **fail**.
6. **Who controls the admin group's membership:** whoever can change the members of the admin group becomes admin at
   their next login (16.1). The check **warns** about each of these, naming them:
   - (a) a group role of the admin group whose rights let its holders edit memberships of that group (for example a
     leader role with `+edit basic group memberships` or `+remove from group`-style rights);
   - (b) an admin group that is open, has sign-up, accepts requests automatically, or is dynamic or filled
     automatically;
   - (c) persons, statuses and group roles holding a right to edit memberships of that group or of its group type:
     `edit group memberships`, `edit group memberships of group`, `edit group memberships of grouptype`,
     `administer groups`, `administer persons`.

   It reads (a) to (c) from the group data and from `getMasterData`. If any of this can't be determined, the check
   says so instead of reporting ok. Like rule 4, these findings are only reported, never changed automatically.

It runs on „Einrichtung“ (full list) and feeds the status pills of „Zugriff“ and the settings overview. Repairing:
„Fehlende Rechte ergänzen“ grants rule-1 rights. Removing rule-2 or rule-3 rights is offered per right, with a
confirmation; rule-4 findings are only reported, never changed automatically.

### 16.5 Changing a group later

On „Zugriff“ (users, admins) or „Einrichtung“ (service), „Gruppe ändern“ lets the admin pick an **existing group** or
**create a new one**. Before anything is written, a plan shows:

1. the rights the new group gets (16.2);
2. the extension rights and the OAuth login right that are removed from the old group (only those of 16.2; never
   other rights);
3. for an old group with `createdBySetup: true`: whether to delete it (default: keep);
4. warnings:
   - **admins:** if the person making the change isn't a member of the new group: „Du verlierst damit deine
     Admin-Rechte.“ They must confirm by typing the group name.
   - **users:** if the new group has fewer members than the old: the number of people who lose access.
   - **service:** the service user is added to the new group first and removed from the old one last, so the backend
     never loses its rights in between.

Order of writes: grant on the new group → update `access.groups` → revoke on the old group → delete the old group
(if chosen). An interruption leaves too many rights, never too few; the check (16.4) shows what's left and offers the
repair. The setup uses the same plan and order for the first assignment, with "no old group".
