# PHP Backend Setup

This guide installs the PHP backend by hand. It assumes that the CtPassStore extension is installed in your
ChurchTools instance and that its data categories (`passwordStore`, `encryptionSettings`, `settings`) exist. If you
arrived here through the CtPassStore setup process, that is already the case.

> A shell-free installation (a release zip that the extension's setup wizard configures through the backend) is
> planned; until then, follow the steps below.

## 1. Create the service user

The backend needs its own ChurchTools account, the **service user**. It is the only account that may write to
`passwordStore`, so give it **no more rights than needed**. Pick a name you will recognize later and assign these
rights in ChurchTools' rights management:

- **View** the CtPassStore extension (the backend looks up the extension's module with it; without it every request
  fails).
- **View custom category** and **view custom data** for `passwordStore`, `encryptionSettings` and `settings`.
- **Create, edit and delete custom data** in `passwordStore` only.
- **Read persons**, so the backend can tell a deleted or archived person from an active one (the read check and the
  cleanup, see below).

| Module | Right | For |
| --- | --- | --- |
| CtPassStore extension | View | Looking up the extension |
| CtPassStore extension | View custom category | `passwordStore`, `encryptionSettings`, `settings` (without it ChurchTools lists no category) |
| CtPassStore extension | View custom data | `passwordStore`, `encryptionSettings`, `settings` |
| CtPassStore extension | Create, edit, delete custom data | `passwordStore` only |
| Persons (`churchdb`) | "Personen" sehen (`view`) | Reading persons |
| Persons (`churchdb`) | "Personen eines Bereiches sehen" (`view alldata`) | **Every** department of the instance |
| Persons (`churchdb`) | "Personenarchiv sehen" (`view archive`) | Seeing archived persons |
| Persons (`churchdb`) | "Auch versteckte Personen sehen" (`view hidden persons`) | Seeing hidden persons |

Do **not** give it administrative rights such as `administer settings`, `administer persons` or
`administer custom modules`, and no write access to any other extension category. None of the persons rights above is
administrative. `/v1/test` fails when the service user has more rights than needed, and also when it lacks one of the
rights in the table: for the persons right it names the missing parts, e.g.
`The service user can't read persons (missing: churchdb view archive)`.

Give the four persons rights in a **dedicated role** that holds no other persons rights, and assign only that role (and
the role with the extension rights) to the service user. In `churchdb` the service user may only read: `/v1/test` also
fails if it may create, change, delete, archive or export persons, edit groups or group memberships, send SMS, or has a
person security level above 1. ChurchTools' default read values (e.g. "security level view own data") are fine.

**Upgrading an existing installation:** grant the persons rights before you update the backend. Without them
`/v1/test` fails, and every read of another person's entry (RADIUS logins included) fails with `500 misconfigured`. If
you add a department to ChurchTools later, give the service user `view alldata` for it too.

Then fetch its login token: log in as the service user, open the profile, **Permissions**, **Login token**, and copy
the token. It goes into `credentials.php` as `CT_API_TOKEN`.

## 2. Create the OAuth application and the login right

Users log in through ChurchTools' OAuth server. Each ChurchTools instance needs:

1. **An OAuth application** for the backend, confidential (with client secret), with the redirect URI
   `https://<your instance>/ccm/ctpassstore/`. The extension's setup wizard can create it for you (it needs the
   right "administer settings"). ChurchTools shows the client secret **only once**, so copy the client ID and the
   secret right away.
2. **The right to use it** for every user of the extension: `churchcore` "Bei Drittsystem via
   ChurchTools-Benutzerkonto einloggen" (`login to external system`, a data permission per client). Without it users
   see "Du bist nicht berechtigt dich bei ... einzuloggen". The wizard grants it together with the module rights.

## 3. Build the backend files

