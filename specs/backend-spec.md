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
| **Machine client** | An external system such as ct-radius that reads encrypted passwords without a human user. It authenticates with JWTs it signs itself (D5, 4.3). |
| **Extension** | The ChurchTools extension. Logs the user in via OAuth and calls the backend on their behalf. |
| **Service user** | The ChurchTools account the backend itself uses (`CT_API_TOKEN`). It's the only account allowed to write to `passwordStore`, and it should have no other rights (see 4.8). |
| **ChurchTools** | OAuth authorization server, permission source and storage (KV store). |

Data lives in three KV categories of the `ctpassstore` module:

| Category | Content | Written by |
| --- | --- | --- |
| `passwordStore` | One value per person: `{"personId": <int>, "secondaryPwd": "<base64 ciphertext>"}` | Backend (service user) only |
| `settings` | One value: `requirePasswordForPasswordChange`, `allowCustomPassword`, `passwordLength`, `adminUsers`, `backendUrl`, **(change)** `machineClients`. **(change)** `readAccessUsers` is removed (Q23); machine clients replace it. | Extension admins |
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
| `LOG_LEVEL` | no | **(change)** Minimum log level (`debug`, `info`, `notice`, `warning`, `error`), default `info` (today it's hard-coded to `debug`). Any other value is `misconfigured` (Q18). |

- **(change)** The file must be readable by PHP but not by other users. The exact mode depends on the hosting:
  - PHP runs as the hosting user (PHP-FPM, suPHP; most shared hosts): `600`.
  - PHP runs as the web server user (e.g. `mod_php`): e.g. `640` with the web server's group.

  Today the `/test` endpoint requires `0600` or stricter, which can never pass on hosts of the second kind.
- **(change)** Formats: `CT_API_URL` is an `https://` URL without credentials, query or fragment. `CORS` is a non-empty
  list of origins (`https://host[:port]`, no path, no `*`). `JWT_SECRET` has at least 32 bytes.
- **(change)** Missing or invalid keys don't cause a PHP error further down the line. The backend answers every request
  with `500 misconfigured` (see 4.9), naming the missing or invalid key (never its value) in `detail`, and logs an `error`. If the `CORS` key itself is
  broken, the answer (also to `OPTIONS`) has no CORS headers, so browsers show a CORS error; the admin finds the cause
  by calling the backend directly or in the log.

### 3.2 Settings from ChurchTools

- Settings and the public key are read from ChurchTools *(current)*.
- **(change)** They're cached (see [6.1](#61-performance-and-caching)).
- **(change)** Settings are validated when loaded:
  - `passwordLength` is an integer from **12 to 64** (Q7).
  - `adminUsers` is a list of positive integers; missing means empty.
  - `requirePasswordForPasswordChange` and `allowCustomPassword` are JSON booleans and present. Strings (`"true"`),
    numbers (`0`, `1`) and `null` are rejected.
  - `backendUrl` is an `https://` URL. It's normalized by removing a trailing slash; a query, fragment or credentials
    make it invalid. It's needed only for machine tokens (4.4a), so an invalid value is treated like a missing one:
    machine clients are refused (4.4a.3), users aren't affected, and the problem is logged as `warning` and reported by
    `/test`.
  - `publicKey` (in `encryptionSettings`, exactly one value) is a PEM-encoded **RSA** public key of at least 4096 bits.
    EC or Ed25519 keys, certificates and private keys are rejected. PEM with CRLF line endings is accepted.
  - `machineClients` is a list of registered machine clients (D5):

    ```json
    [{ "id": "ct-radius", "name": "WiFi RADIUS", "publicKeys": ["<Ed25519 public key, base64>"],
       "permissions": ["entries:read"], "createdAt": "2026-11-01" }]
    ```

    - `id` is unique and matches `^[a-z0-9-]{3,40}$` (lowercase ASCII only, so lookalike characters can't imitate a
      registered client).
    - `publicKeys` is a non-empty list of valid Ed25519 public keys (the raw 32 bytes, base64 or base64url encoded, as
      Node.js exports them in a JWK's `x`). Several keys allow rotation without downtime.
    - `permissions` may contain only known values; today that's just `entries:read`. Unknown values (`entries:write`,
      `*`) grant nothing and are reported by `/test`.
    - A missing `machineClients` setting means an empty list.
    - A client with an invalid entry (bad `id`, duplicate `id`, empty or invalid `publicKeys`) is disabled and reported
      by `/test`; it doesn't break the others. With a duplicate `id`, all entries with that `id` are disabled.
    - Every client has its own key pair. Clients that share a public key are all disabled: whoever holds the private
      key chooses `kid`, `iss` and `sub`, and could act as any of them.
    - If `machineClients` itself isn't a list, all machine clients are disabled and `/test` reports it. Users aren't
      affected, because disabling machine clients never weakens security.
    - Every disabled client and ignored permission is logged as a `warning` when the settings are loaded. A disabled
      client only gets `401 invalid-token`, like an unknown one, so the log is where the admin finds the reason.
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
- **Paths (Q20):** every endpoint lives under `/v1/`: `POST /v1/auth/token`, `GET|PUT|DELETE /v1/entries/{id}`,
  `GET /v1/test`. The old paths without prefix answer `404 not-found`.
- **Authentication:** Every endpoint except `POST /v1/auth/token` and `OPTIONS` requires a bearer token (4.3).
- **Errors** follow RFC 9457 "Problem Details" (D2, see 4.9). This includes `404`, `405` and `500`.
- **Unknown routes** return `404` with type `not-found`. **(change)** Today there's no error middleware, so this
  crashes.
- **Wrong HTTP methods** on known routes return `405` with type `method-not-allowed` and an `Allow` header.
  **(change)**
- **No side effects** on any error response: nothing is written to ChurchTools *(current, asserted by the E2E tests)*.
- **Path parameter `{id}`** must be a positive integer in decimal notation without sign, leading zeros or whitespace,
  and at most `PHP_INT_MAX`. Anything else returns `400 invalid-id` (Q10). **(change)** Today `(int) "abc"` becomes `0`,
  and admins can create an entry for person `0`.
- **Request bodies** must be empty or a JSON **object** in UTF-8. Invalid JSON, invalid UTF-8, a non-object, more
  than 32 levels of nesting, unknown or duplicate keys, or fields of the wrong type return `400 invalid-body`
  *(partly current: invalid JSON is rejected; JSON arrays or scalars aren't)*. **(change)**
  - A non-empty body needs `Content-Type: application/json` (optionally with `charset=utf-8`); anything else is
    `415 unsupported-media-type`.
  - Bodies larger than **16 KB** are rejected with `413 payload-too-large` before they're parsed.
  - Fields that the endpoint doesn't define are rejected, so a client can't smuggle in `personId`, `username` or
    similar.
- **Secrets never appear** in problem details, logs or response headers.
- **Security headers** on all responses: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`. **(change)**
- **No PHP output:** `display_errors` is off; PHP warnings, notices and deprecations go to the log, never into a
  response body. **(change)**
- **Methods:** `X-HTTP-Method-Override`, `_method` and similar are ignored. `HEAD`, `PATCH`, `TRACE` and other
  undefined methods give `405`.
- **Plain HTTP** is rejected with `400` when it's detectable at the PHP level, in addition to the redirect in
  `.htaccess` (Q17).
- **Order of checks** (when several problems apply, the first one wins):
  1. Route and method: `404 not-found`, `405 method-not-allowed`
  2. Authentication: `401 missing-token`, `invalid-token`, `token-expired`
  3. Request syntax: `413`, `415`, `400 invalid-id`, `400 invalid-body`
  4. Authorization: `403 forbidden`. This runs **before** any entry is looked up, so the answer never reveals whether
     another person has an entry.
  5. Everything else (primary password, password policy, storage)

  Configuration errors (`500 misconfigured`) can occur at any step that needs the broken part. Preflight requests
  (`OPTIONS`) are answered before step 1.

### 4.2 CORS

- Only origins listed in `CORS` get `Access-Control-Allow-*` headers *(current)*. **(change)** The `Origin` header is
  compared **exactly** with the configured origins (scheme, host and port); a trailing slash, a path, another port or
  a subdomain doesn't match. The allowed origin is echoed back; `*` is never sent.
- Preflight (`OPTIONS`) is answered by the CORS middleware without authentication *(current)*, with `204`, and never
  runs an endpoint's logic. A preflight from a foreign origin gets no `Access-Control-Allow-*` headers.
- **(change)** Headers for allowed origins:
  - `Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS`
  - `Access-Control-Allow-Headers: Authorization, Content-Type`
  - `Access-Control-Max-Age: 600`
  - **no** `Access-Control-Allow-Credentials` (the backend uses bearer tokens, not cookies)
- **(change)** `Vary: Origin` on every response.
- **(change)** Error responses (`4xx`, `5xx`) carry the same CORS headers as successful ones. Otherwise the extension
  couldn't read the problem details.

### 4.3 Authentication and authorization pipeline

**(change)** The backend no longer accepts ChurchTools login tokens from users. Every request (except `OPTIONS` and
`POST /v1/auth/token`) goes through these steps:

1. No `Authorization` header → `401 missing-token`.
2. The header isn't `Bearer <token>`, or the token isn't a JWT → `401 invalid-token`. The scheme is
   case-insensitive (RFC 9110: `bearer` and `BEARER` are accepted). Rejected with `401 invalid-token`: an empty token,
   whitespace inside the token, several `Authorization` headers or a comma-joined value.
3. The token's header decides how it's checked:
   - **No `kid`, `alg` = `HS256`:** a backend access token for a user (4.4).
   - **`kid` = a registered machine client's `id`, `alg` = `EdDSA`:** a machine client token (4.4a).
   - Anything else → `401 invalid-token`. Header parameters other than `alg`, `typ` and `kid` (in particular `jwk`,
     `jku`, `x5u`, `x5c`, `crit`) are never used for verification; a token with `crit` is rejected.

   **Validation order** for both kinds: structure → signature → claims (`iss`, `aud`, `nbf`/`iat`) → `exp` → replay
   (machine tokens). The signature is always checked first: a token with a bad signature is `invalid-token`, even if it
   has also expired. Only a token with a **valid** signature whose `exp` has passed gives `401 token-expired`; this
   applies to user and machine tokens.
4. For `/v1/entries/{id}`: the caller isn't allowed to act on `{id}` → `403 forbidden`, according to this matrix:

| Caller | GET own | GET other | PUT/DELETE own | PUT/DELETE other |
| --- | --- | --- | --- | --- |
| User | ✅ | ❌ | ✅ | ❌ |
| Admin user | ✅ | ✅ | ✅ | ✅ |
| Machine client with `entries:read` | ✅ (any ID) | ✅ | ❌ | ❌ |
| Machine client without permissions | ❌ | ❌ | ❌ | ❌ |

*(current)* The matrix for persons matches today's behavior, minus the removed read-access users (Q23).

- **Principals are typed.** A request is authenticated either as a **person** (from a user token, identified by its
  person ID) or as a **machine client** (identified by its client `id`). They're never compared with each other: a
  machine client with the `id` `123` isn't person 123 and has no "own" entry, and a user whose person ID equals a client
  `id` gets nothing of that client's permissions.

- The admin role is taken from the **current settings** (cached, 6.1), not from the token. Changes to
  the admin lists therefore apply within the settings cache TTL.
- **The extension's `view` permission is checked once, at login** (4.4), not on every request. Revoking it takes effect
  when the backend token expires.
- These steps need **no call to ChurchTools**. Today every request costs two (`whoami`, `/permissions/global`).

### 4.4 `POST /v1/auth/token` (login)

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

All three fields are required, non-empty strings of at most 2,048 characters.

**Processing:**

1. `redirectUri` is **parsed**; its scheme must be `https` and its host and port must equal those of `CT_API_URL`.
   A string prefix check isn't enough (`https://<instance>.evil.com`, `https://<instance>@evil.com`). Otherwise
   `400 invalid-body`, without calling ChurchTools. ChurchTools additionally checks it against the registered URI.
2. The backend exchanges the code at `POST /oauth/access_token` with `grant_type=authorization_code`, its client ID and
   secret, `redirect_uri` and `code_verifier`.
   - Code invalid, expired or already used → `400 oauth-code-invalid`.
   - Client ID or secret rejected → `500 misconfigured`.
3. It checks the returned ChurchTools token (decoding only; ChurchTools publishes no key to verify the signature):
   - it's an RS256 JWT whose `aud` is a string equal to `OAUTH_CLIENT_ID`
   - `scopes` is an **array** that contains the exact string `api`
   - `sub` is a positive integer in decimal notation (as a string or number)

   Otherwise → `502 upstream-invalid`.
4. With the ChurchTools token as `Authorization: Bearer …` and `X-OnlyAuthenticated: 1`, it calls:
   - `GET /api/whoami`: the person ID must be a positive integer and equal the token's `sub` (both normalized to
     integers). The anonymous person (`-1`, `0`) or a mismatch → no token (`502 upstream-invalid`).
   - `GET /api/permissions/global`: `ctpassstore.view` must exist and be the JSON boolean `true`. Missing, `"true"`,
     `1` or anything else → `403 no-service-access`.
   - The username (`cmsUserId`) from `whoami` goes into the backend token (claim `username`). It's needed later for
     the primary password check (5.5), because ChurchTools' login checks username and password, not a person ID.
5. **The ChurchTools access and refresh tokens are discarded.** They're never stored or logged.
6. It issues its own access token.

**Response `200`:**

```json
{ "accessToken": "<backend JWT>", "tokenType": "Bearer", "expiresIn": 900 }
```

**The backend access token** (Q21):

- JWT signed with HS256 and `JWT_SECRET`. The algorithm is pinned; `none` and any other algorithm are rejected.
- Claims:
  - `iss`: the constant `ctpassstore-backend`. It never comes from the request (e.g. the `Host` header).
  - `aud`: the constant `ctpassstore-api`
  - `sub`: the person ID (as a string)
  - `username`: the person's ChurchTools username at login
  - `iat`, `nbf`, `exp` (15 minutes), `jti`
- All of these claims are required; a token missing one is `invalid-token`.
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
| `aud` | the backend URL as stored in `settings.backendUrl`, normalized without a trailing slash |
| `iat`, `exp` | `exp - iat` greater than 0 and at most **300 seconds**; clients should use 60 |
| `jti` | a string of 16 to 128 characters, **unique per request** (required: a repeated `jti` is rejected). Clients should use at least 128 random bits, e.g. `crypto.randomBytes(16).toString('hex')`; the backend can't check randomness and doesn't need to, because the token is signed (see below). |

**Validation by the backend:**

1. `kid` names an enabled registered client; otherwise `401 invalid-token`. A client disabled because of an invalid
   settings entry (3.2) is treated like an unknown one.
2. The signature verifies with **one** of the client's public keys (PHP's built-in sodium extension). Keys embedded in
   the token header (`jwk`, `jku`, `x5u`, `x5c`) are ignored.
