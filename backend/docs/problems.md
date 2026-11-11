# Problem types

Every error response of the CtPassStore backend is an RFC 9457 problem details object with
`Content-Type: application/problem+json`. Its `type` is the URL of a section on this page. Clients decide based on
`type`, not on the status code or the text.

```json
{
  "type": "https://github.com/lub90/ct-pass-store/blob/main/backend/docs/problems.md#entry-not-found",
  "title": "No password entry",
  "status": 404,
  "detail": "Person 123 has no secondary password."
}
```

Each section names the status, the fixed `title`, what the problem means and what to do. This page is checked
against the code by a unit test.

## https-required

- **Status:** 400
- **Title:** HTTPS required

The request came over plain HTTP. The backend only answers over HTTPS; normally `.htaccess` redirects plain HTTP
before PHP runs, and this answer means the web server didn't (e.g. it ignores `.htaccess`).

**What to do:** Use the `https://` URL of the backend. If that's what you use, check that the web server or proxy
tells PHP the request is HTTPS (server variable `HTTPS=on`).

## invalid-id

- **Status:** 400
- **Title:** Invalid person ID

The person ID in the path isn't a positive whole number in decimal notation.

**What to do:** Use the numeric ChurchTools person ID, e.g. `/v1/entries/42`.

## invalid-body

- **Status:** 400
- **Title:** Invalid request body

The request body isn't empty and isn't a valid JSON object, or one of its fields is missing, unknown or has the wrong type.

**What to do:** Send a JSON object with only the fields the endpoint defines.

## oauth-code-invalid

- **Status:** 400
- **Title:** Invalid authorization code

ChurchTools rejected the authorization code during login: it's invalid, expired, already used, or the PKCE verifier doesn't match.

**What to do:** Start the login again.

## primary-password-required

- **Status:** 400
- **Title:** Primary password required

The settings require the ChurchTools password for changes, but the request doesn't contain `primaryPwd`.

**What to do:** Send your ChurchTools password in `primaryPwd`.

## custom-password-not-allowed

- **Status:** 400
- **Title:** Custom passwords not allowed

The request contains `secondaryPwd`, but the settings don't allow choosing your own password.

**What to do:** Omit `secondaryPwd` to get a generated password, or ask an admin to allow custom passwords.

## password-invalid

- **Status:** 400
- **Title:** Password doesn't meet the policy

The chosen password doesn't meet the policy. The member `violations` lists the rules it breaks.

**What to do:** Choose a password with the required length that contains a letter, a digit and one of `! @ $ % & * - _ + = ? .`, and no other characters.

## missing-token

- **Status:** 401
- **Title:** Missing access token

The request has no `Authorization` header.

**What to do:** Log in and send the access token.

## invalid-token

- **Status:** 401
- **Title:** Invalid access token

The access token isn't valid: wrong scheme, wrong signature, wrong claims, or ChurchTools doesn't accept it.

**What to do:** Log in again.

## token-expired

- **Status:** 401
- **Title:** Access token expired

The access token was valid but has expired.

**What to do:** Log in again; the extension does this automatically.

## no-service-access

- **Status:** 403
- **Title:** No access to the service

You don't have the right to use the CtPassStore extension in ChurchTools.

**What to do:** Ask a ChurchTools admin for the extension's rights.

## forbidden

- **Status:** 403
- **Title:** Not allowed

You're authenticated, but not allowed to do this with this entry (e.g. another person's entry).

**What to do:** Only your own entry is accessible, unless you're an admin.

## invalid-primary-password

- **Status:** 403
- **Title:** Wrong primary password

The ChurchTools password in `primaryPwd` is wrong.

**What to do:** Enter your ChurchTools password. After too many wrong attempts you're blocked for a while (`too-many-attempts`).

## not-found

- **Status:** 404
- **Title:** Unknown endpoint

There's no endpoint at this path. A wrong backend URL in the settings or in a client's configuration is the usual cause.

**What to do:** Check the backend URL; all endpoints are under `/v1/`.

## entry-not-found

- **Status:** 404
- **Title:** No password entry

The person has no secondary password stored. This is the only `404` that means "no password".

**What to do:** Set a password first.

## method-not-allowed

- **Status:** 405
- **Title:** Method not allowed

The endpoint exists but doesn't support this HTTP method. The `Allow` header lists the supported ones.

**What to do:** Use one of the methods in `Allow`.

## payload-too-large

- **Status:** 413
- **Title:** Request body too large

The request body is larger than 16 KB.

**What to do:** Send a smaller body.

## unsupported-media-type

- **Status:** 415
- **Title:** Unsupported content type

A non-empty request body was sent without `Content-Type: application/json`.

**What to do:** Send JSON with `Content-Type: application/json`.

## too-many-attempts

- **Status:** 429
- **Title:** Too many attempts

Too many wrong ChurchTools passwords in a short time, or too many logins or rejected tokens from one address (or too many logins in total) within a minute. The `Retry-After` header and the member `retryAfter` say how many seconds are left.

**What to do:** Wait until the block ends.

## misconfigured

- **Status:** 500
- **Title:** Backend misconfigured

The backend or ChurchTools isn't set up correctly. `detail` names exactly what's wrong: a key in `credentials.php`, a setting, the public key, the extension's data structure, the OAuth application or the service user's rights.

**What to do:** Fix what `detail` names. The self-check `/v1/test` and the backend log give more information.

## internal-error

- **Status:** 500
- **Title:** Internal error

An unexpected error, i.e. a bug. The response doesn't contain details; they're in the backend log.

**What to do:** Report it with the time of the request.

## upstream-unavailable

- **Status:** 502
- **Title:** ChurchTools unavailable

ChurchTools couldn't be reached, timed out or answered with a server error.

**What to do:** Try again later. If it persists, check ChurchTools and the backend's network.

## upstream-invalid

- **Status:** 502
- **Title:** Unexpected answer from ChurchTools

ChurchTools answered something the backend can't use, e.g. an incomplete list or a token without the `api` scope.

**What to do:** Try again. If it persists, check the ChurchTools version and the extension's setup.

## upstream-rate-limited

- **Status:** 503
- **Title:** ChurchTools rate limit reached

ChurchTools limits the number of requests (about 600 per minute per IP address). `Retry-After` and `retryAfter` say when to try again.

**What to do:** Wait the given number of seconds.
