# CtPassStore Backend – Test Catalog

The test cases for the backend, derived from [`backend-spec.md`](backend-spec.md). Tests are written against this
catalog and checked off when they exist and pass. A case found during implementation goes into the catalog first.

**Notation:** `- [ ] **ID** (Category · Layer) Description — spec reference`

| Category | Meaning |
| --- | --- |
| **N** | Normal case: the expected, everyday behavior |
| **E** | Edge case: boundaries, empty and maximum values, off-by-one |
| **S** | Special case: unusual but legitimate situations, corrupt data, races |
| **!** | Security-critical: a failing test would mean a vulnerability. These are never skipped. |

| Layer | Meaning |
| --- | --- |
| **U** | Unit test (`tests/Unit`), one class in isolation |
| **A** | API test (`tests/Api`), the whole app in-process with a fake ChurchTools client |
| **C** | Contract or smoke test (`tests/Contract`), against a real ChurchTools test instance or the deployed backend |

Cases marked with ❓ depend on an open question of the spec and are adjusted when it's answered.

**Rule: every normal case has its counterparts.** For each "X works" there are cases for "X fails" in every relevant
variation: each single condition violated, several at once, the boundary from both sides, and the same input in a
neighbouring context (another person, another setting, another client). Where a counterpart lives in another case, the
normal case names it ("→ PV-05").

---

## 1. Password policy (`PasswordPolicy`, spec 5.1)

### Validation

- [x] **PV-01** (N · U) A password with letter, digit and symbol at the minimum length is valid — 5.1.1–3
  → counterparts PV-03, PV-05, PV-13, PV-14
- [x] **PV-02** (N · U) A longer valid password is valid — 5.1.3 → counterpart PV-16
- [x] **PV-03** (E · U) Exactly `passwordLength` characters is valid; one less is invalid — 5.1.3
- [x] **PV-03a** (E · U) Too short by several amounts: `passwordLength` − 1, − 2, half of it, 3 (one of each class),
  1 — each invalid (`too-short`), while all classes are present; below 3 characters not every class fits, so
  `too-short` is among the violations — 5.1.3
- [x] **PV-04** (E · U) The empty string is invalid — 5.1.3
- [x] **PV-05** (N · U) Missing letter, missing digit, missing symbol: each is invalid on its own — 5.1.2
- [x] **PV-13** (N · U) Two classes missing: only letters, only digits, only symbols (each at full length) — invalid,
  and both missing classes are reported — 5.1.2, 5.1.6
- [x] **PV-14** (N · U) Combinations: too short **and** one class missing; too short **and** two classes missing; valid
  length **and** an invalid character **and** a class missing — invalid, every violation is reported — 5.1.2–6
- [x] **PV-06** (N · U) Every allowed symbol `! @ $ % & * - _ + = ? .` is accepted — 5.1.1
- [x] **PV-06a** (N · U) Every letter `a–z`, `A–Z` and every digit `0–9` is accepted (exhaustive) — 5.1.1
- [x] **PV-15** (! · U) Exhaustive counterpart: every other byte value is rejected. All printable ASCII characters
  outside the set (`# " ' ( ) , / : ; < > [ \ ] ^ { | } ~`, the backtick and the space), all control characters `0x00–0x1F`
  and `0x7F`, and every byte `0x80–0xFF`, each inserted into an otherwise valid password — 5.1.1
- [x] **PV-07** (! · U) Characters outside the set are rejected: space, `#`, umlaut, emoji, null byte, newline — 5.1.1
- [x] **PV-08** (! · U) Further characters outside the set are rejected: tab, `"`, `'`, `\`, `/`, `<`, `>`, `;`, a
  non-breaking space, a lookalike character (e.g. Cyrillic `а`) — 5.1.1
- [x] **PV-09** (E · U) 128 characters is valid; 129 is invalid (`too-long`) — 5.1.4
- [x] **PV-10** (! · U) A 128-character password still encrypts with RSA-4096/OAEP-SHA256 (with EN-01) — 5.1.4
- [x] **PV-11** (N · U) Each violated rule is reported with its code (`too-short`, `too-long`, `missing-letter`,
  `missing-digit`, `missing-symbol`, `invalid-character`); several at once are all reported — 5.1.6
- [x] **PV-12** (E · U) Multibyte input is measured in bytes: `ä` counts as invalid, not as a short valid character
  — 5.1.5
- [x] **PV-16** (N · U) Long passwords aren't automatically valid: a long password with a class missing, or with one
  invalid character at the start, in the middle or at the end, is invalid — 5.1.1–2
- [x] **PV-17** (E · U) The minimum comes from the setting: the same password is valid for `passwordLength` = its
  length and invalid for its length + 1 (checked for several setting values, e.g. 12, 20, 64) — 5.1.3

### Generation

- [x] **PG-01** (N · U) The result has exactly `passwordLength` characters (3, 12, 64) — 5.1 gen. 1
- [x] **PG-08** (N · U) A changed `passwordLength` setting changes the length of new passwords; it isn't fixed or
  cached from an earlier value — gen. 1
- [x] **PG-02** (N · U) The result always passes validation and uses only allowed characters (200 runs each) — gen. 2
- [x] **PG-03** (! · U) 100 generated passwords are all different — gen. 3
- [x] **PG-04** (E · U) The generator's internal guard: lengths below 3 throw `InvalidArgumentException` (a programming
  error; valid settings are 12–64, see SE-04) — gen. 4
- [x] **PG-05** (! · U) The generator draws from a cryptographically secure source, including for the shuffle: by
  default it gets a `Random\Randomizer` with the `Secure` engine (checked in a test). `str_shuffle`, `rand` and
  `mt_rand` are banned by the PHPStan rule set (spec 6.6) — gen. 3, 5
- [x] **PG-06** (! · U) No position is fixed to a character class: with a fixed-seed test randomizer, the mandatory
  letter, digit and symbol end up at different positions across runs (deterministic). Separately, over 10,000 generated
  characters every allowed character occurs (with a fixed seed, so the test can't fail by chance) — gen. 3, 5
- [x] **PG-07** (E · U) `passwordLength` outside 12–64 never reaches the generator: it's a configuration error
  (`misconfigured`) when the settings are loaded — gen. 4

## 2. Encryption (`RsaPasswordCipher`, spec 5.2)

- [x] **EN-01** (N · U) Encrypt, then decrypt with the test private key, gives the plaintext back — 5.2.1–2
- [x] **EN-09** (! · U) Counterparts of EN-01: decrypting with another private key fails; a ciphertext with one flipped
  bit, a truncated or an extended ciphertext fails to decrypt (no wrong plaintext comes out) — 5.2.1
- [x] **EN-02** (N · U) The output is valid base64, and decoded it's exactly 512 bytes (RSA-4096) — 5.2.2
- [x] **EN-03** (! · U) Encrypting the same plaintext twice gives different ciphertexts (OAEP is randomized) — 5.2.3
- [x] **EN-04** (! · U) The padding is OAEP with SHA-256 and MGF1-SHA-256: decrypting with PKCS#1 v1.5 or OAEP-SHA1
  fails — 5.2.1
- [x] **EN-05** (! · U) A 2048-bit public key is rejected as `misconfigured` — 5.2.4
- [x] **EN-06** (S · U) An unparsable key, an empty key or a private key instead of a public one is rejected as
  `misconfigured` — 5.2.4
- [x] **EN-10** (! · U) Key types and formats: an EC key, an Ed25519 key and an X.509 certificate are rejected
  (`misconfigured`); an RSA key with 8192 bits and a PEM with CRLF line endings are accepted — 3.2, 5.2.4
- [x] **EN-07** (! · U) Neither the exception message nor the log of a failed encryption contains the plaintext — 5.2.5
- [ ] **EN-08** (N · C) A password encrypted by the backend is decrypted correctly by ct-radius' algorithm (Node.js
  `privateDecrypt`, OAEP, SHA-256). Checked once with a recorded sample. — 5.2.1

## 3. Password store (`KvPasswordRepository`, spec 5.3)

- [x] **ST-01** (N · U) Read an existing entry → its ciphertext — 5.3.3
- [x] **ST-02** (N · U) Read a missing entry → "none" — 5.3.3
- [x] **ST-03** (N · U) Write without an entry → exactly one `create` call with `personId` as an integer — 5.3.2, 4
- [x] **ST-04** (N · U) Write with one entry → exactly one `update` call on that value ID — 5.3.4
- [x] **ST-17** (S · U) Counterparts of ST-03/04: `create` or `update` fails at ChurchTools → the error is reported (no
  "success"), and a failed `update` doesn't fall back to a `create` that would produce a duplicate — 5.3.4
- [x] **ST-05** (S · U) Read with duplicates → the entry with the highest value ID, plus a warning log — 5.3.3
- [x] **ST-06** (S · U) Write with duplicates → the highest is updated, all others deleted — 5.3.4
- [x] **ST-20** (E · U) "Highest value ID" compares integers: value IDs `9` and `10` → `10` wins, also when the IDs
  arrive as strings — 5.3.3
- [x] **ST-07** (S · U) `personId` stored as a string (`"5"`) is matched like `5`, for read, write and delete — 5.3.1
- [x] **ST-08** (! · U) `personId` `5` doesn't match `"05"`, `"5a"`, `5.5`, `"5 "` or `true`. Loose comparison must not
  hand out another person's entry — 5.3.1
- [x] **ST-08a** (! · U) Counterpart of ST-01: reading person 5 while only persons 50, 15, 55 and 6 have entries gives
  "none", not one of their entries — 5.3.3
- [x] **ST-09** (S · U) A value with broken JSON, or without a valid `personId`, is skipped with a warning; the other
  entries are still read and written — 5.3.7
- [x] **ST-21** (S · U) A value with a valid `personId` but a missing or invalid `secondaryPwd` is that person's corrupt
  entry: reading treats it as absent; writing **updates** it (no duplicate appears next to it); deleting removes it —
  5.3.7
- [x] **ST-10** (N · U) Delete removes all entries of the person, including duplicates — 5.3.5
- [x] **ST-11** (E · U) Delete without an entry does nothing and doesn't fail — 5.3.5
- [x] **ST-12** (! · U) The number of returned values differs from `meta.count`, or `meta.count` is missing or not an
  integer → `upstream-invalid`; nothing is written, and the result is never "none" — 5.3.9
- [x] **ST-13** (E · U) An empty category (`count = 0`) → "none" — 5.3.9
- [x] **ST-14** (! · U) Writing and deleting never touch other persons' entries (the fake records every call), also
  when they have duplicates or broken values — 5.3.4–5
- [x] **ST-15** (E · U) A stored value longer than 10,000 characters is refused before writing — 5.3.8
- [x] **ST-16** (N · C) Create, read, update, delete against the real KV store; `meta.count` is present and matches —
  5.3
- [x] **ST-18** (! · U) Stale cached IDs: ChurchTools answers `404` for a cached module or category ID → the IDs are
  resolved **exactly once** more; if that works, the request succeeds; if not, `500 misconfigured`. Never
  `entry-not-found`. If the fake keeps answering `404`, the call count shows one re-resolution and no loop — 5.3.10,
  5.6.8
- [x] **ST-22** (S · U) Values with the reserved `personId` `0` (a leftover self-test value) are invisible to the normal
  operations: reading, writing and deleting for persons neither return, change nor delete them, they don't count as
  duplicates, and no warning is logged — 5.3.11
- [x] **ST-19** (N · U) The module `ctpassstore` or the `passwordStore`/`settings`/`encryptionSettings` category doesn't
  exist → `500 misconfigured` naming it — 5.3.10
- [x] **ST-23** (S · U) `personIds()` returns every person with an entry once, ascending: values for `9`, `"5"`, `5`, the
  reserved `0` and a broken one give `[5, 9]` — cleanup design 3.3

## 4. Settings and configuration (spec 3)

- [x] **CF-01** (N · U) A complete, valid `credentials.php` is accepted — 3.1
- [x] **CF-02** (! · A) Each required key missing or empty (`CT_API_URL`, `CT_API_TOKEN`, `CORS`, `OAUTH_CLIENT_ID`,
  `OAUTH_CLIENT_SECRET`, `JWT_SECRET`) → every request answers `500 misconfigured` naming the key, without its value
  — 3.1
- [x] **CF-03** (! · U) `JWT_SECRET` shorter than 32 bytes → `misconfigured`; exactly 32 bytes is accepted — 3.1
- [x] **CF-05** (S · A) The `CORS` key itself is broken → every request, also `OPTIONS`, gets `500 misconfigured`
  without CORS headers — 3.1
- [x] **CF-06** (E · U) `CLEANUP_TOKEN`: absent or `''` → null; a short string is kept (the endpoint stays off, the
  configuration is still valid); 43 characters are usable; a non-string → `misconfigured` naming the key — cleanup
  design 5.1
- [x] **CF-04** (! · U) Wrong types and formats: `CT_API_URL` not a URL, with `http://`, with a query string or with
  credentials in it; `CORS` not a list or containing non-origins (`*`, a path); keys with wrong types → `misconfigured`
  naming the key — 3.1