3. `iss` = `sub` = `kid`; `aud`, normalized the same way (a trailing slash removed), equals the normalized
   `settings.backendUrl`, otherwise exactly (scheme, host, port and path, case-sensitive in the path); `iat` isn't more than 30 seconds in the
   future; `exp` is greater than `iat`; the lifetime is at most 300 seconds. All claims are required.
   - If `settings.backendUrl` is missing or invalid, machine authentication **fails closed**: every machine request
     gets `500 misconfigured`, and an empty `aud` never matches. Requests of users don't depend on `backendUrl` and
     keep working.
4. `exp` isn't more than 30 seconds in the past; otherwise `401 token-expired`.
5. **Replay protection:** the pair (`kid`, `jti`) hasn't been seen before. It's recorded only **after** steps 1–4
   succeeded, so unauthenticated requests can neither fill the cache nor block another client's `jti`s in advance.
   A client that repeats a `jti` only locks out its own requests. A predictable `jti` gives an attacker nothing:
   without the client's private key no valid token can be made, and the cache is kept per client.
   Seen pairs are kept until their `exp` has passed. A reused token → `401 invalid-token`.
   - If the replay cache can't be read or written, machine requests are **rejected** (`500 misconfigured`), never
     accepted without replay protection.
6. The client's `permissions` decide what it may do (4.3 matrix).