You need PHP 8.3 or newer and [Composer](https://getcomposer.org/) on your machine, not on the webserver.

```bash
git clone https://github.com/lub90/ct-pass-store
cd ct-pass-store/backend
bash setup/setup.sh /path/to/an/empty/folder
```

Without the argument the script asks for the folder. It installs the dependencies **without dev tools in a temporary
copy** (your own `backend/vendor` stays untouched), assembles the upload-ready folder, writes `version.txt`, sets the
permissions (files `640`, folders `750`, `config/`, `cache/` and `logs/` `700`) and runs the deploy check. The check
(`php bin/check-deploy.php <folder>`) refuses a folder with a real `credentials.php`, dev files, a ChurchTools
instance URL or something that looks like a login token, or with parts of the layout missing. It also works on any
folder you built another way.

## 4. Configure `config/credentials.php`

Copy `config/credentials-example.php` to `config/credentials.php` in the new folder and fill in:

```php
<?php

return [
    'CT_API_URL' => 'https://your.church.tools/api',
    'CT_API_TOKEN' => 'LOGIN_TOKEN_OF_THE_SERVICE_USER',
    'CORS' => ['https://your.church.tools'],
    'OAUTH_CLIENT_ID' => 'CLIENT_ID_OF_THE_OAUTH_APPLICATION',
    'OAUTH_CLIENT_SECRET' => 'CLIENT_SECRET_OF_THE_OAUTH_APPLICATION',
    'JWT_SECRET' => 'RANDOM_SECRET_OF_AT_LEAST_32_BYTES',
    // 'LOG_LEVEL' => 'info',
    // 'CLEANUP_TOKEN' => 'RANDOM_TOKEN_OF_AT_LEAST_43_CHARACTERS',
];
```

| Key | Meaning |
| --- | --- |
| `CT_API_URL` | The API base URL of your instance, `https://...`, including the trailing `/api`, without credentials, query or fragment. |
| `CT_API_TOKEN` | Login token of the service user (step 1). |
| `CORS` | Allowed origins, a non-empty list like `https://host[:port]`, no path, no `*`. It must include your ChurchTools instance, or the extension cannot reach the backend. |
| `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET` | From the OAuth application (step 2). |
| `JWT_SECRET` | Signs the backend's own access tokens. Generate it, at least 32 bytes: `php -r 'echo bin2hex(random_bytes(32)), PHP_EOL;'` |
| `CLEANUP_TOKEN` | Optional. Turns on the web-cron endpoint `POST /v1/cleanup` (step 7). At least 43 characters; generate it, do not choose it. |
| `LOG_LEVEL` | Optional. `debug`, `info` (default), `notice`, `warning` or `error`. Anything else makes the backend answer `500 misconfigured`. |

A missing or invalid key never fails silently: every request answers `500 misconfigured` and names the key (never its
value).

## 5. Upload and set permissions

Upload the folder's contents to your hosting and make **`public/`** the web root. Everything outside `public/` must
not be readable over HTTP; the `.htaccess` file takes care of that on Apache. Nginx needs its own rules (not yet
tested).

**Uploads do not keep file modes**, so set them again on the server. Which modes are right depends on who runs PHP:

| Hosting | `config/credentials.php` | `config/` | `cache/` and `logs/` |
| --- | --- | --- | --- |
| PHP runs as your hosting user (PHP-FPM, suPHP; most shared hosts) | `600` | `700` | `700` |
| PHP runs as the web server user (e.g. `mod_php`) | `640`, group = the web server's group | `750`, same group | `770`, same group |

The other files and folders can stay `640` and `750`. Under `mod_php` all files must belong to the web server's group
(e.g. `chgrp -R <webserver-group> .`), otherwise PHP cannot read them.

The backend must be served over HTTPS, and `credentials.php` must never be committed to a repository.

`/v1/test` checks that `credentials.php` is readable by PHP, not writable by its group and closed to other users, and
that `logs/` and `cache/` are writable and closed to other users.

The **`cache/` folder must be on a local disk** where `flock` works between PHP processes, not on a network share
without lock support. The backend keeps its security stores (replay cache, rate limits) there and, if locking fails,
rejects the affected requests instead of weakening the protection. `/v1/test` checks locking and fails above 10,000
files in `cache/`.

Save the URL of the backend: you need it in the settings of the CtPassStore extension.

## 6. Test the backend

Log in to the extension as a user listed in the `adminUsers` setting and call `GET /v1/test` with that user's backend
token (others get `403`). A healthy installation answers `200`:

```json
{
    "version": "0.1.0",
    "summary": "All backend self-tests passed successfully.",
    "tests": [
        { "name": "Credentials file", "status": "ok", "message": "..." }
    ]
}
```

If something fails the status is `207` and each failed check names what to fix. `GET /v1/test?write=1` additionally
creates, reads and deletes a test value in `passwordStore` (with the reserved person ID `0`) to prove that the
service user may write.

## 7. Clean up entries of gone persons (optional)

Entries remain in `passwordStore` after a person has been deleted or archived in ChurchTools. Their password already
stops working within 10 minutes (`GET` and `PUT` answer `404 person-not-found`), but the cleanup removes the entry
itself. It needs the persons rights of step 1. It checks every person with an entry in ChurchTools, and it deletes an
entry only after ChurchTools confirmed for that person that they are deleted or archived. An unclear answer never deletes
anything. Persons in `adminUsers` who are gone are only reported; remove them in the extension settings.

**Dry run or apply.** Without `--apply` (CLI) or `?apply=1` (web) the cleanup only reports what it would delete. Try a
dry run first.

### Server cron (CLI)

```bash
php /path/to/backend/bin/cleanup.php            # dry run
php /path/to/backend/bin/cleanup.php --apply    # deletes
```

Cron line, every night at 03:00:

```
0 3 * * * php /path/to/backend/bin/cleanup.php --apply
```

The cron job **must run as the same operating-system user as PHP**. Otherwise the script creates files in `logs/` and
`cache/` (mode `600`) that the web app can't write, and requests start to fail.

Output names person IDs only. Warnings go to stderr, so cron mails them to you. Cron mails stdout and stderr, so the
IDs of gone persons also end up in your mailbox, outside the 14-day log retention (see "Logs and personal data"):
delete those mails accordingly, or redirect stdout to `/dev/null` to get mail only for warnings. Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | Done: nothing to do, or everything was deleted (in a dry run: would have been). |
| 1 | Done, but `adminUsers` contains a gone person or a delete failed. |
| 2 | Aborted, nothing was deleted: wrong argument, broken `credentials.php`, another cleanup is running, the lock file can't be opened, missing persons rights or a failed ChurchTools lookup. |

### Web cron (no server cron)

If your hosting has no cron, a web-cron service such as [cron-job.org](https://cron-job.org) can call the backend. The
endpoint is **off** until you set `CLEANUP_TOKEN` in `credentials.php`.

1. Generate the token. Do not choose one yourself: the security rests on its randomness.

   ```bash
   php -r 'echo bin2hex(random_bytes(32)), PHP_EOL;'
   ```

2. Put it into `credentials.php` as `'CLEANUP_TOKEN' => '...'` (at least 43 characters; a shorter one keeps the endpoint
   off and fails `/v1/test`).
3. Create a job at the service:

   | Setting | Value |
   | --- | --- |
   | URL | `https://<backend>/v1/cleanup?apply=1` |
   | Method | `POST` |
   | Header | `Authorization: Bearer <token>` |
   | Schedule | every 10 minutes to once a day |

   Leave out `?apply=1` for a dry run. Never put the token in the URL; the backend refuses it there.

The answer is `200` with counts only (no person IDs; those are in `logs/`):

```json
{"applied": true, "complete": true, "checked": 143, "gone": 1, "deleted": 1, "failedDeletes": 0, "goneAdmins": 0}
```

| Field | Meaning |
| --- | --- |
| `applied` | `false` for a dry run |
| `complete` | `false` if the 20-second budget ran out; the next call continues |
| `checked` | Persons with entries that were looked at |
| `gone` | Gone persons found |
| `deleted` | Entries deleted (always `0` in a dry run) |
| `failedDeletes` | Deletes that failed; the next run (after the 600-second cooldown) retries them |
| `goneAdmins` | Persons in `adminUsers` who are gone (see `/v1/test`) |

Problems the service may report: `401 invalid-token` (wrong or missing token), `429 cleanup-too-soon` (a run starts at
most every 600 seconds; a call that hits a running cleanup or fails also starts the period), `409 cleanup-running`, and
`500`/`502`/`503` if ChurchTools or the rights are the problem (see [problems.md](./problems.md)).

**Security notes.**

- The limit per address only throttles noise from wrong tokens. It does not slow down guessing of the right token, and a
  call with the right token passes even from a blocked address (so a shared service address can't be locked out). That
  is why the token must be random and long.
- **Rotate `CLEANUP_TOKEN` if it may have leaked:** generate a new one and change it in `credentials.php` and at the
  service. A holder of the token can start only the same harmless cleanup, but could keep your `?apply=1` runs from
  running by sending dry runs inside the 10-minute cooldown.

## Logs and personal data

The backend writes `logs/app.log`, rotated daily (`app-YYYY-MM-DD.log`); the **last 14 files** are kept and older
ones are deleted. The log contains IP addresses and ChurchTools person IDs (denied access, logins, password changes
and deletions). These are **personal data**: the backend logs them only to detect abuse. Tell your users, and do not
copy the logs elsewhere for longer than 14 days. Passwords, tokens, codes and ciphertexts are never logged.

## Rotating secrets

| Secret | Where | How to rotate |
| --- | --- | --- |
| Service user's login token | `credentials.php` | Change the service user's password in ChurchTools (this invalidates the token at once), fetch the new login token, update `credentials.php`. `CT_API_TOKEN` can read the basic data of **every person** (persons rights of step 1), so rotate it at once if it may have leaked. |
| OAuth client secret | `credentials.php` | ChurchTools cannot rotate it: delete and recreate the OAuth application, update `credentials.php` and the users' login right. |
| `JWT_SECRET` | `credentials.php` | Replace it. All backend tokens become invalid and users log in again silently. |
| Machine client private key | Only on the machine client | Register a second public key, switch the client to the new key, remove the old one. |
| `CLEANUP_TOKEN` | `credentials.php` and the web-cron service | Generate a new one (step 7) and change it in both places. Do it if it may have leaked. |

## Troubleshooting

### Every request answers `502 upstream-unavailable`, and the log says "cURL error 60"

The backend couldn't verify the TLS certificate of your ChurchTools instance. Instances on `church.tools` have valid
certificates; this happens with a self-hosted ChurchTools that uses a self-signed certificate or one from an
internal certificate authority.

The backend never turns certificate verification off: it sends the service user's token and the OAuth secret to
ChurchTools, and without verification anyone on the network path could pose as ChurchTools and capture them. Instead,
add your certificate authority to the trusted certificates of the server the backend runs on (for example with
`update-ca-certificates` on Debian or Ubuntu, or through your hosting provider), or give ChurchTools a certificate
from a public authority such as Let's Encrypt.