- [x] **SE-01** (N · U) Valid settings are loaded and typed correctly — 3.2
- [x] **SE-02** (E · U) Missing `adminUsers` and missing `machineClients` mean empty lists; a leftover `readAccessUsers`
  grants nothing (Q23) — 5.4.4
- [x] **SE-03** (! · U) `adminUsers` with non-numeric or negative entries (`"1; drop"`, `-1`, `0`, `1.5`, `null`) is a
  configuration error, not a cast to `0` or `1` — 3.2
- [x] **SE-04** (! · U) `passwordLength`: 12 and 64 are accepted; 11, 65, missing, `0`, negative, a string or a float →
  `misconfigured`, never a silent fallback — 3.2
- [x] **SE-05** (S · U) Booleans given as `"false"`, `"true"`, `0`, `1` or `null`, or missing, are rejected, not
  interpreted as `true` or `false` — 3.2
- [x] **SE-08** (! · U) `encryptionSettings` empty, with several values or without `publicKey` → `misconfigured` — 3.2
- [x] **SE-06** (N · U) `machineClients`: a valid entry is accepted; an invalid `id`, an invalid key or a duplicate `id`
  disables only that entry and is reported — 3.2
- [x] **SE-06a** (E · U) Client `id` length boundaries: 2 and 41 characters are rejected, 3 and 40 accepted — 3.2
- [x] **SE-06b** (! · U) An empty `publicKeys` list disables the client; `permissions` with unknown values
  (`entries:write`, `*`, `admin`) grant nothing and are reported — 3.2
- [x] **SE-09** (! · U) `backendUrl`: `https://host/path/` is normalized to `https://host/path`; `http://…`, an empty string,
  a query, a fragment or credentials are invalid. A missing or invalid `backendUrl` makes machine authentication fail
  closed (see MC-20) — 3.2
- [x] **SE-07** (S · U) The settings category is empty or holds several values → `misconfigured` — 3.2

## 5. ChurchTools client (`ChurchToolsClient`, spec 5.6)

- [x] **CC-01** (N · U) URLs: base `…/api` and `…/api/` both lead to `…/api/custommodules/…`; `/api` is never dropped —
  5.6.4
- [x] **CC-02** (N · U) User calls send `Authorization: Bearer …`, service calls `Authorization: Login …`; both send
  `X-OnlyAuthenticated: 1` — 5.6.2
- [x] **CC-03** (N · U) The `data` envelope is unwrapped — 5.6.8
- [x] **CC-13** (S · U) Counterpart of CC-03: a `200` without `data`, with `data: null`, with the wrong type (object
  instead of list) or with HTML instead of JSON → `upstream-invalid`, never treated as "empty" — 5.6.6, 5.6.8
- [x] **CC-04** (N · U) Error mapping per status (`401`/`403` user and service, `404`, `429` with and without
  `Retry-After`, `500`, `503`, timeout, connection error, non-JSON body) gives the right exception type — 5.6.6
- [x] **CC-05** (! · U) `401`/`403` on a **service** call maps to `misconfigured`, never to "user not authorized" —
  5.6.6
- [x] **CC-06** (! · U) No exception message and no log entry of the client contains a token, password, code or
  secret, including on errors — 5.6.2
- [x] **CC-07** (N · U) No cookies are stored or sent between calls — 5.6.3
- [x] **CC-12** (! · U) Credentials are never mixed up: a user's bearer token is never sent on KV calls, the service
  token never on user calls, and neither goes to a host other than the configured instance (e.g. after a redirect) —
  5.6.2
- [x] **CC-08** (E · U) The timeout from the configuration is applied (connect and total) — 5.6.5
- [x] **CC-09** (N · U) No automatic retry, including after `429` — 5.6.7
- [x] **CC-10** (N · C) `GET /custommodules/{key}` returns the module; categories and values have the assumed shape —
  5.6
- [ ] **CC-11** (! · C) An anonymous call with `X-OnlyAuthenticated: 1` gets `401`, not empty data — 5.6.2
- [x] **CC-15** (! · U) TLS verification is never disabled and redirects aren't followed: a `302` from ChurchTools isn't
  followed (no credentials go to the redirect target); a self-signed certificate is rejected (checked against a local
  HTTPS test server, or in the contract layer) — 5.6.6