**Revocation:** remove the client or one of its keys from the settings. This takes effect within the settings cache
TTL (6.1).

### 4.5 `GET /v1/entries/{id}`

Returns the encrypted secondary password of person `{id}`.

| Case | Response |
| --- | --- |
| Entry exists | `200` `{"secondaryPwd": "<base64 ciphertext>"}` *(current)* |
| No entry | `404` with type `entry-not-found` *(current status; new body)* |
| Several entries for `{id}` (corrupt state) | **(change)** `200` with the entry that has the **highest value ID** (the newest), plus a `warning` log entry. Today it returns `404`. (Q9) |

- `entry-not-found` is only ever produced by the store's answer "this person has no entry". A `404` from ChurchTools for
  the module or a category (e.g. after a reinstall) never becomes `entry-not-found` (5.3).
- Clients must distinguish "no entry" from other `404`s by the problem `type`. A `404` with any other type (for example
  a wrong backend URL) is an error, not "no password".
- No primary password is needed *(current)*.
- The response contains only ciphertext. Nobody can obtain a plaintext password through `GET`.

### 4.6 `PUT /v1/entries/{id}`

Sets or replaces the secondary password of person `{id}`.

**Request body** (all fields optional):

```json
{ "primaryPwd": "<caller's ChurchTools password>", "secondaryPwd": "<custom password>" }
```

