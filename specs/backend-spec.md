# CtPassStore Backend – Specification

> **Status: DRAFT.** This document describes how the PHP backend *should* behave. It is the reference for unit tests,
> end-to-end tests and the cleanup work. It was derived from the current code, [`backend/README.md`](../backend/README.md),
> the existing end-to-end tests, the consumers of the API (the extension and ct-radius) and measurements on a
> ChurchTools test instance.
>
> **This is a breaking redesign.** The API, its error format and its authentication change. The extension and
> ct-radius are adapted to it (see the ct-radius section in [`TODO.md`](../TODO.md)).

**Legend**

| Marker | Meaning |
| --- | --- |
| *(current)* | The code already behaves like this. Keep it. |
| **(change)** | The code behaves differently today. This is the target behavior. |
| **❓ Qn** | Open question, collected in [section 7](#7-open-questions). Each has a proposal. |
| **Dn** | Decision, documented in [section 8](#8-decisions). |

---

## 1. Purpose and scope

The backend is a small REST service that stores **secondary passwords** for ChurchTools users. It:

- encrypts passwords with a public key and stores only the ciphertext in the extension's ChurchTools KV store,
- lets authorized external systems (e.g. a RADIUS server) fetch the **encrypted** passwords,
- never stores, logs or returns plaintext passwords, except a freshly **generated** password in the response to the
  user who requested it.

The backend never holds the private key and can't decrypt anything.

Out of scope: the ChurchTools extension UI, decryption (done by the external systems), and backup/restore of extension
data.

## 2. Actors and components

| Actor | Description |
| --- | --- |
| **User** | Any ChurchTools person with the extension's `view` permission. Manages their own entry. |
| **Admin user** | A person listed in the `adminUsers` setting. May read, set and delete **any** entry. |
| **Read-access user** | A person listed in `readAccessUsers`. May read **any** entry. Typically the account of an external system. |
| **Machine client** | An external system such as ct-radius that reads encrypted passwords without a human user. It authenticates with JWTs it signs itself (D5, 4.3). |
| **Extension** | The ChurchTools extension. Logs the user in via OAuth and calls the backend on their behalf. |
| **Service user** | The ChurchTools account the backend itself uses (`CT_API_TOKEN`). It's the only account allowed to write to `passwordStore`, and it should have no other rights (see 4.8). |
| **ChurchTools** | OAuth authorization server, permission source and storage (KV store). |

Data lives in three KV categories of the `ctpassstore` module:

| Category | Content | Written by |
| --- | --- | --- |
| `passwordStore` | One value per person: `{"personId": <int>, "secondaryPwd": "<base64 ciphertext>"}` | Backend (service user) only |
| `settings` | One value: `requirePasswordForPasswordChange`, `allowCustomPassword`, `passwordLength`, `adminUsers`, `readAccessUsers`, `backendUrl`, **(change)** `machineClients` | Extension admins |
| `encryptionSettings` | One value: `publicKey` (PEM) | Extension setup |

- `backendUrl` in `settings` is read by the extension and currently also by ct-radius. Renaming or removing it is a
  breaking change for both.
- Our own JSON fields must never be named like the KV metadata (`id`, `dataCategoryId`). Helpers that merge the parsed
  value with the metadata would silently drop them.

## 3. Configuration

### 3.1 Local configuration (`config/credentials.php`)

| Key | Required | Meaning |
| --- | --- | --- |
| `CT_API_URL` | yes | ChurchTools API base URL, e.g. `https://example.church.tools/api` |
| `CT_API_TOKEN` | yes | Login token of the service user |
| `CORS` | yes | List of allowed origins. Must include the ChurchTools instance. |
| `OAUTH_CLIENT_ID` | yes | **(change)** Client ID of the backend's OAuth application in ChurchTools (see 3.3) |
| `OAUTH_CLIENT_SECRET` | yes | **(change)** Its client secret |
| `JWT_SECRET` | yes | **(change)** Random secret (at least 32 bytes) for signing the backend's own access tokens (see 4.4) |
| `LOG_LEVEL` | no | **(change)** Minimum log level, default `info` (today it's hard-coded to `debug`). ❓ Q18 |

- **(change)** The file must be readable by PHP but not by other users. The exact mode depends on the hosting:
  - PHP runs as the hosting user (PHP-FPM, suPHP; most shared hosts): `600`.
  - PHP runs as the web server user (e.g. `mod_php`): e.g. `640` with the web server's group.

  Today the `/test` endpoint requires `0600` or stricter, which can never pass on hosts of the second kind.
- **(change)** Missing or invalid keys don't cause a PHP error further down the line. The backend answers every request
  with `500 misconfigured` (see 4.9), naming the missing or invalid key in `detail`, and logs an `error`.

### 3.2 Settings from ChurchTools

- Settings and the public key are read from ChurchTools *(current)*.
- **(change)** They're cached (see [6.1](#61-performance-and-caching)).
- **(change)** Settings are validated when loaded:
  - `passwordLength` is an integer in a sane range. ❓ Q7
  - `adminUsers` and `readAccessUsers` are lists of positive integers.
  - The booleans are booleans.
  - `publicKey` is a loadable RSA public key of at least 4096 bits.
  - `machineClients` is a list of registered machine clients (D5):

    ```json
    [{ "id": "ct-radius", "name": "WiFi RADIUS", "publicKeys": ["<Ed25519 public key, base64>"],
       "permissions": ["entries:read"], "createdAt": "2026-11-01" }]
    ```

    `id` is unique and matches `^[a-z0-9-]{3,40}$`. Every key must be a valid Ed25519 public key. Several keys per
    client allow rotation without downtime. A client with an invalid entry is ignored and reported by `/test`; it
    doesn't break the others.
- **(change)** Invalid or missing settings produce `500 misconfigured` with a `detail` that names the setting, plus an
  `error` log entry. They must never produce a silent fallback that weakens security, such as a password length of `0`.

### 3.3 OAuth setup in ChurchTools

**(change)** Users log in through ChurchTools' OAuth server (D4). Each ChurchTools instance needs:

1. **An OAuth application** for the backend:
   - confidential (with client secret)
   - redirect URI = the extension's page, `https://<instance>/ccm/ctpassstore/`
   - The setup wizard can create it through `POST /api/oauthclients` (needs "administer settings"). ChurchTools
     returns the secret **only once**; the admin copies client ID and secret into `credentials.php`.
2. **The right to use it** for every user of the extension: `churchcore` → "Bei Drittsystem via
   ChurchTools-Benutzerkonto einloggen" (`login to external system`, a per-client data permission). Without it, users
   see "Du bist nicht berechtigt dich bei … einzuloggen". The setup wizard grants it together with the module rights.

## 4. API contract

### 4.1 General rules

- **Transport:** HTTPS only *(current, enforced by `.htaccess`)*.
- **Format:** Requests and responses are JSON (`Content-Type: application/json`), except `204` responses, which have no
  body. Errors use `application/problem+json` (4.9).
- **Authentication:** Every endpoint except `POST /auth/token` and `OPTIONS` requires a bearer token (4.3).
- **Errors** follow RFC 9457 "Problem Details" (D2, see 4.9). This includes `404`, `405` and `500`.
- **Unknown routes** return `404` with type `not-found`. **(change)** Today there's no error middleware, so this
  crashes.
- **Wrong HTTP methods** on known routes return `405` with type `method-not-allowed` and an `Allow` header.
  **(change)**
- **No side effects** on any error response: nothing is written to ChurchTools *(current, asserted by the E2E tests)*.
- **Path parameter `{id}`** must be a positive integer. Anything else returns `400 invalid-id`. **(change)** Today
  `(int) "abc"` becomes `0`, and admins can create an entry for person `0`. ❓ Q10
- **Request bodies** must be empty or a JSON **object**. Invalid JSON or a non-object returns `400 invalid-body`
  *(partly current: invalid JSON is rejected; JSON arrays or scalars aren't)*.
- **Secrets never appear** in problem details, logs or response headers.
- **Security headers** on all responses: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`. **(change)**
- ❓ Q20: whether all paths get a version prefix (`/v1/…`).

### 4.2 CORS

- Only origins listed in `CORS` get `Access-Control-Allow-*` headers *(current)*.
- Preflight (`OPTIONS`) is answered by the CORS middleware without authentication *(current)*.
- **(change)** `Access-Control-Allow-Methods` lists exactly the methods in use: `GET, POST, PUT, DELETE, OPTIONS`.

### 4.3 Authentication and authorization pipeline

**(change)** The backend no longer accepts ChurchTools login tokens from users. Every request (except `OPTIONS` and
`POST /auth/token`) goes through these steps:

1. No `Authorization` header → `401 missing-token`.
2. The header isn't `Bearer <token>`, or the token isn't a JWT → `401 invalid-token`.
3. The token's header decides how it's checked:
   - **No `kid`, `alg` = `HS256`:** a backend access token for a user (4.4). Check signature, `iss`, `aud`, `exp`,
     `nbf`.
   - **`kid` = a registered machine client's `id`, `alg` = `EdDSA`:** a machine client token (4.4a). Check it against
     that client's public keys.
   - Anything else → `401 invalid-token`. An expired user token gives `401 token-expired`, so the extension knows to
     log in again silently.
4. For `/entries/{id}`: the caller isn't allowed to act on `{id}` → `403 forbidden`, according to this matrix:

| Caller | GET own | GET other | PUT/DELETE own | PUT/DELETE other |
| --- | --- | --- | --- | --- |
| User | ✅ | ❌ | ✅ | ❌ |
| Read-access user | ✅ | ✅ | ✅ | ❌ |
| Admin user | ✅ | ✅ | ✅ | ✅ |
| Machine client with `entries:read` | – | ✅ | – | ❌ |

*(current)* The matrix for persons matches today's behavior. ❓ Q23: whether `readAccessUsers` is still needed once
machine clients exist.

- The roles (admin, read access) are taken from the **current settings** (cached, 6.1), not from the token. Changes to
  the admin lists therefore apply within the settings cache TTL.
- **The extension's `view` permission is checked once, at login** (4.4), not on every request. Revoking it takes effect
  when the backend token expires.
- These steps need **no call to ChurchTools**. Today every request costs two (`whoami`, `/permissions/global`).

### 4.4 `POST /auth/token` (login)

**(change, new endpoint)** Exchanges an OAuth authorization code from ChurchTools for a backend access token.

**Flow** (D4):

1. The extension starts the OAuth authorization code flow with PKCE at `https://<instance>/oauth/authorize` with
   `client_id`, `redirect_uri` (the extension page), `response_type=code`, **`scope=api`**, `state` and
   `code_challenge` (S256). It keeps `state` and the code verifier in `sessionStorage`.
2. ChurchTools redirects back to the extension with `code` and `state`. Once a user has given consent, this happens
   without any visible step.
3. The extension checks `state` and sends the code to the backend.

**Request:**

```json
{ "code": "<authorization code>", "codeVerifier": "<PKCE verifier>", "redirectUri": "https://<instance>/ccm/ctpassstore/" }
```

**Processing:**

1. `redirectUri` must start with the ChurchTools instance URL from `CT_API_URL`, otherwise `400 invalid-body`.
   ChurchTools also checks it against the registered URI.
2. The backend exchanges the code at `POST /oauth/access_token` with `grant_type=authorization_code`, its client ID and
   secret, `redirect_uri` and `code_verifier`.
   - Code invalid, expired or already used → `400 oauth-code-invalid`.
   - Client ID or secret rejected → `500 misconfigured`.
3. It checks the returned ChurchTools token:
   - it's an RS256 JWT whose `aud` equals `OAUTH_CLIENT_ID`
   - its `scopes` contain `api`

   Otherwise → `502 upstream-invalid`.
4. With the ChurchTools token as `Authorization: Bearer …` and `X-OnlyAuthenticated: 1`, it calls:
   - `GET /api/whoami`: the person ID must equal the token's `sub`.
   - `GET /api/permissions/global`: `ctpassstore.view` must be `true`, otherwise `403 no-service-access`.
5. **The ChurchTools access and refresh tokens are discarded.** They're never stored or logged.
6. It issues its own access token.

**Response `200`:**

```json
{ "accessToken": "<backend JWT>", "tokenType": "Bearer", "expiresIn": 900 }
```

**The backend access token** (❓ Q21):

- JWT signed with HS256 and `JWT_SECRET`. The algorithm is pinned; `none` and any other algorithm are rejected.
- Claims:
  - `iss`: the backend's own URL
  - `aud`: `ctpassstore-api`
  - `sub`: the person ID (as a string)
  - `iat`, `nbf`, `exp` (15 minutes), `jti`
- Validation allows 30 seconds of clock skew.
- Changing `JWT_SECRET` invalidates all issued tokens immediately (emergency revocation).

**Known limitations:**

- Because of `scope=api`, the ChurchTools consent screen says that the application "can use ChurchTools in your name
  and access all data and functions you're permitted to". Users see this once. Without `api`, the backend couldn't
  verify the token: ChurchTools publishes no public key for its JWTs, and `/oauth/userinfo` doesn't accept the bearer
  token.
- ChurchTools ignores `prompt=login` and `max_age`, so OAuth can't force a fresh login. The primary password check
  (4.6) therefore stays.

### 4.4a Machine client tokens

**(change, D5)** Machine clients don't log in. They sign a short-lived JWT for **every request** with their own private
key and send it as `Authorization: Bearer <jwt>`. The backend only knows the public key.

**Registration:**

1. The machine client generates an **Ed25519** key pair. This is a separate key pair, not the RSA key it uses for
   decrypting passwords. The private key never leaves the client.
2. An extension admin registers the client in `settings.machineClients` (3.2): `id`, `name`, public key, permissions.
   The extension offers a small admin UI for this.

**Token format** (created by the client):

| Part | Value |
| --- | --- |
| Header | `{"alg": "EdDSA", "typ": "JWT", "kid": "<client id>"}` |
| `iss` and `sub` | the client `id` |
| `aud` | the backend URL as stored in `settings.backendUrl` |
| `iat`, `exp` | `exp - iat` at most **300 seconds**; clients should use 60 |
| `jti` | random, unique per request (at least 128 bits) |

**Validation by the backend:**

1. `kid` names a registered client; otherwise `401 invalid-token`.
2. The signature verifies with **one** of the client's public keys (PHP's built-in sodium extension).
3. `iss` = `sub` = `kid`, `aud` matches, `iat` isn't in the future and `exp` isn't in the past (30 seconds clock skew
   each), and the lifetime is at most 300 seconds.
4. **Replay protection:** `jti` hasn't been seen before. Seen `jti`s are kept in the cache until their `exp` has
   passed. A reused token → `401 invalid-token`.
5. The client's `permissions` decide what it may do (4.3 matrix).

**Revocation:** remove the client or one of its keys from the settings. This takes effect within the settings cache
TTL (6.1).

### 4.5 `GET /entries/{id}`

Returns the encrypted secondary password of person `{id}`.

| Case | Response |
| --- | --- |
| Entry exists | `200` `{"secondaryPwd": "<base64 ciphertext>"}` *(current)* |
| No entry | `404` with type `entry-not-found` *(current status; new body)* |
| Several entries for `{id}` (corrupt state) | **(change)** `200` with the entry that has the **highest value ID** (the newest), plus a `warning` log entry. Today it returns `404`. ❓ Q9 |

- Clients must distinguish "no entry" from other `404`s by the problem `type`. A `404` with any other type (for example
  a wrong backend URL) is an error, not "no password".
- No primary password is needed *(current)*.
- The response contains only ciphertext. Nobody can obtain a plaintext password through `GET`.

### 4.6 `PUT /entries/{id}`

Sets or replaces the secondary password of person `{id}`.

**Request body** (all fields optional):

```json
{ "primaryPwd": "<caller's ChurchTools password>", "secondaryPwd": "<custom password>" }
```

**Processing order:**

1. Authorization according to 4.3.
2. If `requirePasswordForPasswordChange` is `true`:
   - `primaryPwd` is missing or empty → `400 primary-password-required` *(current)*.
   - `primaryPwd` is wrong → **(change)** `403 invalid-primary-password`. Today it's `401`, which the extension can't
     tell apart from an invalid token. ❓ Q6
   - The primary password checked is the **caller's** own, also when an admin changes someone else's entry
     *(current)*. ❓ Q4
3. If `secondaryPwd` is present (including an empty string):
   - `allowCustomPassword` is `false` → `400 custom-password-not-allowed` *(current)*.
   - The password fails validation ([5.1](#51-password-policy-passwordvalidator)) → `400 password-invalid`, with the
     violated rules in the extension member `violations` *(current: message only)*.
4. If `secondaryPwd` is absent, a random password is generated ([5.1](#51-password-policy-passwordvalidator))
   *(current)*.
5. The password is encrypted ([5.2](#52-encryption-encryptionservice)) and stored ([5.3](#53-password-store)).

**Responses:**

| Case | Response |
| --- | --- |
| Custom password stored | `204`, empty body *(current)* |
| Generated password stored | `200` `{"secondaryPwd": "<plaintext generated password>"}` *(current)*. This is the only time plaintext leaves the backend, and only to the caller. |

- Afterwards, exactly **one** entry exists for `{id}` (see 5.3).
- Setting the same password again is allowed.

### 4.7 `DELETE /entries/{id}`

Deletes the entry of person `{id}`.

- Authorization as for `PUT` *(current)*.
- If `requirePasswordForPasswordChange` is `true`, `primaryPwd` is required in the body, as for `PUT` *(current)*.
  ❓ Q5
- **All** entries for `{id}` are deleted, including duplicates *(current)*.
- Response `204`, also when no entry existed *(current: idempotent)*.

### 4.8 `GET /test` (self-check)

- Requires authentication like every other endpoint *(current)*. ❓ Q11: who may call it.
- It runs these checks and reports each one as `{name, status: "ok"|"fail", message}` *(current)*:
  - **(change)** `credentials.php` is readable by PHP but not by other users (instead of requiring `0600`), and
    `logs/` is writable
  - all settings can be read *(current)*
  - **(change)** the settings pass validation (3.2)
  - **(change)** `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET` and `JWT_SECRET` are present, and `JWT_SECRET` is long enough
  - **(change)** the public key loads and a test encryption succeeds
  - **(change)** the service user can read `passwordStore`
  - **(change)** the service user has **no more rights than needed**. The check fails if the service user has
    administrative rights such as `administer settings`, `administer persons` or `administer custom modules`, or
    write access to extension categories other than `passwordStore`.
  - **(change)** optionally, the service user can create and delete a test value in `passwordStore`. ❓ Q11
- Response: `200` if all checks pass, otherwise `207` *(current)*. Body: `{"version": "...", "summary": "...", "tests": [...]}`.
- The checks must not reveal secrets, file paths outside the project, or other users' data.

### 4.9 Error format (RFC 9457)

**(change, D2)** Every error response has `Content-Type: application/problem+json` and this shape:

```json
{
  "type": "https://github.com/lub90/ct-pass-store/blob/main/backend/docs/problems.md#entry-not-found",
  "title": "No password entry",
  "status": 404,
  "detail": "Person 123 has no secondary password."
}
```

| Member | Meaning |
| --- | --- |
| `type` | Stable URI per kind of problem. **Clients decide based on this member.** The fragment is the slug from the table below; the page `backend/docs/problems.md` explains each type with cause and fix. |
| `title` | Short, fixed summary of the type |
| `status` | The HTTP status, repeated |
| `detail` | Explanation of this specific occurrence. For configuration problems it names exactly what's wrong and how to fix it. |
| Extension members | Only where useful, e.g. `violations` for `password-invalid`, `retryAfter` for `upstream-rate-limited` |

**Problem types:**

| Status | Type slug | When |
| --- | --- | --- |
| 400 | `invalid-id` | `{id}` isn't a positive integer |
| 400 | `invalid-body` | Body isn't empty and isn't a JSON object, or fields are invalid |
| 400 | `oauth-code-invalid` | Authorization code invalid, expired or already used |
| 400 | `primary-password-required` | Primary password required but missing |
| 400 | `custom-password-not-allowed` | Custom password sent while disabled |
| 400 | `password-invalid` | Custom password fails the policy (`violations` lists the rules) |
| 401 | `missing-token` | No `Authorization` header |
| 401 | `invalid-token` | Wrong scheme, bad signature or claims |
| 401 | `token-expired` | Backend access token expired; log in again |
| 403 | `no-service-access` | No extension `view` permission (at login) |
| 403 | `forbidden` | Not allowed to act on this entry |
| 403 | `invalid-primary-password` | Wrong primary password (❓ Q6) |
| 404 | `not-found` | Unknown route |
| 404 | `entry-not-found` | No entry for this person (`GET` only) |
| 405 | `method-not-allowed` | Known route, wrong method |
| 429 | `too-many-attempts` | Too many primary-password attempts (see 6.3) |
| 500 | `misconfigured` | Configuration, settings, OAuth setup or service-user rights are missing or wrong. `detail` says exactly what. |
| 500 | `internal-error` | Anything unexpected. Generic `detail`; details only go to the log. |
| 502 | `upstream-unavailable` | ChurchTools unreachable, timed out or answered `5xx` |
| 502 | `upstream-invalid` | ChurchTools answered something the backend can't use (e.g. a token without the `api` scope) |
| 503 | `upstream-rate-limited` | ChurchTools answered `429`; with a `Retry-After` header |

**`misconfigured` versus `internal-error`:** anything an admin can fix (credentials, settings, public key, OAuth
application, service-user permissions) is `misconfigured` with a precise `detail`. For example, a `403` from
ChurchTools on a service-user call means missing permissions, which is `misconfigured`, not an upstream failure. Only
real bugs are `internal-error`.

## 5. Units

These sections describe behavior per unit. Each numbered rule should map to at least one unit test.

### 5.1 Password policy (`PasswordValidator`)

**Validation** *(current, unless marked)*:

1. The allowed characters are `a–z`, `A–Z`, `0–9` and the symbols `! @ $ % & * - _ + = ? .`. Any other character (for
   example a space, `#`, umlauts or emoji) is invalid. **This set is a contract with ct-radius**, which rejects any
   other character; changing it requires changing both. ❓ Q8
2. The password contains at least one letter, one digit and one symbol.
3. Its length is at least `passwordLength`.
4. **(change)** Its length is at most **128** characters. RSA-4096 with OAEP/SHA-256 can encrypt at most 446 bytes, and
   today a longer custom password crashes the encryption with a `500`. ❓ Q8
5. Validation works on bytes, and the allowed set is ASCII-only, so byte length equals character length.
6. **(change)** Each violated rule is reported (`too-short`, `too-long`, `missing-letter`, `missing-digit`,
   `missing-symbol`, `invalid-character`) for the `violations` member.

**Generation:**

1. It produces exactly `passwordLength` characters.
2. The result always passes validation (rules 1–4).
3. Every character comes from a cryptographically secure random source *(current, `random_int`)*.
   **(change)** The final shuffle uses a secure shuffle too, instead of `str_shuffle` (which uses a non-cryptographic
   generator).
4. `passwordLength` below the minimum from ❓ Q7 is a configuration error (`misconfigured`), not an exception deep
   inside the generator.

### 5.2 Encryption (`EncryptionService`)

1. The algorithm is RSA with OAEP padding, SHA-256 as hash and SHA-256 for MGF1 *(current)*. ct-radius decrypts with
   exactly these parameters.
2. The output is the base64-encoded ciphertext *(current)*.
3. The same plaintext encrypted twice gives different ciphertexts (OAEP is randomized). Tests must not compare
   ciphertexts, only decrypt them with the test key.
4. **(change)** An invalid or too-small public key (under 4096 bits) is reported as `misconfigured`, not as a generic
   encryption failure.
5. The plaintext never appears in exceptions or logs.

### 5.3 Password store

This covers the lookup and write logic in `ChurchToolsStore`.

1. Entries are matched by `personId` using **one consistent comparison**: both sides are normalized to `int`.
   **(change)** Today `getPwd` uses `==` while `putPwd`/`deletePwd` use `===`.
2. New entries store `personId` as an integer *(current)*.
3. **Read:** returns the ciphertext for `personId`, or "none". With duplicates it returns the entry with the highest
   value ID (see 4.5). **(change)**
4. **Write:** if no entry exists, one is created. If one exists, it's updated. **(change)** If several exist, the entry
   with the highest value ID is updated and all others are deleted, so the state heals itself. Today the write throws
   on every attempt.
5. **Delete:** removes all entries for `personId`. Doing nothing is fine if none exist *(current)*.
6. The KV store has no transactions and no conflict detection. Two concurrent writes for the same person can still
   create a duplicate, but rules 3–5 guarantee it never blocks anyone and disappears on the next write.
7. Values that aren't valid JSON, or that lack `personId`/`secondaryPwd`, are skipped with a `warning` log entry.
   They must not crash reading or writing for other people. **(change)**
8. A value must stay under the KV store limit of 10,000 characters. A 4096-bit ciphertext in base64 is 684 characters,
   so this is only a sanity check.
9. **(change) Completeness check:** the KV endpoint returns all values with `meta.count` and doesn't paginate (measured:
   no `meta.pagination`, and `page`/`limit` are ignored). Every read checks that the number of returned values equals
   `meta.count`. If not, it fails with `502 upstream-invalid` instead of answering "no entry" or creating a duplicate.

### 5.4 Settings (`ServiceSettings`)

1. Settings and the public key are loaded lazily and at most once per request *(current)*.
2. **(change)** They're cached across requests (6.1).
3. **(change)** They're validated according to 3.2.
4. Missing optional lists (`adminUsers`, `readAccessUsers`) mean "empty" *(current)*.

### 5.5 Authentication (`TokenService`, `PrimaryPasswordVerifier`)

1. **(change) Token exchange:** implements 4.4. It's the only place where a user's ChurchTools token exists, and only
   for the duration of the request.
2. **(change) Issuing and validating backend tokens:** implements the token format of 4.4 with a small, well-known JWT
   library. Validation pins the algorithm and checks `iss`, `aud`, `exp` and `nbf`.
3. **Primary password check:** `POST /api/login` with the caller's username (`cmsUserId`) and password. `200` means
   valid *(current)*. The username comes from the `whoami` result at login.
   - **(change)** Network errors and unexpected status codes count as `upstream-unavailable`, not as a wrong password.
   - **(change)** Rate-limited (6.3).
   - The response creates a ChurchTools session; its cookie is discarded. No CSRF token is sent with `/login`.
   - ❓ Q13: behavior for users with two-factor authentication.

### 5.6 ChurchTools client (`ChurchToolsClient`)

**(change)** A small client of our own, built on Guzzle. It replaces the `churchtools/php-client` library (D1). All
ChurchTools communication goes through it.

1. **Interface:** one PHP interface covering exactly the calls the backend needs:
   - `exchangeAuthorizationCode(code, redirectUri, codeVerifier)` and the two user calls `whoami(bearerToken)`,
     `globalPermissions(bearerToken)` (4.4)
   - `verifyLogin(username, password)` (5.5)
   - `getModuleByKey(key)`, `getCategories(moduleId)`, `getValues(moduleId, categoryId)`, `createValue(…)`,
     `updateValue(…)`, `deleteValue(…)` (service user)
   - for the self-check: the service user's own `globalPermissions`

   Services depend on the interface only, so unit tests can use a fake implementation.
2. **Authentication:** user calls send the user's OAuth token as `Bearer`. KV calls send the service user's token as
   `Login`. All authenticated calls send `X-OnlyAuthenticated: 1`, so ChurchTools answers `401` instead of serving
   anonymous data. The client never logs tokens or passwords.
3. **Stateless:** no cookie jar and no sessions are kept between calls.
4. **URLs:** the base URL is normalized to end with `/`, and relative paths never start with `/`. This prevents the
   usual URL-joining mistake where `/api` gets dropped.
5. **Timeouts:** one central connect/request timeout for all calls (default 5 s).
6. **Error mapping:**

   | ChurchTools response | Result |
   | --- | --- |
   | `401` / `403` on a user call | not authenticated / not permitted |
   | `401` / `403` on a service-user call | configuration problem (`misconfigured`) |
   | `404` | not found |
   | `429` | rate-limited, including `Retry-After` |
   | Network error, timeout, `5xx` | upstream unavailable |
   | A body that isn't the expected JSON | upstream invalid |

   Each case is its own exception type, so the error middleware can turn it into the problem types of 4.9.
7. **No retries** inside a request (see 6.2).
8. **Responses:** JSON is decoded into plain arrays and unwrapped from ChurchTools' `data` envelope. Only the fields
   the backend uses are read.
9. **CSRF:** REST write requests with a login token currently work without a CSRF token. The client is built so that
   fetching one from `GET /api/csrftoken` can be added in one place if ChurchTools starts requiring it.

### 5.7 Middleware

1. **Order:** CORS → error handling → authentication → routing. **(change)** There's no error middleware today.
2. **Error middleware:** turns every exception into a problem details response (4.9). It logs internal errors with a
   stack trace and returns only a generic `detail` for `internal-error`.
3. **Auth middleware:** implements 4.3 and attaches the authenticated principal (person ID or machine client) to the
   request.

## 6. Non-functional requirements

### 6.1 Performance and caching

- **Goal:** a typical request makes as few ChurchTools calls as possible. Today it makes about 5–7; with backend
  tokens (4.3) authentication costs none.
- **Cached, with TTLs:**

  | Data | Proposed TTL | Effect |
  | --- | --- | --- |
  | Module ID, category IDs | 1 hour | These only change on reinstall |
  | Settings, public key | 60 s | Admin changes take up to 1 minute to apply |

- `passwordStore` values are **never** cached. Reads must always see the latest write.
- **Cache backend:** a file cache outside the web root. No APCu, to keep the backend lean (Q3).
- Cache files contain no secrets.
- Consumers matter too: ct-radius starts a new process per RADIUS request and has no cache of its own, so every login
  reaches the backend.

### 6.2 ChurchTools rate limit and availability

- ChurchTools allows about 600 requests per minute **per IP**, and all backend traffic shares one IP.
- **(change)** When ChurchTools answers `429`, the backend doesn't retry within the request. It answers
  `503 upstream-rate-limited` with `Retry-After: 60` (or ChurchTools' value, if larger). ❓ Q14
- **(change)** Timeouts or connection errors → `502 upstream-unavailable`.

### 6.3 Security

- **(change)** Primary-password attempts are limited per person: after 5 failures within 15 minutes →
  `429 too-many-attempts` for 15 minutes. This protects accounts, and it prevents the backend's IP from being locked out
  by ChurchTools. The numbers are a proposal.
- Nothing outside `public/` is reachable over HTTP. Directory listings are off *(current, `.htaccess`)*.
- Logs never contain passwords (primary, secondary or generated), tokens, codes or ciphertexts.
- **(change)** The backend never receives a user's permanent ChurchTools login token any more (4.3, 4.4).
- **Long-lived secrets and how to rotate them:**

  | Secret | Where | Rotation |
  | --- | --- | --- |
  | Service user's login token | `credentials.php` | Change the service user's password in ChurchTools (invalidates the token), create a new token, update `credentials.php` |
  | OAuth client secret | `credentials.php` | ChurchTools can't rotate it: delete and recreate the OAuth application, update `credentials.php` and the users' login right |
  | `JWT_SECRET` | `credentials.php` | Replace it; all backend tokens become invalid and users log in again silently |
  | Machine client private key | Only on the machine client | Register a second public key, switch the client to the new key, remove the old one |

### 6.4 Logging

- PSR-3 logger (Monolog) writing to `logs/app.log` *(current)*.
- **(change)** Configurable level (default `info`) and log rotation (e.g. Monolog's `RotatingFileHandler`, keeping 14
  days).
- **What gets logged:**

  | Level | Events |
  | --- | --- |
  | `warning` | Denied access, with person ID and IP address |
  | `info` | Logins, password changes and deletions, with person IDs |
  | `error` | Upstream errors, configuration problems |

- IP addresses and person IDs are personal data. They're logged only to detect abuse, and deleted with the rotated log
  files after 14 days. Document this for admins.

### 6.5 Platform and deployment

- **PHP:** `^8.3`; tested with 8.3, 8.4 and 8.5 (D3).
- Runs on ordinary shared hosting with Apache and `.htaccess`. No daemon, no database, no shell access needed at
  runtime.
- The `setup/setup.sh` script produces an upload-ready folder *(current)*. **(change)** It sets sensible permissions
  there, and the setup docs list the target permissions for both hosting cases (3.1), because uploads don't keep them.
- **(change)** The backend reports its version in the `/test` response and in the logs at startup: `x.y.z` for a tagged
  release, `x.y.z+<sha>` for other commits, `x.y.z+<sha>-dirty` for uncommitted changes.

### 6.6 Quality gates

- PHPStan at an agreed level. Start with a baseline, then raise the level step by step.
- A code-style check.
- **Three test layers**, each its own PHPUnit suite and folder:

  | Layer | Suite / folder | What it tests | Runs |
  | --- | --- | --- | --- |
  | Unit | `Unit` / `tests/Unit` | Single classes in isolation (validator, encryption, store logic, token checks, error mapping) | CI, every push |
  | API | `Api` / `tests/Api` | The complete Slim app in-process: real HTTP requests and responses, ChurchTools replaced by a fake implementation of the client interface (5.6). The whole authorization matrix, every status code and every problem type are covered here. | CI, every push |
  | Contract | `Contract` / `tests/Contract` (today `tests/EndToEnd`) | Only what a fake can't prove: that ChurchTools really behaves as assumed (KV read/write and `meta.count`, service-user permissions, primary password check, OAuth code exchange errors), plus a few smoke tests against the running backend. Needs a test instance. | By hand, before each release |

  Neither the unit nor the API layer needs network access. The API layer must exist at the latest in phase 2 of the
  plan.
- A GitHub Actions workflow runs on every push and pull request, for PHP 8.3, 8.4 and 8.5:
  - `composer validate`
  - `composer audit`
  - code style
  - PHPStan
  - unit tests
- **A post-build check of the deploy folder:** no real `credentials.php`, no instance URL or token, no dev files
  (tests, `phpunit.xml`, fixtures), and the expected layout.
- **A release workflow on tags `vX.Y.Z`:** a release check verifies that the tag, the version and a dated CHANGELOG
  section agree; the CHANGELOG section becomes the release notes.
- The contract suite isn't part of the default test run or the CI. Run without its configuration (`phpunit.xml`,
  fixtures), it aborts with a clear message naming what's missing. It's never reported as passed.

## 7. Open questions

| # | Question | Proposal |
| --- | --- | --- |
| Q4 | When an admin changes someone else's password, whose primary password is checked? | The admin's own (as today) |
| Q5 | Should `DELETE` require the primary password? | Yes (as today). Deleting breaks the user's access just like a change does. |
| Q6 | Status code for a wrong primary password? | `403 invalid-primary-password` instead of `401` |
| Q7 | Minimum (and maximum) for the `passwordLength` setting? | 12 to 64 |
| Q8 | Keep the restricted character set? Maximum length? | Keep the set (shared contract with ct-radius); maximum 128 |
| Q9 | Duplicate entries on read: return the newest, or treat as an error? | Return the newest (highest value ID), log a warning, and heal on the next write |
| Q10 | Invalid `{id}`: `400` or `404`? | `400 invalid-id` |
| Q11 | Who may call `/test`, and should it write test data? | Admin users only; the write test only with `?write=1` |
| Q13 | Primary password check with two-factor authentication enabled? | Investigate, then document. Until then, document it as unsupported. |
| Q14 | On a ChurchTools `429`: retry inside the request, or return `503` right away? | Return `503` right away |
| Q16 | Cleanup job for entries of deleted persons: how is it triggered? | A CLI script for cron, plus an admin-only endpoint for hosts without cron |
| Q17 | Should the backend also enforce HTTPS itself (not only via `.htaccess`)? | Yes: reject plain HTTP with `400` when it's detectable |
| Q18 | Make the log level configurable? | Yes, `LOG_LEVEL` in `credentials.php` |
| Q20 | Version prefix for all paths (`/v1/…`)? | Yes. The API breaks anyway, and a prefix makes the next break easier. |
| Q21 | Lifetime and signing of the backend access token? | 15 minutes, HS256 with `JWT_SECRET`. Shorter means more silent re-logins; longer means revoked rights stay valid longer. |
| Q22 | Should admin and read access be granted via ChurchTools groups instead of person-ID lists in the settings? | Later. The consent includes group memberships, and the `api` scope can read them, so it's possible. |
| Q23 | Is `readAccessUsers` still needed once machine clients exist? | Probably not: it existed for the accounts of external systems. Remove it, unless there's a human use case. |

**Answered:** Q1 (authentication; users via OAuth, D4), Q3 (cache; file cache only), Q2 (PHP version, D3), Q12 (error format, D2), Q15 (token
cache; replaced by Q21), Q19 (machine clients; signed JWTs, D5), Q24 (person and group lookups for ct-radius;
deferred to a possible second step, see section 9).

## 8. Decisions

### D1. Own ChurchTools client instead of `churchtools/php-client`

**Decided 2026-09-30.** The backend drops the `churchtools/php-client` library (currently taken from the fork
`lub90/ct-php-client`, branch `dev-version/3.126.2`). It uses its own thin client instead, as described in
[5.6](#56-churchtools-client-churchtoolsclient).

**Why:**

- **We use very little of it:**
  - `SimpleClient`, a 72-line wrapper around Guzzle
  - `GeneralApi::getWhoami()`
  - `Configuration`, `ApiException` and one response model
- **Deployment size:** the library is 59 MB and about 3,800 PHP files, out of 67 MB of dependencies. That makes
  uploads to shared hosting slow, and some hosts limit the number of files.
- **The fork dependency goes away.** No more depending on a branch of a fork.
- **Control:** the error handling this spec requires (`429`, outages vs. invalid tokens, central timeouts) is simpler
  in our own code than on top of generated classes.
- **Testability:** a small interface is easy to fake in unit tests.

**Not a reason: runtime speed.** Measured locally with PHP 8.3, the library costs about 2 ms per request with OPcache
and about 10 ms without. That's negligible next to 5–7 ChurchTools round trips per request. Speed improvements come
from caching (6.1) and from backend tokens (4.3).

**Cost:** about 150–200 lines plus unit tests. We give up generated, typed response models.

**Order:** implement this before the unit tests for authentication and the store, so those tests target the new
interface right away.

### D2. Errors as RFC 9457 Problem Details

**Decided 2026-11-01.** All error responses use `application/problem+json` (4.9).

**Why:** it's a standard that clients, libraries and logging tools understand, so we don't invent and document our own
format. The `type` URI distinguishes problems that share a status code; most importantly, "no entry" from "wrong URL"
(both `404`), which ct-radius currently can't tell apart. `detail` lets configuration errors (`500 misconfigured`)
explain exactly what to fix.

**Consequence:** a breaking change for all clients. They switch on `type`, not on free-text messages.

### D3. PHP `^8.3`

**Decided 2026-11-01.** The backend requires PHP 8.3 or newer and is tested with 8.3, 8.4 and 8.5.

**Why:** it must run on ordinary PHP web hosting and on a reasonably long-supported version. PHP has no LTS; each
version gets security fixes for four years. 8.2's end in December 2026 is too close, 8.3's is December 2027, and 8.3 is
widely available on shared hosting. The minimum is raised when 8.3 reaches its end of life.

### D4. User login via ChurchTools OAuth, then backend-issued tokens

**Decided 2026-11-01.** Users no longer send their permanent ChurchTools login token to the backend. The extension
logs them in through ChurchTools' OAuth server (authorization code with PKCE, confidential client, `scope=api`), the
backend exchanges the code, checks identity and the `view` permission once, discards the ChurchTools tokens and issues
its own short-lived JWT (4.4).

**Measured on a ChurchTools test instance (2026-11-01):**

- OAuth applications can be created through `POST /api/oauthclients`. Users need the per-client right "Bei Drittsystem
  via ChurchTools-Benutzerkonto einloggen".
- Only the scopes `api` and `DEFAULT` exist. `openid`, `profile`, `email` and others are rejected; there's no OpenID
  Connect discovery.
- The access token is an RS256 JWT (`sub` = person ID, `aud` = client ID, `iss` = the application's name, `scopes`),
  valid for 1 hour. Refresh tokens work.
- The REST API accepts the token as `Bearer` only with the `api` scope. `/oauth/userinfo` rejects it. No public key is
  published for verifying the JWT locally.
- `prompt=login` and `max_age` are ignored. After the first consent, ChurchTools redirects without any visible step.

**Why:** the backend never sees permanent credentials of users. Authorization needs no ChurchTools call per request.
Tokens expire on their own.

**Accepted downsides:**

- The consent text for `scope=api` is broad.
- Each instance needs an OAuth application and a per-user right; the setup wizard provisions both.
- Revoked rights take effect only when the backend token expires (Q21).
- The primary password check remains, because OAuth can't force a fresh login.

### D5. Machine clients authenticate with JWTs they sign themselves

**Decided 2026-11-01.** Machine clients such as ct-radius sign a JWT per request with their own Ed25519 private key;
the backend verifies it with the registered public key (4.4a).

**Alternatives considered:**

| Option | Why not |
| --- | --- |
| ChurchTools login token of a dedicated account (status quo) | The backend sees a permanent ChurchTools credential, and every request costs ChurchTools calls. |
| API key per client (stored as a hash) | Simpler and nearly as safe. But the permanent secret travels with every request; a single intercepted request (TLS-terminating proxy, a stray log) exposes it until revoked. |

**Why this one:**

- The secret never leaves the client. An intercepted token is useless after at most 300 seconds, and replay within
  that window is blocked by `jti`.
- The backend stores only public keys, which are worthless to an attacker.
- No ChurchTools call and no extra token request per login. That fits ct-radius, which starts a new process per
  RADIUS request.

**Cost:**

- Key generation and signing in the client (Node.js and PHP both support Ed25519 natively).
- Roughly synchronized clocks.
- A registry of clients in the settings with a small admin UI.
- A `jti` cache in the backend.

## 9. Later (not part of the first release)

- **Possible second step: ct-radius talks only to the backend.** A lookup endpoint for machine clients (e.g.
  `GET /v1/accounts/{username}`) would return the person ID, group IDs and the encrypted password in one call, so
  ct-radius needs no ChurchTools credential at all. It would require read rights on persons and groups for the service
  user, and a cached username-to-ID mapping. Guests (ct-guests) would have to move as well. **Deferred:** ChurchTools is
  reworking the KV store (as of 2026-11), which may make this step, or the whole backend, unnecessary (see below).
- **Re-evaluate the backend when ChurchTools' new KV store is available.** The backend exists because the current KV
  store can't express what ct-pass-store needs:
  - Permissions are per category, so anyone who may write `passwordStore` may overwrite every user's entry. Only the
    backend's service user may write there.
  - There are no keys per value, no filtering and no per-entry access for external readers.

  If the new KV store offers ownership or per-entry permissions ("users may only write their own entry"), lookups by
  key, and read access for a dedicated account, the extension could encrypt in the browser (it already ships an RSA
  library) and write directly, and ct-radius could read directly. The backend would then no longer be needed.
- Cleanup of entries belonging to deleted ChurchTools persons (❓ Q16).
- Roles via ChurchTools groups (❓ Q22).
- Backup and restore of extension data (an extension feature, not a backend feature).