- [x] **CC-16** (E · U) `Retry-After` parsing: seconds (`120`), an HTTP date, a missing header and garbage (`soon`) give
  120, the date's offset, 60 and 60 respectively, never less than 60 — 5.6.7
- [x] **CC-17** (N · U) Guzzle `personStatus()`: `404` → `Gone`, `isArchived` `true`/`false` → `Archived`/`Active`; a
  missing or non-boolean `isArchived` (`"false"`, `0`) → `upstream-invalid`; `403` → `ServiceCredentialRejectedException`,
  never `Gone` — cleanup design 3.1
- [x] **CC-18** (N · U) Guzzle `activePersonIds()`: sends `GET …/api/persons?ids[]=7&ids[]=8&limit=2`; a returned
  archived person (or one without a boolean flag) is left out; a truncated answer (`total` 3, two returned), a missing
  `total` and an unasked ID → `upstream-invalid`; 101 IDs → `\InvalidArgumentException`; an empty list → `[]` without
  a call; `personDepartmentIds()` reads `data.departments[].id` and rejects non-integer IDs — cleanup design 3.1
- [x] **CC-19** (! · U) `ServiceUserPersonsRight`: granted gives `[]`; each of `view`, `view archive`,
  `view hidden persons` and a department in `view alldata` missing on its own gives its exact text; `"true"`, `1`, `null`
  or an absent key count as missing, as does a `view alldata` that isn't a list of integers — cleanup design 9.1
- [ ] **CC-14** (N · C) Counterpart of CC-10: an invalid service token gets `401`, and a missing permission `403`, as the
  error mapping assumes — 5.6.6

## 6. Authentication

### Backend access tokens (`UserTokens`, `TokenRules`, spec 4.4, 5.5)

- [x] **TK-01** (N · U) An issued token validates and yields the person ID — 4.4
- [x] **TK-02** (N · U) Claims: `iss`, `aud` = `ctpassstore-api`, `sub` (string), `iat`, `nbf`, `exp` = `iat` + 900,
  unique `jti` — 4.4
- [x] **TK-03** (! · U) `alg: none` (with and without a signature) is rejected — 4.4
- [x] **TK-04** (! · U) A token signed with a different secret is rejected — 4.4
- [x] **TK-05** (! · U) Changing any claim (e.g. `sub` to another ID) without re-signing is rejected — 4.4
- [x] **TK-06** (! · U) Wrong `aud`, wrong `iss` → rejected — 4.4
- [x] **TK-07** (E · U) `exp` 29 s ago → valid; 31 s ago → `token-expired` (30 s clock skew) — 4.4
- [x] **TK-08** (E · U) `nbf` 29 s ahead → valid; 31 s ahead → rejected — 4.4
- [x] **TK-09** (! · U) Algorithm confusion: an HS256 token with a `kid`, an EdDSA token without a `kid`, an RS256 token
  → rejected — 4.3.3
- [x] **TK-10** (! · U) A ChurchTools OAuth access token sent directly to the backend is rejected — 4.3
- [x] **TK-11** (S · U) Garbage in the header (not three parts, broken base64, broken JSON, very long) → `invalid-token`
  without a PHP error — 4.3.2
- [x] **TK-12** (! · U) After `JWT_SECRET` changes, all old tokens are rejected — 6.3
- [x] **TK-13** (! · U) Counterparts of TK-01/02: a token missing `exp`, `sub`, `aud`, `iss`, `jti` or `username`, or
  with an empty `sub`, is rejected — 4.4
- [x] **TK-14** (! · A) `iss` is the constant `ctpassstore-backend`: a manipulated `Host` or `X-Forwarded-Host` header
  changes neither the `iss` of issued tokens nor what validation accepts — 4.4
- [x] **TK-15** (! · U) Order of validation: a token with a bad signature **and** an expired `exp` gives `invalid-token`,
  not `token-expired` (no information without a valid signature) — 4.3.3
- [x] **TK-16** (! · U) Header parameters `jwk`, `jku`, `x5u`, `x5c` are ignored; a token with `crit` is rejected — 4.3.3

### Login (`POST /v1/auth/token`, spec 4.4)

- [x] **AX-01** (N · A) Valid code → `200` with `accessToken`, `tokenType: Bearer`, `expiresIn: 900` — 4.4
- [x] **AX-02** (N · A) The code exchange sends client ID, secret, `redirect_uri` and `code_verifier` — 4.4.2
- [x] **AX-03** (! · A) `redirectUri` outside the ChurchTools instance → `400 invalid-body`, without calling ChurchTools.
  The check compares the **parsed** scheme, host and port, not a string prefix. All of these are rejected:
  `https://<instance>.evil.com/…`, `https://<instance>@evil.com/…`, `http://<instance>/…`, `https://<instance>:444/…`,
  `//evil.com`, `javascript:…`, URLs with a backslash or encoded characters in the host — 4.4.1
- [x] **AX-04** (N · A) ChurchTools rejects the code → `400 oauth-code-invalid` — 4.4.2
- [x] **AX-05** (! · A) ChurchTools rejects client ID or secret → `500 misconfigured` — 4.4.2
- [x] **AX-06** (! · A) ChurchTools token without the `api` scope, or with a foreign `aud` → `502 upstream-invalid`, no
  token issued — 4.4.3
- [x] **AX-07** (! · A) `whoami` returns a different person than the token's `sub` → `502 upstream-invalid`, no token
  issued — 4.4.4
- [x] **AX-08** (! · A) No `view` permission → `403 no-service-access`, no token issued — 4.4.4
- [x] **AX-09** (! · A) The ChurchTools access and refresh tokens appear in neither the response nor the log — 4.4.5
- [x] **AX-10** (S · A) Missing fields, empty strings or wrong types → `400 invalid-body` — 4.4
- [x] **AX-10a** (E · A) Field length boundary: `code`, `codeVerifier` and `redirectUri` with 2,048 characters are
  accepted; with 2,049 → `400 invalid-body` — 4.4
- [x] **AX-11** (N · A) ChurchTools unreachable during the exchange → `502 upstream-unavailable` — 4.4
- [ ] **AX-12** (N · C) Contract: an invalid or used code gives the error response the backend expects — 4.4.2
- [x] **AX-20** (! · U, C) An unknown client ID: ChurchTools answers its own `404 error.notfound`, not an OAuth error
  (measured 2026-11-10); the client maps it to "client rejected", so the login gives `500 misconfigured`, never
  `not-found` or `oauth-code-invalid`. The contract case runs against the fake and the real instance — 4.4.2
- [x] **AX-14** (! · A) `whoami` returns the anonymous person (`-1` or `0`) or a non-integer ID → `502 upstream-invalid`,
  no token issued — 4.4.4
- [x] **AX-19** (! · A) `whoami` without `cmsUserId`, or with an empty one → `502 upstream-invalid`, no token issued (the
  primary password check would otherwise have no username) — 4.4.4
- [x] **AX-15** (! · A) `permissions/global` without a `ctpassstore` key, or with `view` as `"true"`, `1`, `null` or a
  list → `403 no-service-access` (fail closed) — 4.4.4
- [x] **AX-16** (N · A) `sub` `"5"` (string) and `whoami` `5` (number) match; `sub` `"05"`, `"5a"` or `5.5` don't — 4.4.3–4
- [x] **AX-17** (N · A) The issued token's `username` claim equals the `cmsUserId` from `whoami` — 4.4.4
- [x] **AX-18** (! · A) `scopes` as a string (`"api"`, `"apix"`), or as an array without the exact element `api`
  (`["apix"]`, `["API"]`) → no token issued — 4.4.3
- [x] **AX-13** (! · A) Counterparts of AX-01: a wrong `codeVerifier` (PKCE), a code for another client, or the same code
  twice → no token issued (`400 oauth-code-invalid`). A missing `codeVerifier` is `400 invalid-body` before ChurchTools
  is called (AX-10) — 4.4.2

### Machine client tokens (spec 4.4a)

- [x] **MC-01** (N · U) A correctly signed token of a registered client validates and yields the client — 4.4a
- [x] **MC-02** (N · U) Each of a client's several keys is accepted (rotation) — 4.4a
- [x] **MC-14** (! · U) Counterpart of MC-02: after a key is removed from a client (the client stays registered), tokens
  signed with it are rejected once the settings cache has expired; the client's other keys keep working — 4.4a
- [x] **MC-15** (! · U) Counterparts of MC-01: a token missing `jti`, `exp`, `iat`, `aud` or `kid`, or a client without
  any permission → rejected or `403` — 4.4a
