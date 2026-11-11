# Changelog

All notable changes to the PHP backend. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The release waits for the extension and ct-radius (plan phase 5): the `0.1.0` section is still marked `Unreleased`, and
`bin/release-check.php` accepts only a real date (`YYYY-MM-DD`), so it fails until the date is set on release day.

## [0.1.0] - Unreleased

A rewrite of the old backend (spec section 10). The API is not compatible with the old one.

### Changed

- All routes live under `/v1/`; the old paths `/entries/{id}` and `/test` answer `404 not-found`.
- Users log in once with ChurchTools OAuth (`POST /v1/auth/token`) and get a 15-minute backend token. The backend no
  longer receives the permanent ChurchTools login token and makes no ChurchTools call per request.
- Machine clients (ct-radius) sign an Ed25519 JWT for every request and are registered in `machineClients`;
  `readAccessUsers` is removed.
- Errors are RFC 9457 problem details; clients switch on `type` (see `docs/problems.md`). A wrong primary password is
  `403 invalid-primary-password`, an invalid custom password `400 password-invalid` with `violations`, a missing entry
  `404 entry-not-found`.
- `GET /v1/test` is for admins only and reports the version; `?write=1` also tests writing to `passwordStore`.
- `credentials.php` needs `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET` and `JWT_SECRET`; `LOG_LEVEL` is new.
- The ChurchTools client is an own small implementation instead of `churchtools/php-client`.

### Added

- Cache for module and category IDs, settings and the public key, with HMAC-protected files.
- Limits: 5 wrong primary passwords per person and 15 minutes; per address 30 logins and 60 rejected tokens per minute,
  plus 100 logins per minute overall.
- Daily rotated logs (14 files), the version in every error log entry, `setup/setup.sh` with permissions and a check of
  the deploy folder (`bin/check-deploy.php`), and a release workflow with `bin/release-check.php`.

### Fixed

- Wrong HTTP methods and unknown routes now answer `405` and `404` instead of crashing.
- `{id}` is validated (`400 invalid-id`) instead of cast to an integer.
- Request bodies that aren't JSON objects, invalid settings and a missing configuration are rejected with clear errors.
- Custom passwords have a maximum length; generated passwords no longer use `str_shuffle`.
- Duplicate or broken entries in `passwordStore` no longer break reading and writing.
- Network errors, timeouts and `5xx` during the primary password check no longer count as a wrong password.
