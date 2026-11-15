# CtPassStore Backend – Tuning File (Design)

> **Status: Draft, 2026-11-13.** Agreed in conversation: approach B (separate optional tuning file, bounded
> allowlist, security values locked). Points marked *(builder's call)* or *(Claude's call)* were not decided by the
> maintainer and may be corrected.

> **Needs revision before implementation.** The settings cache (`SETTINGS_CACHE_SECONDS`) also holds `access`: the
> admin group and the machine clients with their keys. With the range up to 3600 s, removing a machine client or one of
> its keys, or changing the admin group, could take up to an hour instead of 5 minutes (backend spec 4.4a
> "Revocation", 6.1). Before building it, either cap `SETTINGS_CACHE_SECONDS` at 300 s, or give `access` its own
> fixed cache time of at most 300 s.

## 1. Intent

Today every tuning value of the backend (timeouts, cache times, cooldowns) is a constant in the class that uses it,
about 15 classes in all. An installation that needs a slightly different value has to patch code and loses the change
on the next release.

The maintainer wants installations to be **ready in general** for such adjustments: one file an operator edits,
without touching code, and without being able to weaken the backend's security by accident.

There is no concrete installation asking for this today.

## 2. Goals, non-goals, anti-goals

**Goals**

- One optional operator file, `config/tuning.php`, with a committed template `config/tuning-example.php`.
- One place in the code, `src/Config/Tuning.php`, that holds every overridable value with its default, its allowed
  range and a short explanation of what it trades off.
- Every override is validated. A broken tuning file shows the same `500 misconfigured` app as a broken
  `credentials.php` (spec 3.1), with a message that names the key and its allowed range.
- The self-check (`GET /v1/test`) shows which values differ from their defaults.
- Without `tuning.php`, the backend behaves exactly as it does today.

**Non-goals**

- Making security values configurable (section 4.2).
- Changing any default value.
- Fixing read performance with many entries (load test 2026-11-13). That is a separate topic.
- Environment variables, `.env` files or any configuration source other than this one PHP file.

**Anti-goals** (failure even if it works)

- An operator can loosen a security promise of the spec, for example "a deleted person's password stops working
  within 10 minutes", through the tuning file.
- Secrets end up in `tuning.php`, or tuning values make it necessary to share `credentials.php`.
- A typo in a key is silently ignored and the operator believes a value is active when it isn't.

## 3. Approaches considered

| | Approach | Trade-off | Result |
| --- | --- | --- | --- |
| A | Optional tuning keys in `credentials.php` | No new file, but secrets and shareable tuning get mixed; `credentials.php` must never be shared | Rejected |
| **B** | **Separate optional `config/tuning.php` plus one central `Tuning` class; only operational values overridable** | One more file and a little code; secrets stay separate; security model and tests unchanged | **Chosen** |
| C | Like B, but every value overridable, security values only toward "stricter" | Most flexible, but needs stricter-only checks and tests per value, and "stricter" can still be harmful (an over-aggressive lockout) | Rejected: too much surface for a backend meant to stay lean |

## 4. Design

### 4.1 Overridable values

All values are whole seconds (integers). Ranges are inclusive. The default is today's value.

| Key | Default | Allowed | Today in | What it trades off |
| --- | --- | --- | --- | --- |
| `CT_TIMEOUT_SECONDS` | 5 | 2–15 | `GuzzleChurchToolsClient::DEFAULT_TIMEOUT_SECONDS` | Patience with a slow ChurchTools instance vs. how long a request can hang and hold a PHP worker. Applies to both connect and total timeout, as today. Capped at 15 so a web-cron run stays bounded (4.1.1). |
| `SETTINGS_CACHE_SECONDS` | 300 | 30–3600 | `KvSettingsRepository::SETTINGS_TTL` | How fast changed extension settings (admins, password length, machine clients) reach the backend vs. ChurchTools load. |
| `KV_IDS_CACHE_SECONDS` | 3600 | 300–86400 | `ExtensionData::IDS_TTL` | Same, for the extension's module and category IDs, which practically never change. |
| `PERSON_CACHE_SECONDS` | 600 | 60–600 | `CachedPersonDirectory::TTL_SECONDS` | Fewer ChurchTools calls for RADIUS reads vs. how fast a deleted person is locked out. **Can only be lowered:** 600 is the spec's "within 10 minutes" promise (spec 4.11, design C8). |
| `CLEANUP_DEADLINE_SECONDS` | 20 | 5–20 | `CleanupController::DEADLINE_SECONDS` | Work per web-cron call vs. the host's PHP time limit and the web-cron service's timeout. **Can only be lowered:** it bounds the ChurchTools calls a stolen `CLEANUP_TOKEN` can cause per run. CLI runs stay without a deadline. |
| `CLEANUP_COOLDOWN_SECONDS` | 600 | 600–3600 | `CleanupCooldown::SECONDS` | How often a web-cron call may start a cleanup. **Can only be raised:** 600 is the spec's promise that a stolen token starts a cleanup at most once per 10 minutes (spec 4.12 item 9). |

The `cleanup-too-soon` row in the spec's problem table (which says "600 seconds") becomes "the configured cooldown
(default and minimum 600 seconds)". Spec 4.12 item 9 stays true as written.

**Rule behind the ranges** (*Claude's call*, following the maintainer's choice that tuning never loosens security):
a value that backs a security promise of the spec can only move in the stricter direction from its default.