- [x] **MC-03** (! · U) A signature with an unregistered key, or with another client's key → rejected — 4.4a.2
- [x] **MC-04** (! · U) Unknown `kid` → rejected — 4.4a.1
- [x] **MC-05** (! · U) `iss` or `sub` different from `kid` → rejected — 4.4a.3
- [x] **MC-06** (! · U) Wrong `aud` (e.g. another backend's URL) → rejected — 4.4a.3
- [x] **MC-07** (E · U) Lifetime of exactly 300 s → valid; 301 s → rejected — 4.4a
- [x] **MC-08** (E · U) `iat` 29 s in the future → valid; 31 s → rejected. `exp` 29 s in the past → valid; 31 s in the
  past → `401 token-expired` (only with a valid signature, see TK-15) — 4.4a.3–4
- [x] **MC-16** (! · U) `exp` < `iat` and `exp` = `iat` (negative or zero lifetime) → rejected — 4.4a.3
- [x] **MC-09** (! · U) The same `jti` twice → the second request is rejected, even with a valid signature — 4.4a.5
- [x] **MC-17** (! · U) A `jti` is recorded only after the token was fully verified: an invalid token (bad signature,
  wrong `aud`, expired) with a `jti` doesn't block a later valid token with the same `jti`. The cache is keyed by
  (`kid`, `jti`): two clients may use the same `jti` — 4.4a.5
- [x] **MC-18** (! · U) Keys embedded in the token header (`jwk` with the attacker's key, `jku`, `x5u`, `x5c`) are never
  used: a token signed with an embedded key is rejected — 4.4a.2
- [x] **MC-19** (! · U) The replay cache can't be read or written → machine requests are rejected (`500 misconfigured`),
  never accepted — 4.4a.5
- [x] **MC-21** (! · U) A token of a **disabled** client (its settings entry is invalid, e.g. an empty `publicKeys` list)
  is rejected at runtime like an unknown client, even when signed with a key that was valid before — 4.4a.1
- [x] **MC-23** (! · U) Two clients with the same public key are both disabled and logged; the same key listed twice
  within one client is fine — 3.2
- [x] **MC-22** (E · U) `aud` normalization: with `backendUrl` `https://host/path`, a token `aud` of `https://host/path`
  and `https://host/path/` match; `http://host/path`, `https://host/Path`, `https://host:8443/path`,
  `https://host/path/x` and `https://host` don't — 4.4a.3
- [x] **MC-20** (! · U) `settings.backendUrl` missing or invalid → machine requests get `500 misconfigured`; a token with
  `aud: ""` never matches. Users and admins keep working in both cases (an invalid URL like `http://…` must not break
  the settings for everyone) — 4.4a.3, 3.2
- [x] **MC-10** (S · U) Two different `jti`s within the same second → both accepted — 4.4a.4
- [x] **MC-11** (! · U) A client removed from the settings is rejected once the settings cache has expired — 4.4a
- [x] **MC-12** (! · U) A token with `alg` `HS256` and a client `kid`, signed with the client's public key as HMAC
  secret → rejected (key confusion) — 4.3.3
- [x] **MC-13** (N · C) A token signed with Node.js (as in ct-radius) is accepted by the PHP backend — 4.4a

### Primary password check (spec 4.6, 5.5, 6.3)

- [x] **PP-01** (N · A) Correct primary password → change allowed — 4.6.2
- [x] **PP-02** (N · A) Missing or empty → `400 primary-password-required` — 4.6.2
- [x] **PP-03** (N · A) Wrong → `403 invalid-primary-password` — 4.6.2
- [x] **PP-04** (! · A) An admin changing someone else's entry is checked against **their own** password, not the
  target's — 4.6.2
- [x] **PP-05** (! · A) ChurchTools unreachable → `502`, **not** "wrong password" and **not** "allowed" — 5.5.3
- [x] **PP-06** (! · A) 4 wrong attempts don't block; after the 5th wrong attempt within 15 minutes, the next attempt
  gets `429 too-many-attempts` with `Retry-After`, even with the correct password, and ChurchTools isn't called — 6.3
- [x] **PP-13** (E · A) The block lifts 15 minutes after the 5th failure; a correct password before the 5th failure
  resets the counter — 6.3
- [x] **PP-18** (E · A) Sliding window: 5 failures spread over more than 15 minutes (e.g. one every 4 minutes) don't block
  — 6.3
- [x] **PP-19** (! · A) Attempts during a block don't extend it: the block still ends 15 minutes after the 5th failure,
  and ChurchTools isn't called during the block — 6.3
- [x] **PP-20** (N · A) `Retry-After` and `retryAfter` give the remaining seconds of the block (checked at two moments
  with a controllable clock) — 6.3, 4.9
- [x] **PP-14** (! · A) Failures count against the **caller**: an admin's wrong attempts on other people's entries block
  the admin, not the target person — 4.6.2, 6.3
- [x] **PP-15** (! · A) ChurchTools outages (timeout, `5xx`) during the check don't count as failures — 5.5.3, 6.3
- [x] **PP-15a** (! · A) Counterpart: attempts that ChurchTools answers with `429` or an unexpected answer **do** count;
  after 5 of them the next attempt gets `429 too-many-attempts` without calling ChurchTools — 5.5.3, 6.3
- [x] **PP-21** (! · A) A `200` from `/api/login` with an unknown `status` is `502 upstream-invalid`, never a correct
  password; nothing is written — 5.5.3
- [x] **PP-22** (N · A) Log entries of the check name the person ID, never the username — 6.4
- [x] **PP-16** (N · A) The limit also applies to `DELETE`, sharing the counter with `PUT` — 4.7, 6.3
- [x] **PP-07** (E · A) The limit is per person: person B isn't blocked by person A's failures — 6.3
- [x] **PP-08** (! · A) The primary password appears in no response, problem detail or log entry — 6.3
- [x] **PP-09** (N · A) `requirePasswordForPasswordChange = false` → no check, ChurchTools isn't called — 4.6.2
- [x] **PP-12** (! · A) The request can't choose whose password is checked: a `username` or `personId` field in the body
  is rejected (`400 invalid-body`); the username always comes from the token's `username` claim. The correct password
  of **another** user is rejected — 4.6.2, 5.5.3
- [x] **PP-17** (! · A) ChurchTools answers `200` but with a person ID different from the token's `sub` (e.g. a
  reassigned username) → counts as a wrong password, logged as `warning` — 5.5.3
- [x] **PP-10** (N · C) Contract: correct and wrong passwords give the status codes the backend expects from
  `POST /api/login` — 5.5.3
- [x] **PP-11** (N · A) Two-factor users (Q13): ChurchTools answers `200` with `status` `totp` or `twoFactorSetup` and the
  caller's person ID → the primary password counts as correct; a wrong password (`400`) still fails — 5.5.3
- [ ] **PP-11a** (N · C) Contract: for a test user with two-factor authentication, `POST /api/login` with the correct
  password answers `200` with `status: "totp"` and the person ID, and with a wrong password `400` — 5.5.3

## 7. Authorization (spec 4.3)

- [x] **AZ-01** (! · A) The complete matrix: every caller (user, admin, machine client with `entries:read`, machine
  client without permissions) × every operation (GET, PUT, DELETE) × own/other entry gives exactly the expected `2xx`
  or `403` — 4.3.4
- [x] **AZ-02** (! · A) A user can't read, change or delete another person's entry by varying the ID: `07`, `7.0`, `+7`
  give `400 invalid-id`, never access to person 7 — 4.3.4, 4.1
- [x] **AZ-11** (! · A) No existence oracle: a user asking for another person's entry gets the same `403` whether or not
  that entry exists, and the store isn't queried (the fake records no read) — 4.1 (order of checks)
- [x] **AZ-12** (! · A) Principal confusion: a machine client with `id` `123` isn't person 123 (no "own" entry, no
  write on entry 123). A user token with `sub` `123` gets none of client `123`'s permissions — 4.3
- [x] **AZ-03** (! · A) A machine client can't write or delete, even with `entries:read` — 4.3.4
- [x] **AZ-04** (! · A) Removing a person from `adminUsers` takes away admin rights once the settings cache has expired,
  even with a still-valid token — 4.3
- [x] **AZ-05** (N · A) Adding a person to `adminUsers` grants the rights without a new login — 4.3
- [x] **AZ-06a** (N · A) Requests rejected before authentication (missing token, unknown route, wrong method) make no
  ChurchTools call at all. (Regression: the public key used to be loaded on every request.) — 4.1, 6.1
- [x] **AZ-06** (N · A) Authenticated requests make **no** ChurchTools calls for authentication (counted on the fake) —
  4.3
- [x] **AZ-07** (! · A) A `403` causes no write at all (the fake records no write calls) — 4.1
- [x] **AZ-08** (N · A) Missing header → `401 missing-token`; wrong scheme (`Login …`, `Basic …`) → `401 invalid-token`
  — 4.3.1–2