**Processing order:**

1. Authorization according to 4.3.
2. If `requirePasswordForPasswordChange` is `true`:
   - `primaryPwd` is missing or empty → `400 primary-password-required` *(current)*.
   - `primaryPwd` is wrong → **(change)** `403 invalid-primary-password` (Q6). Today it's `401`, which the extension
     can't tell apart from an invalid token.
   - The primary password checked is the **caller's** own, also when an admin changes someone else's entry
     *(current, Q4)*. The username comes from the caller's token, never from the request.
   - Failed attempts count against the **caller**, not against the target person (6.3).
3. If `secondaryPwd` is present (including an empty string):
   - `allowCustomPassword` is `false` → `400 custom-password-not-allowed` *(current)*.
   - The password fails validation ([5.1](#51-password-policy-passwordvalidator)) → `400 password-invalid`, with the
     violated rules in the extension member `violations` *(current: message only)*.
4. If `secondaryPwd` is absent, a random password is generated ([5.1](#51-password-policy-passwordvalidator))
   *(current)*.
5. The password is encrypted ([5.2](#52-encryption-encryptionservice)) and stored ([5.3](#53-password-store)).
   **Only after the write has succeeded** is a generated password returned. If encryption or the write fails, the
   response is an error, the generated plaintext is discarded, and the previous entry stays as it was.
   - If the new value was written but deleting a duplicate fails (healing, 5.3), the request still succeeds: the
     password is stored and readable as the newest entry. The failed deletion is logged as `warning` and healed by the
     next write.

**Responses:**

| Case | Response |
| --- | --- |
| Custom password stored | `204`, empty body *(current)* |
| Generated password stored | `200` `{"secondaryPwd": "<plaintext generated password>"}` *(current)*. This is the only time plaintext leaves the backend, and only to the caller. |

- Afterwards, exactly **one** entry exists for `{id}` (see 5.3).
- Setting the same password again is allowed.

### 4.7 `DELETE /v1/entries/{id}`

Deletes the entry of person `{id}`.

- Authorization as for `PUT` *(current)*.
- If `requirePasswordForPasswordChange` is `true`, `primaryPwd` is required in the body *(current, Q5)*: missing or
  empty → `400 primary-password-required`, wrong → `403 invalid-primary-password`. The rate limit (6.3) applies as for
  `PUT`. The body has no other fields.
- **All** entries for `{id}` are deleted, including duplicates *(current)*.
- Response `204`, also when no entry existed *(current: idempotent)*.

### 4.8 `GET /v1/test` (self-check)

- **(change)** Only admin users may call it (Q11); others get `403 forbidden`, machine clients too.
- It runs these checks and reports each one as `{name, status: "ok"|"fail", message}` *(current)*:
  - **(change)** `credentials.php` is readable by PHP but not by other users (instead of requiring `0600`), and
    `logs/` is writable
  - all settings can be read *(current)*
  - **(change)** the settings pass validation (3.2), including each machine client (disabled clients, unknown
    permissions and empty key lists are reported by name)
  - **(change)** the cache folder is writable by PHP and not by other users
  - **(change)** `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET` and `JWT_SECRET` are present, and `JWT_SECRET` is long enough
  - **(change)** the public key loads and a test encryption succeeds
  - **(change)** the service user can read `passwordStore`
  - **(change)** the service user has **no more rights than needed**. The check fails if the service user has
    administrative rights such as `administer settings`, `administer persons` or `administer custom modules`, or
    write access to extension categories other than `passwordStore`.
  - **(change)** only with `?write=1`: the service user can create, read and delete a test value in `passwordStore`
    (Q11). The test value uses the **reserved `personId` `0`** (5.3.11), which can never belong to a real person (4.1).
    Before writing, the self-test removes test values left over from an earlier run (e.g. after a timeout); after
    writing, it deletes its value again even if a step in between fails.
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
| Extension members | Only where useful: `violations` (list of rule codes) for `password-invalid`; `retryAfter` (seconds, the same value as the `Retry-After` header) for `upstream-rate-limited` and `too-many-attempts` |

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
| 403 | `invalid-primary-password` | Wrong primary password (Q6) |
| 404 | `not-found` | Unknown route |
| 404 | `entry-not-found` | No entry for this person (`GET` only) |
| 405 | `method-not-allowed` | Known route, wrong method |
| 413 | `payload-too-large` | Body larger than 16 KB |
| 415 | `unsupported-media-type` | Non-empty body without `Content-Type: application/json` |
| 429 | `too-many-attempts` | Too many primary-password attempts (see 6.3); with `Retry-After` |
| 500 | `misconfigured` | Configuration, settings, OAuth setup or service-user rights are missing or wrong. `detail` says exactly what. |
| 500 | `internal-error` | Anything unexpected. Generic `detail`; details only go to the log. |
| 502 | `upstream-unavailable` | ChurchTools unreachable, timed out or answered `5xx` |
| 502 | `upstream-invalid` | ChurchTools answered something the backend can't use (e.g. a token without the `api` scope) |
| 503 | `upstream-rate-limited` | ChurchTools answered `429`; with a `Retry-After` header |

- `detail` may contain input from the request (e.g. an unknown path), but only JSON-encoded inside the problem body.
  Error responses are always `application/problem+json`, also when the client sends `Accept: text/html`; an HTML error
  page is never rendered.

**`misconfigured` versus `internal-error`:** anything an admin can fix (credentials, settings, public key, OAuth
application, service-user permissions) is `misconfigured` with a precise `detail`. For example, a `403` from
ChurchTools on a service-user call means missing permissions, which is `misconfigured`, not an upstream failure. Only
real bugs are `internal-error`.

## 5. Units

These sections describe behavior per unit. Each numbered rule should map to at least one unit test.

### 5.1 Password policy (`PasswordPolicy`)

**Validation** *(current, unless marked)*:

1. The allowed characters are `a–z`, `A–Z`, `0–9` and the symbols `! @ $ % & * - _ + = ? .`. Any other character (for
   example a space, `#`, umlauts or emoji) is invalid. **This set is a contract with ct-radius**, which rejects any
   other character; changing it requires changing both (Q8).
2. The password contains at least one letter, one digit and one symbol.
3. Its length is at least `passwordLength`.
4. **(change)** Its length is at most **128** characters. RSA-4096 with OAEP/SHA-256 can encrypt at most 446 bytes, and
   today a longer custom password crashes the encryption with a `500` (Q8). The length is checked **first**, before
   any other rule runs, so huge inputs cost nothing.
5. Validation works on bytes, and the allowed set is ASCII-only, so byte length equals character length.
6. **(change)** Each violated rule is reported (`too-short`, `too-long`, `missing-letter`, `missing-digit`,
   `missing-symbol`, `invalid-character`) for the `violations` member.

**Generation:**

1. It produces exactly `passwordLength` characters.
2. The result always passes validation (rules 1–4).
3. Every character comes from a cryptographically secure random source *(current, `random_int`)*.
   **(change)** The final shuffle uses a secure shuffle too, instead of `str_shuffle` (which uses a non-cryptographic
   generator).
4. `passwordLength` outside 12–64 is a configuration error (`misconfigured`, 3.2) and never reaches the generator. The
   generator additionally rejects lengths below 3 as a programming error (`InvalidArgumentException`).
5. **(change)** The generator takes a `Random\Randomizer` with a cryptographically secure engine as a dependency, for
   choosing characters and for shuffling. Tests pass a randomizer with a fixed seed to check positions
   deterministically.

### 5.2 Encryption (`RsaPasswordCipher`)

1. The algorithm is RSA with OAEP padding, SHA-256 as hash and SHA-256 for MGF1 *(current)*. ct-radius decrypts with
   exactly these parameters.
2. The output is the base64-encoded ciphertext *(current)*.
3. The same plaintext encrypted twice gives different ciphertexts (OAEP is randomized). Tests must not compare
   ciphertexts, only decrypt them with the test key.
4. **(change)** An invalid, non-RSA or too-small public key (under 4096 bits) is reported as `misconfigured`, not as a
   generic encryption failure. Larger RSA keys (e.g. 8192 bits) are accepted.
5. The plaintext never appears in exceptions or logs.

### 5.3 Password store

This covers the lookup and write logic in `KvPasswordRepository`.

1. Entries are matched by `personId` using **one consistent comparison**: both sides are normalized to `int`.
   **(change)** Today `getPwd` uses `==` while `putPwd`/`deletePwd` use `===`.
2. New entries store `personId` as an integer *(current)*.
3. **Read:** returns the ciphertext for `personId`, or "none". With duplicates it returns the entry with the highest
   value ID (see 4.5). Value IDs are compared as **integers** (`10` > `9`). **(change)**
4. **Write:** if no entry exists, one is created. If one exists, it's updated. **(change)** If several exist, the entry
   with the highest value ID is updated and all others are deleted, so the state heals itself. Today the write throws
   on every attempt.
5. **Delete:** removes all entries for `personId`. Doing nothing is fine if none exist *(current)*.
6. The KV store has no transactions and no conflict detection. Two concurrent writes for the same person can still
   create a duplicate, but rules 3–5 guarantee it never blocks anyone and disappears on the next write.
   **(change)** A value that disappears between reading and writing (a concurrent delete or heal) isn't an error: if
   the update of the newest entry gets `404`, the write creates a new entry; a delete that gets `404` counts as done.
   Only a `404` for the module or a category stays `500 misconfigured` (rule 10); creating fails in that case too.
7. **(change)** Broken values must not crash reading or writing for other people:
   - A value without a valid `personId` (broken JSON, missing, wrong type) is skipped with a `warning` log entry.
     `personId` `0` is not "invalid" but reserved (rule 11).
   - A value with a valid `personId` but a missing or invalid `secondaryPwd` counts as that person's **corrupt entry**:
     reading ignores it (as if there were no entry for it), writing overwrites it (no duplicate appears next to it),
     deleting removes it.
8. A value must stay under the KV store limit of 10,000 characters. A 4096-bit ciphertext in base64 is 684 characters,
   so this is only a sanity check.
9. **(change) Completeness check:** the KV endpoint returns all values with `meta.count` and doesn't paginate (measured:
   no `meta.pagination`, and `page`/`limit` are ignored). Every read checks that the number of returned values equals
   `meta.count`. If not, or if `meta.count` is missing or not an integer, it fails with `502 upstream-invalid` instead
   of answering "no entry" or creating a duplicate.
10. **(change) Module and categories:** if the module `ctpassstore` or one of its categories doesn't exist, the answer is
    `500 misconfigured`. If ChurchTools answers `404` for a **cached** module or category ID (e.g. after a reinstall),
    the cached IDs are discarded and resolved once more within the same request; if that fails too, `500
    misconfigured`. A `404` for the module or a category never becomes `entry-not-found`.
11. **(change) Reserved `personId` `0`:** values with `personId` `0` belong to the self-test (4.8). The normal operations
    for persons ignore them **silently** (no warning): they're never returned, overwritten or deleted on behalf of a
    person, and they don't count as duplicates. Only the self-test reads, writes and deletes them. A leftover test value
    therefore disturbs nothing.

### 5.4 Settings (`KvSettingsRepository`)

1. Settings and the public key are loaded lazily and at most once per request *(current)*.
2. **(change)** They're cached across requests (6.1).
3. **(change)** They're validated according to 3.2.
4. Missing optional lists (`adminUsers`, `machineClients`) mean "empty" *(current)*.

### 5.5 Authentication (`TokenService`, `PrimaryPasswordVerifier`)

1. **(change) Token exchange:** implements 4.4. It's the only place where a user's ChurchTools token exists, and only
   for the duration of the request.
2. **(change) Issuing and validating backend tokens:** implements the token format of 4.4 with a small, well-known JWT
   library. Validation pins the algorithm and checks `iss`, `aud`, `exp` and `nbf`.
3. **Primary password check:** `POST /api/login` with the caller's username and password. The username comes from
   the `username` claim of the caller's backend token (4.4), never from the request.
   - The check passes only if ChurchTools answers `200` **and** the person ID in the response equals the token's
     `sub`. A different person (e.g. a username that was reassigned meanwhile) counts as a wrong password and is
     logged as `warning`.
   - **(change)** Network errors, timeouts and `5xx` count as `upstream-unavailable`, not as a wrong password, and
     they don't count against the rate limit: ChurchTools couldn't be asked. A `429` (`upstream-rate-limited`) or an
     answer the backend doesn't understand (`upstream-invalid`) isn't a wrong password either, but **it counts** against
     the rate limit, because the attempt reached ChurchTools. Otherwise a lockout that ChurchTools answers with `429`
     would let every attempt through.
   - Only the statuses `success`, `totp` and `twoFactorSetup` mean "password correct". Any other status in a `200` is
     `upstream-invalid`, never a pass.
   - **(change)** Rate-limited (6.3).
   - The response creates a ChurchTools session; its cookie is discarded. No CSRF token is sent with `/login`.
   - **Two-factor authentication (Q13):** for users with two-factor authentication, ChurchTools answers `200` with
     `status: "totp"` (or `"twoFactorSetup"`) when the password is correct but the second factor is still missing. This
     counts as a **correct** primary password. The check only confirms that the user knows their password; the second
     factor protects the ChurchTools login itself, not this confirmation. Wrong passwords still give `400` and fail.
     This behavior is documented for admins in the setup docs.

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
6. **Transport security:** TLS certificate verification is always on (Guzzle's `verify` is never disabled), and
   redirects aren't followed, so credentials never go to another host.
7. **Error mapping:**

   | ChurchTools response | Result |
   | --- | --- |
   | `401` / `403` on a user call | not authenticated / not permitted |
   | `401` / `403` on a service-user call | configuration problem (`misconfigured`) |
   | `404` | not found |
   | `429` | rate-limited, including `Retry-After` (seconds or HTTP date; missing or unparsable counts as 60) |
   | Network error, timeout, `5xx` | upstream unavailable |
   | A body that isn't the expected JSON | upstream invalid |

   Each case is its own exception type, so the error middleware can turn it into the problem types of 4.9.
8. **No retries** inside a request (see 6.2). The only exception is the one-time re-resolution of module and category
   IDs (5.3.10).
9. **Responses:** JSON is decoded into plain arrays and unwrapped from ChurchTools' `data` envelope. Only the fields
   the backend uses are read.
10. **CSRF:** REST write requests with a login token currently work without a CSRF token. The client is built so that
   fetching one from `GET /api/csrftoken` can be added in one place if ChurchTools starts requiring it.

### 5.7 Middleware

1. **Order:** CORS → error handling → routing → authentication → request syntax → authorization → endpoint, matching
   the order of checks in 4.1. **(change)** There's no error middleware today.
2. **Error middleware:** turns every exception into a problem details response (4.9). It logs internal errors with a
   stack trace and returns only a generic `detail` for `internal-error`.
3. **Auth middleware:** implements 4.3 and attaches the authenticated principal (person or machine client, typed) to
   the request.

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
- **Cache integrity:** cache files contain no secrets and are stored as JSON (never `serialize`/`unserialize`). Each
  entry is signed with an HMAC whose key is derived from `JWT_SECRET`, and each cache file records an identifier of
  that key (a hash, not the key). Files are created readable and writable only by PHP (`600`, folder `700`, or the group variant of 3.1), so
  other users on shared hosting can't plant settings such as `adminUsers`. Cache keys are hashed before they're used as
  file names.
- **Invalid entries** are handled differently for the two kinds of cache:

  | Situation | Settings and ID cache | Security stores (`jti` replay cache, rate-limit counters) |
  | --- | --- | --- |
  | Key identifier is old (`JWT_SECRET` was rotated) | Not trusted; reloaded from ChurchTools | **Cleared** and started over. This reopens a replay window of at most 300 seconds for tokens that were already intercepted, and resets the counters; only an admin can rotate the secret. |
  | Key identifier is current, but the HMAC is wrong or missing (tampering) | Not trusted; reloaded from ChurchTools; `error` logged | **Fail closed:** the affected requests are rejected (`500 misconfigured`) and an `error` is logged, until the admin clears the cache folder |

- **Failure behavior:** if the settings or ID cache can't be read or written, the backend loads from ChurchTools (slower,
  but correct). The security stores **fail closed**: if they can't be read or written, the affected requests are
  rejected (`500 misconfigured`).
- Consumers matter too: ct-radius starts a new process per RADIUS request and has no cache of its own, so every login
  reaches the backend.

### 6.2 ChurchTools rate limit and availability

- ChurchTools allows about 600 requests per minute **per IP**, and all backend traffic shares one IP.
- **(change)** When ChurchTools answers `429`, the backend doesn't retry within the request. It answers
  `503 upstream-rate-limited` with `Retry-After: 60` (or ChurchTools' value, if larger) (Q14).
- **(change)** Timeouts or connection errors → `502 upstream-unavailable`.

### 6.3 Security

- **(change)** Primary-password attempts are limited per **caller** (the authenticated person, not the target entry):
  - Wrong passwords count, and so do attempts that ChurchTools answered with `429` or something unexpected (5.5.3).
    Only outages (network error, timeout, `5xx`) don't count.
  - The limit applies to `PUT` and `DELETE` alike.
  - After the 5th wrong password within a sliding window of 15 minutes, every further attempt gets
    `429 too-many-attempts` without calling ChurchTools, until 15 minutes after that 5th failure. Four failures don't
    block; five failures spread over more than 15 minutes don't block either.
  - Attempts during a block are neither checked nor counted, so they don't extend it. `Retry-After` gives the
    remaining seconds of the block.
  - A correct password resets the counter.
  - **(change)** An attempt counts from the moment it starts, in the same atomic step that checks the block, and is
    withdrawn again if ChurchTools can't be asked. So parallel requests can't run more than 5 checks; while 5 attempts
    are still in flight, further ones get `429` as well.

  This protects accounts, and it prevents the backend's IP from being locked out by ChurchTools.
- The client IP address is always `REMOTE_ADDR`. `X-Forwarded-For`, `X-Real-IP` and `Forwarded` are ignored, because
  shared hosting has no trusted proxy configuration.
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

- Values written to the log are escaped, so control characters or newlines in input can't forge log lines.
- The backend version is part of the context of every `error` entry (PHP has no single startup moment).
- IP addresses and person IDs are personal data. They're logged only to detect abuse, and deleted with the rotated log
  files after 14 days. Document this for admins.

### 6.5 Platform and deployment

- **PHP:** `^8.3`; tested with 8.3, 8.4 and 8.5 (D3).
- Runs on ordinary shared hosting with Apache and `.htaccess`. No daemon, no database, no shell access needed at
  runtime.
- The `setup/setup.sh` script produces an upload-ready folder *(current)*. **(change)** It sets sensible permissions
  there, and the setup docs list the target permissions for both hosting cases (3.1), because uploads don't keep them.
- **(change)** The backend reports its version in the `/v1/test` response and in every `error` log entry: `x.y.z` for a tagged
  release, `x.y.z+<sha>` for other commits, `x.y.z+<sha>-dirty` for uncommitted changes.

### 6.6 Quality gates

- PHPStan at an agreed level. Start with a baseline, then raise the level step by step.
- A code-style check.
- **Three test layers**, each its own PHPUnit suite and folder:

  | Layer | Suite / folder | What it tests | Runs |
  | --- | --- | --- | --- |
  | Unit | `Unit` / `tests/Unit` | Single classes in isolation (validator, encryption, store logic, token checks, error mapping) | CI, every push |
  | API | `Api` / `tests/Api` | The complete Slim app in-process: real HTTP requests and responses, ChurchTools replaced by a fake implementation of the client interface (5.6). The whole authorization matrix, every status code and every problem type are covered here. | CI, every push |
  | Contract | `Contract` / `tests/Contract` | Only what a fake can't prove: that ChurchTools really behaves as assumed (KV read/write and `meta.count`, service-user permissions, primary password check, OAuth code exchange errors), plus a few smoke tests against the running backend. Needs a test instance. | By hand, before each release |

  Neither the unit nor the API layer needs network access. The API layer must exist at the latest in phase 2 of the
  plan.
- **Keeping the fake honest:** the contract cases for the ChurchTools client are written once and run against both the
  real client (contract layer) and the fake (unit layer). The API layer is only as good as the fake, so the fake must
  pass the same cases as the real ChurchTools.
- **Forbidden functions** (`eval`, `unserialize`, `exec`, `str_shuffle`, `rand`, `mt_rand`, loose comparison of
  secrets, …) are banned through a PHPStan rule set (e.g. `spaze/phpstan-disallowed-calls`), not through brittle
  source scans in tests.
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
| Q16 | Cleanup job for entries of deleted persons: how is it triggered? | A CLI script for cron, plus an admin-only endpoint for hosts without cron |
| Q22 | Should admin and read access be granted via ChurchTools groups instead of person-ID lists in the settings? | Later. The consent includes group memberships, and the `api` scope can read them, so it's possible. |

**Answered 2026-11-01 by accepting the proposals:** Q4 (an admin's own primary password is checked), Q5 (`DELETE`
needs the primary password), Q6 (wrong primary password → `403`), Q7 (`passwordLength` 12–64), Q8 (character set
stays; maximum 128), Q9 (duplicates: newest wins, healed on write), Q10 (invalid ID → `400`), Q11 (`/test` for admins
only; write test with `?write=1`), Q14 (ChurchTools `429` → `503` right away), Q17 (plain HTTP rejected), Q18
(configurable `LOG_LEVEL`), Q20 (`/v1/` prefix), Q21 (backend token: 15 minutes, HS256), Q23 (`readAccessUsers`
removed), Q13 (two-factor users: a correct password counts even while the second factor is pending; documented, see
5.5.3).

**Answered earlier:** Q1 (authentication; users via OAuth, D4), Q3 (cache; file cache only), Q2 (PHP version, D3), Q12 (error format, D2), Q15 (token
cache; replaced by Q21), Q19 (machine clients; signed JWTs, D5), Q24 (person and group lookups for ct-radius;
deferred to a possible second step, see section 9), Q25 (no exclusion of easily confused characters like `0`/`O`
from generated passwords; security comes first, the full character set stays).

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
