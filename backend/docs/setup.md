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

Do **not** give it administrative rights such as `administer settings`, `administer persons` or
`administer custom modules`, and no write access to any other extension category. `/v1/test` fails when the service
user has more rights than needed.

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
];
```

| Key | Meaning |
| --- | --- |
| `CT_API_URL` | The API base URL of your instance, `https://...`, including the trailing `/api`, without credentials, query or fragment. |
| `CT_API_TOKEN` | Login token of the service user (step 1). |
| `CORS` | Allowed origins, a non-empty list like `https://host[:port]`, no path, no `*`. It must include your ChurchTools instance, or the extension cannot reach the backend. |
| `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET` | From the OAuth application (step 2). |
| `JWT_SECRET` | Signs the backend's own access tokens. Generate it, at least 32 bytes: `php -r 'echo bin2hex(random_bytes(32)), PHP_EOL;'` |
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

## Logs and personal data

The backend writes `logs/app.log`, rotated daily (`app-YYYY-MM-DD.log`); the **last 14 files** are kept and older
ones are deleted. The log contains IP addresses and ChurchTools person IDs (denied access, logins, password changes
and deletions). These are **personal data**: the backend logs them only to detect abuse. Tell your users, and do not
copy the logs elsewhere for longer than 14 days. Passwords, tokens, codes and ciphertexts are never logged.

## Rotating secrets

| Secret | Where | How to rotate |
| --- | --- | --- |
| Service user's login token | `credentials.php` | Change the service user's password in ChurchTools (this invalidates the token at once), fetch the new login token, update `credentials.php`. |
| OAuth client secret | `credentials.php` | ChurchTools cannot rotate it: delete and recreate the OAuth application, update `credentials.php` and the users' login right. |
| `JWT_SECRET` | `credentials.php` | Replace it. All backend tokens become invalid and users log in again silently. |
| Machine client private key | Only on the machine client | Register a second public key, switch the client to the new key, remove the old one. |

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