- [x] **AZ-09** (N · A) Expired user token → `401 token-expired` — 4.3.3
- [ ] **AZ-10** (! · A) Every protected endpoint requires a token; only `POST /v1/auth/token` and `OPTIONS` work without
  one. `/v1/test` additionally requires an admin; users and machine clients get `403` — 4.1, 4.8
- [x] **PR-01** (N · A) Order of checks (4.1): unknown route without a token → `404`; wrong method without a token →
  `405`; `GET /v1/entries/abc` without a token → `401`; `GET /v1/entries/abc` with a token → `400`; another person's
  entry with an invalid body → `400`, with a valid body → `403` — 4.1

## 8. Endpoints and input (spec 4.1, 4.5–4.7)

### General

- [x] **IN-01** (N · A) `{id}` = `1` and a large valid integer are accepted — 4.1
- [x] **IN-02** (! · A) `{id}` = `0`, `-1`, `+1`, `01`, `1.5`, `1e3`, `abc`, `" 1"`, `0x1`, a number above `PHP_INT_MAX`,
  empty → `400 invalid-id`, without calling ChurchTools — 4.1
- [x] **IN-03** (N · A) An empty body or `{}` is accepted where all fields are optional — 4.1
- [x] **IN-04** (S · A) Body `[]`, `"text"`, `42`, `null`, invalid JSON → `400 invalid-body` — 4.1
- [x] **IN-05** (S · A) Fields with the wrong type (`secondaryPwd: 123`, `primaryPwd: []`) → `400 invalid-body`, not a
  PHP type error — 4.1
- [x] **IN-09** (N · A) The old paths without `/v1/` (`/entries/1`, `/auth/token`, `/test`) answer `404 not-found` — 4.1
- [x] **IN-06** (E · A) Body size limit: exactly 16 KB is accepted (if otherwise valid); 16 KB + 1 byte → `413
  payload-too-large` — 4.1
- [x] **IN-07** (N · A) Unknown route → `404 not-found`; wrong method on a known route → `405` with an `Allow` header —
  4.1
- [x] **IN-08** (! · A) No error response causes a write to ChurchTools — 4.1

### `GET /v1/entries/{id}` (4.5)

- [x] **EG-01** (N · A) Existing entry → `200` with `secondaryPwd` (ciphertext) — 4.5
- [x] **EG-02** (N · A) No entry → `404 entry-not-found` — 4.5
- [x] **EG-03** (! · A) The response never contains plaintext, only the stored ciphertext — 4.5
- [x] **EG-04** (S · A) Duplicates → `200` with the newest — 4.5
- [x] **EG-05** (! · A) A machine client reads a deleted or archived person → `404 person-not-found` with detail `Person {id} doesn't exist in ChurchTools or is archived.`, no entry returned — cleanup design 3.6
- [x] **EG-06** (N · A) Own entry: no lookup in ChurchTools — cleanup design 3.6
- [x] **EG-07** (! · A) Unauthorized caller → `403` (never "gone"), no lookup — cleanup design 3.6
- [x] **EG-08** (S · A) Repeated reads of an active person within 600 s make one lookup — cleanup design 3.6

### `PUT /v1/entries/{id}` (4.6)

- [x] **EP-01** (N · A) Without `secondaryPwd` → `200` with a generated password that passes the policy; exactly that
  password was stored (decrypted with the test key) — 4.6
- [x] **EP-02** (N · A) Valid custom password, custom passwords allowed → `204`, empty body, stored encrypted — 4.6
- [x] **EP-03** (N · A) Custom password while not allowed → `400 custom-password-not-allowed`, nothing stored — 4.6.3
- [x] **EP-04** (S · A) `secondaryPwd: ""` counts as a custom password (→ `400`), not as "generate" — 4.6.3
- [x] **EP-05** (N · A) Invalid custom password → `400 password-invalid` with `violations` — 4.6.3
- [x] **EP-06** (! · A) The generated password is returned with `Cache-Control: no-store` — 4.1
- [x] **EP-07** (N · A) Setting the same password again works — 4.6
- [x] **EP-08** (N · A) Afterwards exactly one entry exists, also when duplicates existed before — 4.6
- [x] **EP-09** (N · A) Order of the checks: authorization before the primary password, the primary password before
  the custom password check — 4.6
- [x] **EP-10** (! · A) Two generated passwords for the same person differ, and the old one is no longer stored after
  the second `PUT` — 4.6
- [x] **EP-12** (! · A) Partial failure: encryption or the write fails → error response, the previous entry is unchanged,
  and the generated plaintext isn't returned — 4.6.5
- [x] **EP-13** (S · A) Healing partial failure: the update succeeds but deleting a duplicate fails → success, the new
  password is the one read afterwards, and a `warning` is logged — 4.6.5
- [x] **EP-11** (N · A) Counterparts of EP-02 for each violation of the policy (PV-03a, PV-05, PV-13–16): each gives
  `400 password-invalid` with the matching `violations`, and nothing is stored — 4.6.3
- [x] **EP-14** (! · A) An admin changes a deleted person → `404 person-not-found`, nothing stored — cleanup design 3.6
- [x] **EP-15** (! · A) The same for an archived person — cleanup design 3.6
- [x] **EP-16** (N · A) Own entry: no lookup — cleanup design 3.6
- [x] **EP-17** (! · A) Unauthorized caller or wrong primary password → `403`, no lookup — cleanup design 3.6
- [x] **EP-18** (! · A) The lookup fails → `502`/`503`, nothing stored — cleanup design 3.6
- [x] **EP-19** (N · A) An admin changes an active other person → stored — cleanup design 3.6

### `DELETE /v1/entries/{id}` (4.7)

- [x] **ED-01** (N · A) Existing entry → `204`, entry gone — 4.7
- [x] **ED-02** (E · A) No entry → `204` (idempotent) — 4.7
- [x] **ED-03** (S · A) Duplicates → all deleted — 4.7
- [x] **ED-04** (N · A) With `requirePasswordForPasswordChange`: correct primary password → `204`; missing or empty →
  `400 primary-password-required`; wrong → `403 invalid-primary-password`; nothing deleted in the error cases — 4.7
- [x] **ED-05** (! · A) Counterpart of ED-01: deleting person 7 leaves every other entry untouched — 4.7

### `GET /v1/test` (4.8)

- [x] **TS-01** (N · A) Everything in order → `200`, every check `ok`, version included — 4.8
- [x] **TS-02** (N · A) Each check fails on its own → `207` with exactly that check `fail`:
  - `credentials.php` readable by others; `logs/` not writable
  - cache folder not writable by PHP, or writable by others
  - settings invalid; `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET` or `JWT_SECRET` missing or `JWT_SECRET` too short
  - public key unusable; `passwordStore` not readable
  - a disabled machine client, an empty key list or unknown permissions; each reported **by client name and value**
  — 4.8
- [x] **TS-03** (! · A) Service user with `administer settings`, `administer persons` or `administer custom modules`, or
  with write access beyond `passwordStore` → that check `fail` — 4.8
- [x] **TS-04** (! · A) The response contains no secrets, no file paths outside the project and no other users' data
  — 4.8
- [x] **TS-05** (N · A) Admin → `200`/`207`; normal user and machine client → `403 forbidden` — 4.8
- [x] **TS-06** (! · A) `?write=1`: the test value uses the reserved `personId` `0`, is found again by the self-test's
  read step, is deleted again even when a step in between fails, and never touches a real person's entry. Without
  `?write=1` nothing is written — 4.8, 5.3.11
- [x] **TS-07** (S · A) A test value left over from an earlier run (e.g. after a timeout) is removed by the next
  `?write=1` run, and until then disturbs neither reads nor writes for persons (with ST-22) — 4.8, 5.3.11
- [x] **TS-08** (! · A) Service user without the persons right → "Service user rights" `fail`, message lists the missing
  parts (also a department without `view alldata`); together with administrative rights both are in one message; a
  failure to read the departments fails the check — cleanup design 3.7
- [x] **TS-09** (N · A) A gone (archived or unknown) admin in `adminUsers` → "Admin users" `fail` naming person IDs
  only, singular and plural wording; all active → `ok` — cleanup design 3.7
- [x] **TS-10** (E · A) The admin lookup fails → "Admin users" `fail` with a generic message, no exception detail in
  the response, the class in the log — cleanup design 3.7
- [x] **TS-11** (! · A) "Web cron token": absent → `ok` (off); shorter than 43 → `fail`, token not printed; usable →
  `ok` (on) — cleanup design 3.7, 5.1

## 9. Error format (spec 4.9)

- [x] **ER-01** (N · A) Every error response has `Content-Type: application/problem+json` and `type`, `title`,
  `status` (equal to the HTTP status) and `detail` — 4.9
- [x] **ER-02** (N · A) Every problem type in the table of 4.9 is produced by at least one API test with the right
  status (this test fails when a type is added without a test) — 4.9
