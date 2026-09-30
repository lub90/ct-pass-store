# CtPassStore Backend – Specification

> **Status: DRAFT.** This document describes how the PHP backend *should* behave. It is the reference for unit tests,
> end-to-end tests and the cleanup work. It was derived from the current code, [`backend/README.md`](../backend/README.md)
> and the existing end-to-end tests.

**Legend**

| Marker | Meaning |
| --- | --- |
| *(current)* | The code already behaves like this. Keep it. |
| **(change)** | The code behaves differently today. This is the target behavior. |
| **❓ Qn** | Open question, collected in [section 7](#7-open-questions). Each has a proposal. |

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
| **Read-access user** | A person listed in `readAccessUsers`. May read **any** entry. Typically the ChurchTools account of an external system such as ct-radius. |
| **Extension** | The ChurchTools extension. Calls the backend on behalf of the logged-in user. |
| **Service user** | The ChurchTools account the backend itself uses (`CT_API_TOKEN`). It's the only account allowed to write to `passwordStore`. |
| **ChurchTools** | Identity provider (token validation, primary password check), permission source and storage (KV store). |

Data lives in three KV categories of the `ctpassstore` module:

| Category | Content | Written by |
| --- | --- | --- |
| `passwordStore` | One value per person: `{"personId": <int>, "secondaryPwd": "<base64 ciphertext>"}` | Backend (service user) only |
| `settings` | One value: `requirePasswordForPasswordChange`, `allowCustomPassword`, `passwordLength`, `adminUsers`, `readAccessUsers` (plus UI settings such as `backendUrl`) | Extension admins |
| `encryptionSettings` | One value: `publicKey` (PEM) | Extension setup |

## 3. Configuration

### 3.1 Local configuration (`config/credentials.php`)

| Key | Required | Meaning |
| --- | --- | --- |
| `CT_API_URL` | yes | ChurchTools API base URL, e.g. `https://example.church.tools/api` |
| `CT_API_TOKEN` | yes | Login token of the service user |
| `CORS` | yes | List of allowed origins. Must include the ChurchTools instance. |
| `LOG_LEVEL` | no | **(change)** Minimum log level, default `info` (today it's hard-coded to `debug`). ❓ Q18 |

- The file must be readable only by its owner (mode `0600` or stricter). The `/test` endpoint checks this *(current)*.
- **(change)** Missing or invalid required keys make the backend fail at startup with a clear log message and a `500`
  JSON response. They shouldn't cause a PHP error further down the line.

### 3.2 Settings from ChurchTools

- Settings and the public key are read from ChurchTools *(current)*.
- **(change)** They're cached (see [6.1](#61-performance-and-caching)).
- **(change)** Settings are validated when loaded:
  - `passwordLength` is an integer in a sane range. ❓ Q7
  - `adminUsers` and `readAccessUsers` are lists of positive integers.
  - The booleans are booleans.
  - `publicKey` is a loadable RSA public key of at least 4096 bits.
- **(change)** Invalid or missing settings produce a `500` error response (`settings_invalid`) and an `error` log
  entry. They must never produce a silent fallback that weakens security, such as a password length of `0`.

## 4. API contract

### 4.1 General rules

- **Transport:** HTTPS only *(current, enforced by `.htaccess`)*.
- **Format:** Requests and responses are JSON (`Content-Type: application/json`), except `204` responses, which have no
  body.
- **Authentication:** Every endpoint requires `Authorization: Login <churchtools-login-token>`. ❓ Q1 (JWT)
- **Uniform error format** for every error response, including `404`/`405`/`500`:

  ```json
  { "error": "<machine-readable code>", "message": "<human-readable text>" }
  ```

  *(current)* Both fields exist today, but `error` holds inconsistent free text ("Invalid parameters",
  "Unauthorized", …). **(change)** `error` becomes a stable snake_case code from the table in 4.8. ❓ Q12
- **Unknown routes** return `404 not_found`. **(change)** Today there's no error middleware, so this crashes.
- **Wrong HTTP methods** on known routes return `405 method_not_allowed` with an `Allow` header. **(change)**
- **No side effects** on any error response: nothing is written to ChurchTools *(current, asserted by the E2E tests)*.
- **Path parameter `{id}`** must be a positive integer. Anything else returns `400 invalid_id`. **(change)** Today
  `(int) "abc"` becomes `0`, and admins can create an entry for person `0`. ❓ Q10
- **Request bodies** must be empty or a JSON **object**. Invalid JSON or a non-object returns `400 invalid_body`
  *(partly current: invalid JSON is rejected; JSON arrays or scalars aren't)*.
- **Secrets never appear** in error messages, logs or response headers.

### 4.2 CORS

- Only origins listed in `CORS` get `Access-Control-Allow-*` headers *(current)*.
- Preflight (`OPTIONS`) is answered by the CORS middleware without authentication *(current)*.
- **(change)** `Access-Control-Allow-Methods` lists only the methods actually used (`GET, PUT, DELETE, OPTIONS`).
  `POST` isn't used today.

### 4.3 Authentication and authorization pipeline

Every request (except `OPTIONS`) goes through these steps, in this order:

1. The `Authorization` header is missing → `401 missing_token`.
2. The header doesn't start with `Login ` → `401 invalid_token`.
3. The token isn't accepted by ChurchTools (`GET /whoami` fails or returns no valid user ID) → `401 invalid_token`.
4. The user doesn't have the extension's `view` permission (`/permissions/global`) → `403 no_service_access`.
5. For `/entries/{id}`: the caller isn't allowed to act on `{id}` → `403 forbidden`, according to this matrix:

| Caller | GET own | GET other | PUT/DELETE own | PUT/DELETE other |
| --- | --- | --- | --- | --- |
| User | ✅ | ❌ | ✅ | ❌ |
| Read-access user | ✅ | ✅ | ✅ | ❌ |
| Admin user | ✅ | ✅ | ✅ | ✅ |

*(current)* The matrix matches today's behavior.

- If ChurchTools is **unreachable** or answers unexpectedly during steps 3–4, the response is
  `502 upstream_unavailable` (or `503` when rate-limited, see [6.2](#62-churchtools-rate-limit-and-availability)),
  **not** `401`. **(change)** Today network errors are indistinguishable from an invalid token.
- Only the prefix `Login ` is stripped from the header, not every occurrence of the string. **(change)** Today
  `str_replace` is used.

### 4.4 `GET /entries/{id}`

Returns the encrypted secondary password of person `{id}`.

| Case | Response |
| --- | --- |
| Entry exists | `200` `{"secondaryPwd": "<base64 ciphertext>"}` *(current)* |
| No entry | `404 entry_not_found` *(current)* |
| Several entries for `{id}` (corrupt state) | **(change)** `200` with the entry that has the **highest value ID** (the newest), plus a `warning` log entry. Today it returns `404`. ❓ Q9 |

- No primary password is needed *(current)*.
- The response contains only ciphertext. Nobody can obtain a plaintext password through `GET`.

### 4.5 `PUT /entries/{id}`

Sets or replaces the secondary password of person `{id}`.

**Request body** (all fields optional):

```json
{ "primaryPwd": "<caller's ChurchTools password>", "secondaryPwd": "<custom password>" }
```

**Processing order:**

1. Authorization according to 4.3.
2. If `requirePasswordForPasswordChange` is `true`:
   - `primaryPwd` is missing or empty → `400 primary_password_required` *(current)*.
   - `primaryPwd` is wrong → **(change)** `403 invalid_primary_password`. Today it's `401`, which the extension can't
     tell apart from an invalid token. ❓ Q6
   - The primary password checked is the **caller's** own, also when an admin changes someone else's entry
     *(current)*. ❓ Q4
3. If `secondaryPwd` is present (including an empty string):
   - `allowCustomPassword` is `false` → `400 custom_password_not_allowed` *(current)*.
   - The password fails validation ([5.1](#51-password-policy-passwordvalidator)) → `400 password_invalid`, with a
     message that states the rules *(current)*.
4. If `secondaryPwd` is absent, a random password is generated ([5.1](#51-password-policy-passwordvalidator))
   *(current)*.
5. The password is encrypted ([5.2](#52-encryption-encryptionservice)) and stored ([5.3](#53-password-store)).

**Responses:**

| Case | Response |
| --- | --- |
| Custom password stored | `204`, empty body *(current)* |
| Generated password stored | `200` `{"secondaryPwd": "<plaintext generated password>"}` *(current)*. This is the only time plaintext leaves the backend, and only to the caller. The response must carry `Cache-Control: no-store` **(change)**. |

- Afterwards, exactly **one** entry exists for `{id}` (see 5.3).
- Setting the same password again is allowed.

### 4.6 `DELETE /entries/{id}`

Deletes the entry of person `{id}`.

- Authorization as for `PUT` *(current)*.
- If `requirePasswordForPasswordChange` is `true`, `primaryPwd` is required in the body, as for `PUT` *(current)*.
  ❓ Q5
- **All** entries for `{id}` are deleted, including duplicates *(current)*.
- Response `204`, also when no entry existed *(current: idempotent)*.

### 4.7 `GET /test` (self-check)

- Requires authentication like every other endpoint *(current)*. ❓ Q11: who may call it.
- It runs these checks and reports each one as `{name, status: "ok"|"fail", message}` *(current)*:
  - `credentials.php` has mode `0600` or stricter *(current)*
  - all settings can be read *(current)*
  - **(change)** the settings pass validation (3.2)
  - **(change)** the public key loads and a test encryption succeeds
  - **(change)** the service user can read `passwordStore`
  - **(change)** optionally, the service user can create and delete a test value in `passwordStore`. ❓ Q11
- Response: `200` if all checks pass, otherwise `207` *(current)*. Body: `{"summary": "...", "tests": [...]}`.
- The checks must not reveal secrets, file paths outside the project, or other users' data.

### 4.8 Error codes

| HTTP | `error` | When |
| --- | --- | --- |
| 400 | `invalid_id` | `{id}` isn't a positive integer |
| 400 | `invalid_body` | Body isn't empty and isn't a JSON object |
| 400 | `primary_password_required` | Primary password required but missing |
| 400 | `custom_password_not_allowed` | Custom password sent while disabled |
| 400 | `password_invalid` | Custom password fails the policy |
| 401 | `missing_token` | No `Authorization` header |
| 401 | `invalid_token` | Wrong scheme or token rejected by ChurchTools |
| 403 | `no_service_access` | No extension `view` permission |
| 403 | `forbidden` | Not allowed to act on this entry |
| 403 | `invalid_primary_password` | Wrong primary password (❓ Q6) |
| 404 | `not_found` | Unknown route |
| 404 | `entry_not_found` | No entry for this person (`GET` only) |
| 405 | `method_not_allowed` | Known route, wrong method |
| 429 | `too_many_attempts` | Too many primary-password attempts (see 6.3) |
| 500 | `settings_invalid` | Configuration or settings missing or invalid |
| 500 | `internal_error` | Anything unexpected. Details only go to the log. |
| 502 | `upstream_unavailable` | ChurchTools unreachable or answered unexpectedly |
| 503 | `upstream_rate_limited` | ChurchTools answered `429`, with a `Retry-After` header |

## 5. Units

These sections describe behavior per unit. Each numbered rule should map to at least one unit test.

### 5.1 Password policy (`PasswordValidator`)

**Validation** *(current, unless marked)*:

1. The allowed characters are `a–z`, `A–Z`, `0–9` and the symbols `! @ $ % & * - _ + = ? .`. Any other character (for
   example a space, `#`, umlauts or emoji) is invalid. ❓ Q8
2. The password contains at least one letter, one digit and one symbol.
3. Its length is at least `passwordLength`.
4. **(change)** Its length is at most **128** characters. RSA-4096 with OAEP/SHA-256 can encrypt at most 446 bytes, and
   today a longer custom password crashes the encryption with a `500`. ❓ Q8
5. Validation works on bytes, and the allowed set is ASCII-only, so byte length equals character length.

**Generation:**

1. It produces exactly `passwordLength` characters.
2. The result always passes validation (rules 1–4).
3. Every character comes from a cryptographically secure random source *(current, `random_int`)*.
   **(change)** The final shuffle uses a secure shuffle too, instead of `str_shuffle` (which uses a non-cryptographic
   generator).
4. `passwordLength` below the minimum from ❓ Q7 is a configuration error (`settings_invalid`), not an exception deep
   inside the generator.

### 5.2 Encryption (`EncryptionService`)

1. The algorithm is RSA with OAEP padding, SHA-256 as hash and SHA-256 for MGF1 *(current)*.
2. The output is the base64-encoded ciphertext *(current)*.
3. The same plaintext encrypted twice gives different ciphertexts (OAEP is randomized). Tests must not compare
   ciphertexts, only decrypt them with the test key.
4. **(change)** An invalid or too-small public key (under 4096 bits) is reported as `settings_invalid`, not as a
   generic encryption failure.
5. The plaintext never appears in exceptions or logs.

### 5.3 Password store

This covers the lookup and write logic in `ChurchToolsStore`.

1. Entries are matched by `personId` using **one consistent comparison**: both sides are normalized to `int`.
   **(change)** Today `getPwd` uses `==` while `putPwd`/`deletePwd` use `===`.
2. New entries store `personId` as an integer *(current)*.
3. **Read:** returns the ciphertext for `personId`, or "none". With duplicates it returns the entry with the highest
   value ID (see 4.4). **(change)**
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

### 5.4 Settings (`ServiceSettings`)

1. Settings and the public key are loaded lazily and at most once per request *(current)*.
2. **(change)** They're cached across requests (6.1).
3. **(change)** They're validated according to 3.2.
4. Missing optional lists (`adminUsers`, `readAccessUsers`) mean "empty" *(current)*.

### 5.5 ChurchTools authentication (`ChurchtoolsAuth`, `ChurchtoolsAuthVerifier`)

1. **Token validation:** `GET /whoami` with the caller's token returns the person. An ID under 1 counts as invalid
   *(current)*.
2. **Service access:** `GET /permissions/global` → `data.ctpassstore.view === true` *(current)*.
3. **Primary password check:** `POST /api/login` with the caller's username (`cmsUserId`) and password. `200` means
   valid *(current)*.
   - **(change)** Network errors and unexpected status codes count as `upstream_unavailable`, not as a wrong password.
   - **(change)** Rate-limited (6.3).
   - ❓ Q13: behavior for users with two-factor authentication.
4. All ChurchTools calls use one central timeout setting *(current: 5 s, but only for the password check)*.

### 5.6 ChurchTools client (`ChurchToolsClient`)

**(change)** A small client of our own, built on Guzzle. It replaces the `churchtools/php-client` library (see
[D1](#d1-own-churchtools-client-instead-of-churchtoolsphp-client)). All ChurchTools communication goes through it.

1. **Interface:** one PHP interface covering exactly the calls the backend needs:
   - `whoami(token)`
   - `globalPermissions(token)`
   - `verifyLogin(username, password)`
   - `getModuleByKey(key)`
   - `getCategories(moduleId)`
   - `getValues(moduleId, categoryId)`
   - `createValue(…)`, `updateValue(…)`, `deleteValue(…)`

   Services depend on the interface only, so unit tests can use a fake implementation.
2. **Authentication:** calls on behalf of the caller send the caller's token. Calls to the KV store use the service
   user's token. The client never logs tokens or passwords.
3. **URLs:** the base URL is normalized to end with `/`, and relative paths never start with `/`. This prevents the
   usual URL-joining mistake where `/api` gets dropped.
4. **Timeouts:** one central connect/request timeout for all calls (default 5 s).
5. **Error mapping:**

   | ChurchTools response | Result |
   | --- | --- |
   | `401` / `403` | "Not authenticated / not permitted" |
   | `404` | "Not found" |
   | `429` | Rate-limited, including `Retry-After` |
   | Network error, timeout, `5xx` or a body that isn't JSON | "Upstream unavailable" |

   Each case is its own exception type, so the middleware can turn it into the error codes of 4.8.
6. **No retries** inside a request (see 6.2).
7. **Responses:** JSON is decoded into plain arrays and unwrapped from ChurchTools' `data` envelope. Only the fields the
   backend uses are read.

### 5.7 Middleware

1. **Order:** CORS → error handling → authentication → routing. **(change)** There's no error middleware today.
2. **Error middleware:** turns every exception into the uniform error format (4.1). It logs internal errors with a
   stack trace and returns only the generic message `internal_error` to the client.
3. **Auth middleware:** implements steps 1–4 of 4.3 and attaches the authenticated person to the request.

## 6. Non-functional requirements

### 6.1 Performance and caching

- **Goal:** a typical request makes as few ChurchTools calls as possible. Today it makes about 5–7.
- **Cached, with TTLs:**

  | Data | Proposed TTL | Effect |
  | --- | --- | --- |
  | Module ID, category IDs | 1 hour | These only change on reinstall |
  | Settings, public key | 60 s | Admin changes take up to 1 minute to apply |
  | Token → person, `view` permission | 60 s | A revoked token or permission stays valid for up to 1 minute. ❓ Q15 |

- `passwordStore` values are **never** cached. Reads must always see the latest write.
- **Cache backend:** a file cache outside the web root by default; APCu if available. ❓ Q3
- Cache files contain no secrets. Tokens are only stored as hashes (SHA-256).

### 6.2 ChurchTools rate limit and availability

- ChurchTools allows about 600 requests per minute **per IP**, and all backend traffic shares one IP.
- **(change)** When ChurchTools answers `429`, the backend doesn't retry within the request. It answers
  `503 upstream_rate_limited` with `Retry-After: 60` (or ChurchTools' value, if larger). ❓ Q14
- **(change)** Timeouts or connection errors → `502 upstream_unavailable`.

### 6.3 Security

- **(change)** Primary-password attempts are limited per person: after 5 failures within 15 minutes →
  `429 too_many_attempts` for 15 minutes. This protects accounts, and it prevents the backend's IP from being
  locked out by ChurchTools. The numbers are a proposal.
- Nothing outside `public/` is reachable over HTTP. Directory listings are off *(current, `.htaccess`)*.
- Logs never contain passwords (primary, secondary or generated), tokens or ciphertexts.
- **(change)** Security headers on all responses: `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
- ❓ Q1: replace login tokens with short-lived JWTs. Today the extension fetches the user's **permanent** login token
  (`GET /persons/{id}/logintoken`) and sends it to the backend.

### 6.4 Logging

- PSR-3 logger (Monolog) writing to `logs/app.log` *(current)*.
- **(change)** Configurable level (default `info`) and log rotation (e.g. Monolog's `RotatingFileHandler`, keeping 14
  days).
- **What gets logged:**

  | Level | Events |
  | --- | --- |
  | `warning` | Denied access, with person ID and IP address |
  | `info` | Password changes and deletions, with person IDs |
  | `error` | Upstream errors |

### 6.5 Platform and deployment

- **PHP version:** ❓ Q2 (currently `^8.1`, which is end-of-life).
- Runs on ordinary shared hosting with Apache and `.htaccess`. No daemon, no database, no shell access needed at
  runtime.
- The `setup/setup.sh` script produces an upload-ready folder *(current)*.
- **(change)** The backend reports its version. It's included in the `/test` response and in the logs at startup.

### 6.6 Quality gates

- PHPStan at an agreed level. Start with a baseline, then raise the level step by step.
- A code-style check.
- A unit test suite without network access. ChurchTools is mocked.
- A GitHub Actions workflow runs all of the above on every push and pull request, for every supported PHP version.
- The end-to-end suite against a real ChurchTools instance is run manually before each release.

## 7. Open questions

| # | Question | Proposal |
| --- | --- | --- |
| Q1 | JWT instead of login tokens: before or after the first release? | Before, if ChurchTools can issue JWTs. Otherwise a breaking API change follows later. Research needed. |
| Q2 | Minimum PHP version? | 8.2 (or 8.3), depending on your target hosts |
| Q3 | Cache backend? | File cache by default, APCu if available |
| Q4 | When an admin changes someone else's password, whose primary password is checked? | The admin's own (as today) |
| Q5 | Should `DELETE` require the primary password? | Yes (as today). Deleting breaks the user's access just like a change does. |
| Q6 | Status code for a wrong primary password? | `403 invalid_primary_password` instead of `401` |
| Q7 | Minimum (and maximum) for the `passwordLength` setting? | 12 to 64 |
| Q8 | Keep the restricted character set? Maximum length? | Keep the set (it's safe for RADIUS and other systems); maximum 128 |
| Q9 | Duplicate entries on read: return the newest, or treat as an error? | Return the newest (highest value ID), log a warning, and heal on the next write |
| Q10 | Invalid `{id}`: `400` or `404`? | `400 invalid_id` |
| Q11 | Who may call `/test`, and should it write test data? | Admin users only; the write test only with `?write=1` |
| Q12 | Change `error` to stable codes? Does ct-radius depend on the current texts? | Yes, if ct-radius only looks at the status code |
| Q13 | Primary password check with two-factor authentication enabled? | Investigate, then document. Until then, document it as unsupported. |
| Q14 | On a ChurchTools `429`: retry inside the request, or return `503` right away? | Return `503` right away |
| Q15 | Is a 60 s delay acceptable for revoked tokens and permissions? | Yes; shorter TTLs cost rate limit |
| Q16 | Cleanup job for entries of deleted persons: how is it triggered? | A CLI script for cron, plus an admin-only endpoint for hosts without cron |
| Q17 | Should the backend also enforce HTTPS itself (not only via `.htaccess`)? | Yes: reject plain HTTP with `400` when it's detectable |
| Q18 | Make the log level configurable? | Yes, `LOG_LEVEL` in `credentials.php` |

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
from caching (6.1).

**Cost:** about 150–200 lines plus unit tests. We give up generated, typed response models.

**Order:** implement this before the unit tests for authentication and the store, so those tests target the new
interface right away.

## 9. Later (not part of the first release)

- Cleanup of entries belonging to deleted ChurchTools persons (❓ Q16).
- JWT authentication, if not done before the release (❓ Q1).
- Backup and restore of extension data (an extension feature, not a backend feature).
