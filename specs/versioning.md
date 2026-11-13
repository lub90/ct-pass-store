# CtPassStore – Versioning and Compatibility

> **Status: decided 2026-11-12.** This rule applies to the PHP backend (`backend/`) and the ChurchTools extension
> (`extension/`). Both specs link here instead of repeating it: [`backend-spec.md`](backend-spec.md) section 6.5 and
> [`extension-spec.md`](extension-spec.md) section 13.

## 1. The rule

1. Both parts use [Semantic Versioning](https://semver.org/) `MAJOR.MINOR.PATCH`.
2. **Backend and extension always share `MAJOR.MINOR`.** Only `PATCH` is independent.
3. **Compatibility:** an extension `x.y.*` works with exactly the backend `x.y.*`, and with no other.
4. A `PATCH` release fixes a bug in one part without changing anything the other part relies on: the API (paths,
   bodies, status codes, problem types, token claims), the KV data layout or the settings it reads.
5. Any change to something the other part relies on raises `MINOR` (or `MAJOR`) for **both** parts, even if one of them
   didn't change otherwise. Its CHANGELOG section then says "No changes; released to stay compatible with backend x.y".
6. As long as `MAJOR` is `0`, a `MINOR` step may break compatibility (SemVer rule for `0.x`). From `1.0.0` on, a
   breaking change raises `MAJOR`.

## 2. Tags and releases

| Part | Tag | Version source | CHANGELOG |
| --- | --- | --- | --- |
| Backend | `backend-vX.Y.Z` | `backend/VERSION` | `backend/CHANGELOG.md` |
| Extension | `extension-vX.Y.Z` | `extension/package.json` (and `package-lock.json`) | `extension/CHANGELOG.md` |

- The backend's first release (`0.1.0`) isn't published yet, so the old tag pattern `v*.*.*` is replaced by
  `backend-v*.*.*` before it is. Its release workflow changes accordingly.
- Each release check verifies, besides tag = version = dated CHANGELOG section:
  - **Backend:** its `MAJOR.MINOR` equals that of `extension/package.json` on the same commit.
  - **Extension:** its `MAJOR.MINOR` equals that of `backend/VERSION` on the same commit.

  A mismatch fails the release. Because both parts live in one repository, this is a plain file comparison.
- A failed release gets the next patch version; tags are never moved.

## 3. At runtime

- The backend reports its version (`x.y.z`, `x.y.z+sha` or `x.y.z+sha-dirty`, backend spec 6.5) in the answer of
  `POST /v1/auth/token` as `version`, besides `/v1/test` and `/v1/setup`.
- After login, the extension compares `MAJOR.MINOR` of its own version with the backend's:
  - **Equal:** normal operation.
  - **Different:** admins see an error banner naming both versions and saying to update both parts to the same
    `MAJOR.MINOR`. Users see a short notice that the service is being updated, and no form. Nothing is sent to the
    backend except the login.
- Build metadata (`+sha`, `-dirty`) is ignored in the comparison.

## 4. What users see

- The extension's „Über“ page shows the extension version and, after login, the backend version.
- The user guide states the rule in one sentence: "Install backend and extension with the same first two version
  numbers."