#### 4.1.1 Combined worst case

Keys are validated one by one; there are no cross-key rules (*Claude's call*). The ranges are chosen so the worst
combination stays bounded: a web-cron run stops starting lookups after at most 20 s, and the last lookup can take at
most 15 s, so one run ends within about 35 s plus overhead. `docs/setup.md` says this, and that `max_execution_time`
and the web-cron service's timeout should allow it if the timeout is raised.

### 4.2 Locked values

These stay constants and can't be overridden. Each protects a promise of the spec or a limit of ChurchTools.

| Value | Why locked |
| --- | --- |
| Primary-password lockout: 5 failures in 900 s, then a 900 s block (`FileAttemptLimiter`) | Brute-force protection of the primary password |
| Per-address limits: 30 logins / 60 rejected tokens per address per 60 s; 100 logins per 60 s in total (`AddressLimit`) | Abuse protection; the global limit keeps logins below half of ChurchTools' budget. Discussed: RADIUS reads with valid machine tokens are not counted, so 200–500 Wi-Fi logins in 10 minutes are unaffected. |
| User token lifetime 900 s, machine token lifetime ≤ 300 s, clock leeway 30 s (`UserTokens`, `MachineTokens`, `TokenRules`) | How long a stolen token is useful |
| Minimum wait after a ChurchTools `429` (60 s), minimum failure memory (10 s) | Respecting ChurchTools' rate limit |
| RSA ≥ 4096 bits, password policy bounds, request body 16 KB / depth 32, field length 2048, token length 8192 | Input and crypto bounds |
| Batch size 100, address buckets 256, cache folder limit 10 000 files | ChurchTools API limit or bounded storage |

*(Claude's call)* These **stay in their classes**. Domain and application classes don't depend on `Config` today, and
moving them would mean injecting a dozen values that never change. Instead, the docblock of `Tuning` lists them with
links, and `backend/docs/setup.md` gets a "Fixed values" table (the one above), so an operator who wonders why a value can't be
changed finds the reason.

### 4.3 The tuning file

```php
<?php

// Optional. Copy to tuning.php only if this installation needs different values; leave out what you don't change.
// Allowed keys and ranges: backend/docs/setup.md, "Tuning". Unknown keys or values outside the range stop the backend.
return [
    // 'CT_TIMEOUT_SECONDS' => 5,
    // ...
];
```

- `config/tuning-example.php` is committed and lists every key, commented out, with default, range and one line of
  explanation.
- `config/tuning.php` is not committed (added to `.gitignore`).
- It holds no secrets, so `check-deploy.php` doesn't reject it, and it has no special file-permission check.

### 4.4 Loading and validation

- `Tuning::fromArray(mixed $values): Tuning` validates and returns an immutable object with one typed property per key.
  `Tuning::defaults()` returns the defaults.
- `Kernel::bootstrap` and `Kernel::runCleanup` load the file after `credentials.php`:
  - file missing → defaults
  - file present but not readable → `ConfigurationException`
  - the file doesn't return an array → `ConfigurationException`
  - unknown key → `ConfigurationException` naming the key (catches typos)
  - value not an `int` → `ConfigurationException` naming the key (no strings like `"300"`, no floats)
  - value outside its range → `ConfigurationException` naming the key and the range
- Errors behave like `credentials.php` errors: web → misconfigured app plus `error_log`; CLI → exit code 2 with the
  message.
- `Kernel::create` and `Kernel::cleanupServices` take a `Tuning` (default `Tuning::defaults()`, so existing tests stay
  as they are) and pass each value through the constructor of the class that uses it. The constants named in 4.1 go
  away or become the default in `Tuning`. *(builder's call: exact constructor signatures.)*

### 4.5 Self-check

A new check, `TuningCheck`, is always `ok`. Its message lists the keys whose value differs from the default, e.g.
`PERSON_CACHE_SECONDS=300 (default 600)`, or says "all defaults". Only admins see `/v1/test`, and these values aren't
secret.

### 4.6 Documentation

- `backend/docs/setup.md`: a "Tuning (optional)" section with the table from 4.1 and the "Fixed values" table from 4.2.
- `backend-spec.md`: section 3.1 mentions the optional tuning file, and the places that name a now-configurable number
  say "default".
- `CHANGELOG.md`: an entry.
- `docs/threat-model.md` at the repo root (*Claude's call*: the project rule is repo-wide). It was started during
  this brainstorming, scoped to this feature; it is not a build task. Later features extend it.

## 5. Testing (outline)

- Unit tests for `Tuning::fromArray`: defaults, each key at its minimum and maximum, one below and one above, wrong
  type (string, float, bool, null), unknown key, non-array.
- For each overridable value, one test that a non-default value takes effect (e.g. the settings cache expires after
  the configured time, using the frozen clock).
- API tests: a broken `tuning.php` gives `500 misconfigured` on every route; a missing one gives today's behaviour.
- CLI test: a broken `tuning.php` gives exit code 2.
- Self-check test for the overrides message.
- Tasks touching `PERSON_CACHE_SECONDS`, `CLEANUP_DEADLINE_SECONDS`, `CLEANUP_COOLDOWN_SECONDS` and the validator are
  security-critical (they guard spec promises).

## 6. Left to the builder

- Exact constructor signatures and parameter names.
- Wording of messages, as long as they name the key and the range and never echo unrelated file content.
- Whether `Tuning` keeps the defaults as constants or as a static map.