- [x] **ER-03** (N · U) Every `type` URI has a section in `backend/docs/problems.md`, and the `title` the code produces
  for each type is fixed and equals the title documented there (the test parses the file) — 4.9
- [x] **ER-04** (! · A) An unexpected exception → `500 internal-error` with a generic `detail`; class names, stack
  traces, SQL or paths never reach the client — 4.9
- [x] **ER-05** (! · A) `misconfigured` names the setting or key, never its value — 4.9
- [x] **ER-06** (N · A) `upstream-rate-limited` and `too-many-attempts` carry a `Retry-After` header (at least 60 for
  `upstream-rate-limited`) and the same value as the `retryAfter` member — 4.9, 6.2
- [x] **ER-08** (! · A) PHP warnings, notices and deprecations never reach a response body (`display_errors` off); they
  go to the log — 4.1
- [x] **ER-09** (N · A) The new problem types `payload-too-large` (413) and `unsupported-media-type` (415) are produced
  as specified — 4.9
- [x] **ER-07** (N · A) Counterpart of ER-01: successful responses (`200`, `204`) are plain JSON or empty, never
  `application/problem+json` — 4.1

## 10. HTTP behavior (spec 4.1, 4.2)

- [x] **HT-01** (N · A) Allowed origin → `Access-Control-Allow-Origin` with exactly that origin — 4.2
- [x] **HT-02** (! · A) A foreign origin, `null` or a lookalike (`https://instance.church.tools.evil.com`) → no CORS
  headers — 4.2
- [x] **HT-03** (N · A) Preflight `OPTIONS` from an allowed origin works without a token: status `204`,
  `Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS`, `Access-Control-Max-Age: 600` — 4.2
- [x] **HT-04** (! · A) Every response, including errors and `204`, carries `Cache-Control: no-store` and
  `X-Content-Type-Options: nosniff` — 4.1
- [x] **HT-05** (! · A) Plain HTTP is rejected with `400` when it's detectable at the PHP level — 4.1
- [x] **HT-06** (! · A) Origins are compared exactly: the allowed origin with another scheme (`http://`), another port,
  a trailing slash, a path or a subdomain gets no CORS headers — 4.2
- [x] **HT-08** (N · A) For allowed origins: `Access-Control-Allow-Headers` contains `Authorization` and `Content-Type`;
  `Access-Control-Allow-Credentials` is **not** set; `Access-Control-Allow-Origin` is never `*` — 4.2
- [x] **HT-09** (N · A) `Vary: Origin` is present on every response — 4.2
- [x] **HT-10** (! · A) Error responses (`400`, `401`, `403`, `404`, `500`) to an allowed origin carry the same CORS
  headers as successful ones, so the extension can read the problem details — 4.2
- [x] **HT-07** (! · A) Counterparts of HT-03: a preflight from a foreign origin gets no `Access-Control-Allow-*`
  headers, and a preflight never runs the endpoint's logic — 4.2

## 11. Logging (spec 6.4)

- [x] **LG-01** (! · A) For each endpoint, success and error: the log contains **no** password (primary, secondary,
  generated), token, authorization code, client secret, `JWT_SECRET` or ciphertext. The test runs all API tests with a
  capturing logger and searches for the known secret values. — 6.3, 6.4
- [x] **LG-02** (N · A) Denied access is logged as `warning` with person ID and IP address — 6.4
- [x] **LG-03** (N · A) Logins, changes and deletions are logged as `info` — 6.4
- [x] **LG-04** (N · U) The log level from the configuration is applied — 6.4
- [x] **LG-05** (N · U) An invalid `LOG_LEVEL` (`verbose`, `INFO `, empty) → `misconfigured` — 3.1
- [x] **LG-06** (N · U) Logs rotate daily and keep 14 files; older files are deleted — 6.4
- [x] **LG-07** (N · U) Every `error` entry carries the backend version in its context — 6.4

## 12. Cache (spec 6.1)

- [x] **CA-01** (N · U) Settings are loaded from ChurchTools only once within the TTL — 6.1
- [x] **CA-02** (E · U) After the TTL they're loaded again — 6.1
- [x] **CA-03** (! · U) `passwordStore` values are never cached: a read right after a write sees the new value — 6.1
- [x] **CA-04** (! · U) Cache files contain no secrets, and the cache folder isn't inside `public/` — 6.1
- [x] **CA-05** (S · U) A corrupt or unwritable **settings or ID** cache leads to loading from ChurchTools, not to an
  error response — 6.1
- [x] **CA-07** (! · U) The security-relevant stores fail closed: an unwritable `jti` cache rejects machine requests
  (MC-19); unwritable rate-limit counters reject primary-password checks (`500 misconfigured`), never skip the limit —
  6.1
- [x] **CA-08** (! · U) Tampering with the settings cache: an entry with the current key identifier but a missing or
  wrong HMAC (e.g. another webspace user wrote `adminUsers: [99]`) isn't trusted, is reloaded from ChurchTools, and an
  `error` is logged. Cache files are created with mode `600` and the folder with `700` — 6.1
- [x] **CA-10** (! · U) Tampering with a security store: a `jti` cache or rate-limit file with the current key identifier
  but a wrong or missing HMAC → the affected requests are rejected (`500 misconfigured`), never treated as "not seen"
  or "no failures" — 6.1
- [x] **CA-11** (! · U) Rotation of `JWT_SECRET`: cache files with the old key identifier aren't trusted. The settings and
  ID cache is reloaded from ChurchTools; the security stores are cleared and start over (no `500`) — 6.1
- [x] **CA-09** (! · U) The cache format is JSON: a cache file containing a serialized PHP object is never
  unserialized — 6.1
- [x] **CA-06** (! · U) The `jti` replay cache survives across requests (file-based) and forgets entries after their
  `exp` — 4.4a.4

## 13. Attack scenarios and robustness

Typical attacks and error classes across all endpoints. Most of them have no single spec rule; they make sure the
general rules of spec 4.1, 4.3 and 6.3 hold under hostile input.

### Encoding

- [x] **EC-01** (! · A) A body that isn't valid UTF-8 (lone continuation bytes, overlong encodings such as `C0 AF`,
  surrogate halves) → `400 invalid-body`, no PHP warning — 4.1
- [x] **EC-02** (S · A) A body with a UTF-8 BOM or in UTF-16 → `400 invalid-body`;
  `Content-Type: application/json; charset=latin1` → `415`; `application/json; charset=utf-8` is accepted — 4.1
- [x] **EC-03** (! · U) A custom password in decomposed Unicode (`e` + combining accent) or with invisible characters
  (zero-width space, soft hyphen, BOM, right-to-left mark) is rejected — 5.1.1
- [x] **EC-04** (! · A) Path encoding: `/v1/entries/%37` (= 7), `/v1/entries/7%00`, `/v1/entries/%2537` (double
  encoded), `/v1/entries/7%2F..%2Ftest`, `/v1/entries/7/`, `/v1/Entries/7`, `/v1/entries//7` either address exactly person
  7 or give `400`/`404`. None of them reaches another person or another endpoint — 4.1
- [x] **EC-05** (! · A) Path traversal: `/v1/entries/../test`, `/v1/entries/..%2Ftest`, `/../config/credentials.php` never
  reach anything but a defined route (and never a file) — 6.3

### Types and type juggling

- [x] **TY-01** (! · A) Duplicate JSON keys (`{"secondaryPwd": "a", "secondaryPwd": "b"}`) → `400 invalid-body`, so the
  value that's validated can never differ from the one that's stored — 4.1
- [x] **TY-02** (! · A) Mass assignment: extra fields in the body (`personId`, `id`, `dataCategoryId`, `role`, `isAdmin`,
  `username`) → `400 invalid-body`. The stored value contains exactly `personId` (from the path) and `secondaryPwd` — 4.1,
  5.3
- [x] **TY-03** (S · A) JSON numbers where strings are expected, and vice versa (`"primaryPwd": 123456`,
  `"secondaryPwd": true`, `"code": ["x"]`) → `400 invalid-body`, never cast silently — 4.1
- [x] **TY-04** (! · U) Claim types in backend and machine tokens: `exp`/`iat`/`nbf` as strings, floats, negative or huge
  numbers; `sub` as a number; `aud` as an array; `kid` as a number, an array or empty → rejected or handled exactly as
  specified, never cast in a way that extends validity or changes the identity — 4.4, 4.4a
- [x] **TY-05** (! · U) ChurchTools token claim types during login: `scopes` as a string instead of an array (`"apix"`
  must not count as containing `api`), `sub` as a number, `aud` as an array → no token issued unless they exactly match
  — 4.4.3
