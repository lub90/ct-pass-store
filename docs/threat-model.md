# CtPassStore – Threat Model

> Started 2026-11-13 with the backend tuning file. It covers only the features listed below so far; later
> security-relevant features add their own section. The backend's full security rules are in
> [`specs/backend-spec.md`](../specs/backend-spec.md) (section 6).

## Backend tuning file (`config/tuning.php`)

Design: [`specs/backend-tuning-design.md`](../specs/backend-tuning-design.md).

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