- [x] **TY-06** (! · U) Machine client `id`s and `kid`s with lookalike characters (`ct-rаdius` with a Cyrillic `а`),
  uppercase, spaces or Unicode are rejected by the `^[a-z0-9-]{3,40}$` rule, so they can't impersonate a registered
  client — 3.2

### Injection

- [x] **IJ-01** (! · U) No user input ends up in a ChurchTools URL unvalidated: the person ID is an integer, the module
  key a constant, the OAuth `code` goes only into the form body. A `code` with `&`, `=`, `#` or newlines can't add
  parameters to the token request — 5.6
- [x] **IJ-02** (! · U) Path traversal in cache file names: `kid`, `jti` and other cache keys with `../`, `/`, `\`, `%00`
  or very long values can't escape the cache folder (keys are hashed before they're used as file names) — 6.1, 4.4a.4
- [x] **IJ-03** (! · A) Log injection: values that end up in the log (person IDs, `kid`, IP addresses, request path)
  containing newlines or control characters can't forge additional log lines — 6.4
- [x] **IJ-04** (! · A) No reflected content: input echoed in a problem `detail` (e.g. the unknown path
  `/v1/entries/<script>`) is JSON-encoded. Even with `Accept: text/html` the answer is `application/problem+json`, never
  an HTML error page (Slim's HTML error renderer had an XSS vulnerability) — 4.9
- [x] **IJ-05** (! · A) Header injection: an `Origin` or other header containing CR/LF is never reflected into a
  response header. A non-numeric `Retry-After` from ChurchTools is replaced by 60 — 4.2, 6.2
- [x] **IJ-06** (! · U) No dangerous functions in `src/`: `eval`, `unserialize`, `extract`, `assert` with strings,
  backticks, `exec`/`shell_exec`/`system`/`passthru`/`proc_open`, `include`/`require` with variable paths. Enforced by
  the PHPStan disallowed-calls rule set; a unit test checks that the rule set is active (a fixture file using `eval`
  makes PHPStan fail) — 6.6
- [x] **IJ-07** (! · A) `X-Forwarded-For`, `X-Real-IP` and `Forwarded` are not trusted: the logged IP address is always
  `REMOTE_ADDR` — 6.3, 6.4
- [x] **IJ-08** (! · A) `X-HTTP-Method-Override` and `_method` are ignored: a `POST`/`GET` can't be turned into a
  `PUT` or `DELETE` — 4.1

### Header and protocol edge cases

- [x] **HP-01** (N · A) The scheme is case-insensitive: `Bearer`, `bearer` and `BEARER` with a valid token are accepted
  — 4.3.2
- [x] **HP-01a** (! · A) Rejected with `401 invalid-token`: an empty token (`Bearer`, `Bearer `), whitespace or a tab
  inside the token, two `Authorization` headers, a comma-joined value (`Bearer a, Bearer b`), a scheme with a typo
  (`Bearer:`, `Bearers`) — 4.3.2
- [x] **HP-02** (S · A) `HEAD` and unexpected methods (`PATCH`, `TRACE`) → `405`, never a write — 4.1
- [x] **HP-03** (S · A) A non-empty body with a missing or wrong `Content-Type` (`text/plain`,
  `multipart/form-data`, `application/x-www-form-urlencoded`) → `415 unsupported-media-type`, never parsed as form
  data. An empty body needs no `Content-Type` — 4.1

### Resource exhaustion and overflows

- [x] **RX-01** (! · A) Nesting depth: 32 levels are accepted by the parser (then rejected only for unknown fields), 33
  → `400 invalid-body`; 8,000 levels (the most that fit into 16 KB; deeper bodies are `413` first) → `400 invalid-body`
  without exhausting memory or the stack — 4.1
- [x] **RX-02** (! · A) Huge passwords cost nothing: a body over 16 KB is `413` before parsing; within a body, a password
  over 128 characters is reported only as `too-long`, before any other rule runs or encryption starts — 4.1, 5.1.4
- [x] **RX-03** (! · U) A huge `passwordLength` in the settings (e.g. `1000000000`) is a configuration error before the
  generator allocates anything — 3.2
- [x] **RX-04** (! · U) Integer overflow: IDs, `exp` and counters above `PHP_INT_MAX` or as floats (`1e30`) never wrap
  around or turn into `0`/negative values that pass a check — 4.1, 4.4
- [x] **RX-06** (! · A) ChurchTools call budget for requests that aren't authenticated (plan 4.1a): a missing or forged
  token, a forged machine token with any `kid`, and `POST /v1/auth/token` beyond the per-IP limit cost no ChurchTools
  call (counted on the fake). Below the limit a login costs at most its 3 calls — 6.2
- [x] **RX-05** (S · U) The `jti` replay cache and the rate-limit counters stay bounded: expired entries are removed,
  and many distinct values can't fill the disk — 4.4a.4, 6.3
- [x] **RX-07** (S · A) A very long `Authorization` header or path (e.g. 64 KB) → `400`/`401`/`404`/`414` without a PHP error
  — 4.1

### Timing and races

- [x] **TR-01** (! · U) Secrets are compared in constant time: signatures through the JWT library; the store's HMAC
  and key identifier, and the login's `aud` check, with `hash_equals`. `strcmp` and similar are banned by the PHPStan rule set
  (BannedCallsTest), and a manipulated HMAC is rejected (SignedFileStoreTest). Constant time itself can't be proven by
  a test; it's part of the review checklist — 6.3, 6.6

  *Review note (not a test):* reviewers also confirm that no secret is compared with `==` or `===`. This is part of the
  pull request checklist in the plan (item 2.6).
- [x] **TR-02** (S · A) Two concurrent `PUT`s for the same person may create a duplicate, but the next read gives one
  of the two passwords and the next write heals it (with ST-05/06) — 5.3.6
- [x] **TR-02a** (S · A) Two concurrent `PUT`s on an existing entry leave one entry; the last write wins — 5.3.6
- [x] **TR-02b** (S · A) A `DELETE` between a `PUT`'s read and its update: the `PUT` still answers `204` and its
  password is stored in a new entry, not `500` — 5.3.6
- [x] **TR-02c** (S · A) Two concurrent `DELETE`s both answer `204` — 5.3.6
- [x] **TR-02d** (S · C) Parallel `PUT`s through the local backend against the test instance: all succeed, the read
  gives the newest entry, the next write leaves exactly one (LS-02) — 5.3.6
- [x] **TR-03** (S · U) Concurrent requests updating the rate-limit counter or the `jti` cache don't lose updates (file
  locking) — 6.3, 4.4a.4
- [x] **TR-05** (! · U) Parallel primary-password attempts can't run more checks than the limit: with 50 attempts in
  flight at once, at most 5 reach ChurchTools and the rest get `429`. An attempt that hits a ChurchTools error is
  withdrawn, including a block it caused; a correct one resets the counter — 6.3
- [x] **TR-04** (! · U) The same machine token sent twice in parallel is accepted at most once — 4.4a.4

## 14. Contract and smoke tests

The contract layer checks the assumptions that the design and the fake rely on; the smoke tests check the deployed
backend on a real host. Both run by hand before each release (spec 6.6).

**Tokens without a browser:** a user token normally needs the OAuth flow in a browser, and machine clients may neither
`PUT` nor `DELETE`. The smoke tests therefore mint user tokens with a test helper that signs them with the `JWT_SECRET`
from the `credentials.php` of the **test** deployment (same claims as 4.4, for a test person). Machine tokens are
signed with a test key registered for a test machine client. This is only possible for test systems whose secrets the
tester has; it's documented in `backend/docs/testing.md`.

### Deployment smoke tests (against the backend installed on a real web host)

- [ ] **SM-01** (! · C) The `Authorization` header reaches PHP: a request with a valid token succeeds. (The `SetEnvIf`
  rule in `public/.htaccess` is exactly what breaks on CGI/FPM hosts.) — 4.3
- [ ] **SM-02** (N · C) A `DELETE` with a JSON body (`primaryPwd`) arrives intact through the hosting stack — 4.7
- [ ] **SM-03** (! · C) Not reachable over HTTP: `/config/credentials.php`, `/logs/app.log`, `/vendor/`,
  `/composer.json`, `/composer.lock`, `/.git/`, `/src/`, `/tests/`, `/phpunit.xml`, `/.env`; no directory listing
  anywhere — 6.3
- [ ] **SM-04** (! · C) `http://` requests are redirected to `https://` (or rejected), never answered over plain HTTP — 4.1
- [ ] **SM-05** (N · C) A full round on the deployed backend: with a test token, `PUT` → `GET` → decrypt with the test
  key → `DELETE` → `GET` gives `404 entry-not-found` — 4.5–4.7

### Local backend against the test instance

- [x] **LS-01** (N · C) A full round through the locally started backend with the instance's real settings and key:
  `PUT` → `GET` (equals the stored ciphertext; decrypted if the private key is configured) → `DELETE` → `GET` gives
  `404`. Writes only one fixture user's entry, and only if that user had none — 4.5–4.7
- [x] **LS-02** (S · C) Parallel `PUT`s through the local backend, see TR-02d — 5.3.6

### Assumptions about ChurchTools (against the test instance)

- [x] **CT-01** (S · C) New KV values get higher value IDs than existing ones. "Highest = newest" (Q9) depends on it — 5.3.3
- [ ] **CT-02** (N · C) A successful OAuth code exchange gives a token as measured: RS256, `aud` = client ID, `scopes`
  an array containing `api`, `sub` = person ID. Part of the manual OAuth checklist (plan 3.6), because it needs a
  browser — 4.4.3
- [ ] **CT-03** (N · C) `whoami` and `permissions/global` with `Authorization: Bearer` and `X-OnlyAuthenticated: 1` work
  and have the shape the backend reads (`data.id`, `data.cmsUserId`, `data.ctpassstore.view` as a boolean) — 4.4.4
- [x] **CT-04** (N · C) The service user's `permissions/global` has the shape the rights check in `/v1/test` relies on
  (`churchcore` flags, `ctpassstore` category lists) — 4.8
- [ ] **CT-05** (E · C) The KV value limit is real: 10,000 characters are accepted, 10,001 rejected with the status the
  client maps — 5.3.8
- [x] **CT-06** (! · C) **The fake stays honest, real side:** the client contract cases (CC-10, CC-11, CC-14, ST-16,
  CT-01, CT-03–05, CT-09–11, PP-10, AX-12) are one shared test class, run against the real client — 6.6
- [x] **CT-06a** (! · U) **The fake stays honest, fake side:** the same shared test class runs against the fake in the
  unit layer, so the fake can't drift from real ChurchTools — 6.6
- [x] **CT-09** (N · C) Single person lookups as the service user: active → `Active`, archived → `Archived`, deleted
  and a never-used ID (`2147483647`) → `Gone` — cleanup design 3.1, 9.1
- [x] **CT-10** (N · C) The batch of the active, the archived, the deleted and an unused ID confirms exactly the active
  one; the instance's departments are listed as integers — cleanup design 3.1, 9.1
- [x] **CT-11** (! · C) The service user holds exactly the narrow persons right (`ServiceUserPersonsRight` finds
  nothing missing), and that suffices to see the archived person (`Archived`, not `403`) — cleanup design 9.1
- [x] **CT-08** (S · C) Updating a value that was deleted gives `404` and doesn't bring the value back. TR-02b relies on
  it — 5.3.6
- [x] **CT-07** (N · U) The contract suite run without its configuration aborts with a message naming what's missing
  and a non-zero exit code; it's never reported as passed (the test runs PHPUnit in a subprocess without the
  configuration) — 6.6

## 15. Deployment and build (spec 6.5, 6.6)

- [x] **DP-01** (! · U) The deploy check fails if the deploy folder contains a real `credentials.php`, `phpunit.xml`,
  fixtures, tests or an instance URL — 6.6
- [x] **DP-02** (N · U) The version string is `x.y.z`, `x.y.z+<sha>` or `x.y.z+<sha>-dirty` as appropriate — 6.5
- [x] **DP-03** (N · U) The release check fails if tag, version and dated CHANGELOG section disagree — 6.6

## 16. Migration of the existing end-to-end tests

Where the cases of the former `tests/EndToEnd` suite went, so nothing is lost silently. **Done in plan 3.6:** the old
tests are removed; the suite is now `tests/Contract`. Still open from this table: SM-05 (deployed backend, plan 4), CT-03 (manual OAuth checklist in `backend/docs/testing.md`).

| Today's test | What it checks | New cases | Note |
| --- | --- | --- | --- |
| `EntriesGeneralAccessTest::testInvalidAuthHeaderReturns401` | Missing or malformed header → `401`, nothing changed | AZ-08, HP-01a, IN-08 | Now against bearer tokens |
| `EntriesGeneralAccessTest::testInvalidTokenReturns401` | Invalid tokens from `invalid_tokens.json` → `401` | TK-03–05, TK-11, TK-13 | The fixture is replaced by generated invalid JWTs |
| `EntriesGeneralAccessTest::testUnauthorizedTokenReturns403` | Users without the extension's `view` right → `403` | AX-08, AX-15, CT-03 | The check moves to the login (4.4) |
| `EntriesGetTest::testNormalAccess` | `GET` matrix for normal, admin and read-access users, with other entries present | AZ-01, EG-01, ST-08a | Read-access users are dropped (Q23); machine clients take their place |
| `EntriesGetTest::testMissingEntry` | `GET` without entry → `404` (allowed) or `403` | EG-02, AZ-11 | `403` now also proves there's no existence oracle |
| `EntriesPut*Test::testNormalSetPwd` / `testNormalUpdatePwd` (4 setting combinations × length 12) | Set and update with and without custom passwords and primary password; the result decrypts correctly | EP-01–03, EP-07, PP-01–03, PP-09, ST-03, ST-04, EN-01 | Parametrized over the 4 combinations in the API layer; the real primary password check stays in PP-10 |
| `EntriesPutTestPrototype::checkUniqueUsers` | No duplicate entries after `PUT` | EP-08, ST-06 | |
| `EntriesPutTestPrototype::getAndCheckPwd` | The stored value decrypts to the set password | EP-01, EP-02, SM-05 | |
| `TestAccessTest::testAuthorizedUsersHaveAccess` | `/test` answers `200`/`207` with the result structure | TS-01, TS-05 | Behavior change: admins only (Q11) |
| `PersistenceChecker::assertUnchanged` (in every test) | Error responses don't change data | IN-08, AZ-07 | The fake records every write |
| Fixture `validPwds_12.json` | Valid custom passwords | PV-01–06 | Moved into unit test data |
| `sleep(1)` after every test | Avoid ChurchTools' rate limit | – | Dropped; only the few contract tests still need pauses |

## 18. Gone persons (design 3–5)

- [x] **GP-01** (N · U) `ChurchToolsPersonDirectory`: `exists()` is true for an active person, false for an archived
  and an unknown one; a `RateLimitedException` propagates; `confirmedActive()` of 250 IDs makes 3 batch calls (100,
  100, 50); `assertReadable()` passes with the persons right and throws `PersonsNotReadableException` naming the
  missing parts without it — cleanup design 3.2
- [x] **GP-02** (! · U) `GonePersons::find()`: persons the batch confirms get no single lookup; the others are looked
  up one after another, and unknown and archived ones are gone; a failure of the batch or of a lookup propagates; once
  the deadline has passed the rest is `unchecked`; an empty input makes no call — cleanup design 3.4
- [x] **GP-03** (N · U) `GoneAdmins::find()` returns the gone persons among `adminUsers` in their order, and `[]` if
  all are active — cleanup design 3.4
- [x] **GP-04** (N · U) `CachedPersonDirectory`: a person found active is cached for 600 s (a second `exists()` makes
  no call, after 600 s it does); "gone" is never cached; expired IDs are dropped when the record is written; a broken
  record is a miss; `confirmedActive()` and `assertReadable()` pass through without touching the cache — cleanup
  design 3.2, C8
- [x] **GP-05** (! · U) `CleanupOrphans::run(false)` deletes nothing (no write) and reports the gone persons (unknown, archived) — cleanup design 3.5
- [x] **GP-06** (! · U) `run(true)` deletes the entries of the gone persons only and logs each deletion — cleanup design 3.5
- [x] **GP-07** (! · U) a failed batch lookup or a failed single lookup propagates and nothing is deleted — cleanup design 3.5
- [x] **GP-08** (! · U) a `RateLimitedException` at the 3rd of 4 single lookups propagates and nothing is deleted — cleanup design 3.5
- [x] **GP-09** (! · U) a failed delete is recorded and logged, the other persons are still deleted, `exitCode()` is 1 — cleanup design 3.5
- [x] **GP-10** (! · U) a gone admin with an entry is deleted and reported in `goneAdmins`, `exitCode()` is 1 — cleanup design 3.5
- [x] **GP-11** (N · U) person ID 0 (self-test) is ignored: no lookup, no delete — cleanup design 3.5
- [x] **GP-12** (! · U) entries with string IDs and duplicates of a gone person are all removed — cleanup design 3.5
- [x] **GP-13** (! · U) invalid settings throw `ConfigurationException` and nothing is deleted — cleanup design 3.5
- [x] **GP-14** (! · U) a missing persons right throws `PersonsNotReadableException` before any person call — cleanup design 3.5
- [x] **GP-15** (! · U) a passed deadline leaves the rest `unchecked` (`isComplete()` false); a second run without a deadline deletes them — cleanup design 3.5
