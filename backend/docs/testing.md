# PHP Backend Testing

The backend has three test layers (see `specs/backend-spec.md`, section 6.6):

| Layer | Suite | Needs | Command |
| --- | --- | --- | --- |
| Unit tests | `Unit` | nothing | `composer test` |
| API tests (the whole app with a fake ChurchTools) | `Api` | nothing | `composer test` |
| Contract tests | `Contract` | a ChurchTools test instance, one fixture, local config | `composer test:contract` |
| Load test | `Load` | a ChurchTools test instance, the fixtures, local config, an admin token | `composer test:load` |

`composer test` runs the unit and API tests with the shared configuration `phpunit.xml.dist`. They need no network
access and also run in the CI. `composer check` runs code style, PHPStan and these tests together, like the CI.

The contract tests run only on demand, before each release, with your local `phpunit.xml`. They check only what a fake
can't prove: that ChurchTools behaves as the backend assumes, and that the backend works against it. If something they
need is missing, they abort with a message that says what's missing.

Other checks:

- `composer cs` / `composer cs:fix`: check or fix the code style (PHP-CS-Fixer)
- `composer stan`: static analysis (PHPStan). The baseline `phpstan-baseline.neon` is empty; keep it that way.


## Tests against a real ChurchTools instance (Contract and Load)

> **Only ever run `Contract` and `Load` against a dedicated TEST instance, never against a production instance.** They
> write to the instance: they create and delete entries, and the load test also creates, archives and deletes persons
> and runs the cleanup job.

Neither suite is part of `composer test` or `composer check`; both need your local `phpunit.xml`.

## Contract test setup

You need:

- a **ChurchTools test instance** with the CtPassStore extension
- two **fixtures**: a test user and three test persons
- the backend's **`config/credentials.php`** for that instance
- a local **`phpunit.xml`**

### ChurchTools test instance

**Never use a production instance.** The tests write values with the reserved person ID `0` and the entry of one test
user, and delete them again; they never change settings or keys.

1. Upload the **ctpassstore** extension and run its setup, so the module, its categories, the settings and the public
   key exist. The settings must allow custom passwords without a primary password (for `LiveEntriesTest`).
2. Create the OAuth application for the backend (spec 3.3) and give the test user the right to use it.

### Fixture

`tests/Contract/fixtures/normal_users.json` with at least one user who may see the extension:

```json
[
    {"id": 101, "pwd": "the_password", "username": "the_username"}
]
```

The first user is used for the login contract cases and as the owner of the test entry. `LiveEntriesTest` skips if that
user already has an entry.

`tests/Contract/fixtures/person_status.json` with three test persons on the instance, an active one, an archived one
and a deleted one (their `GET /persons/{id}` answers `200`, `200` and `404`):

```json
{"active": 2849, "archived": 2852, "deleted": 2855}
```

The service user whose token is in `phpunit.xml` needs the persons right: `churchdb` `view`, `view alldata` for every
department, `view archive` and `view hidden persons`. Without it the person cases fail with a `403`.

### Configuration

1. Create `config/credentials.php` as described in the [setup guide](./setup.md), including `OAUTH_CLIENT_ID`,
   `OAUTH_CLIENT_SECRET` and `JWT_SECRET`.
2. Copy `phpunit-example.xml` to `phpunit.xml` and fill in `CT_API_URL` and `CT_API_TOKEN`.

Keep these files private: `chmod 600 config/credentials.php phpunit.xml tests/Contract/fixtures/*.json`.

### Running

```bash
composer test:contract
```

| Test | What it checks | Writes |
| --- | --- | --- |
| `ChurchToolsClientContractTest` | The shared client contract against real ChurchTools (the fake passes the same cases in the unit layer). Its OAuth cases send an unknown code and a wrong client secret. | Values with `personId` `0`, deleted again |
| `LiveEntriesTest` | The locally started backend (port 8091, several workers) with the instance's real settings and key: a round trip and parallel PUTs. | The first fixture user's entry, deleted again |
| `NodeSignedMachineTokenTest` | A machine token signed with Node.js, as ct-radius signs it, passes the verifier. Skipped without `node`. | Nothing |

Notes on `LiveEntriesTest`:

- PHP's built-in server sets no `HTTPS` variable, so the backend would answer `400 https-required`.
  `BackendSandboxManager` therefore starts it with a router script that sets `HTTPS=on`, as a TLS front end would.

- Without the matching private key it compares ciphertexts with what ChurchTools stored. To also decrypt, add
  `<env name="CT_TEST_PRIVATE_KEY_FILE" value="/path/to/private.pem"/>` to your local `phpunit.xml`.
- `testParallelPutsHeal` prints how long the parallel PUTs took compared with a single one. A run in which ChurchTools
  couldn't be reached is reported as incomplete, never as passed.

### Tokens without a browser

The real login needs a browser (OAuth). The contract tests therefore mint backend access tokens directly with
`UserTokens` and the `JWT_SECRET` from `config/credentials.php`, with the same claims `POST /v1/auth/token` issues.
Machine tokens are signed with a test key. This only works for test systems whose secrets you have.

## Load test

> **Only against a dedicated TEST instance, never production.** The load test creates 20 persons, writes up to 500
> entries into `passwordStore`, archives and deletes persons, and runs the cleanup job, which deletes entries.

```bash
composer test:load
```

A full run takes about 15 minutes; `composer test:load` turns off Composer's 300-second process timeout for it.

It measures the backend under realistic data sizes and writes the results to STDERR and to a JSON file
(`LOAD_RESULTS_FILE`, default `ctps-load-results.json` in the temp folder). The results name person IDs only. The
report of a run is in `specs/backend-load-test-*.md`.

It needs everything the contract tests need, and:

- `tests/Contract/fixtures/admin_users.json` with one admin user (`[{"id": 1, "username": "...", "pwd": "..."}]`)
- `config/credentials.php` whose `CT_API_TOKEN` is an **admin** login token of the same instance as `phpunit.xml`. It
  is used only to create, archive and delete the 20 load persons; the backend under test runs with the minimal
  service user's token from `phpunit.xml`.
- enough persons on the instance: it gives up to 480 existing persons without an entry one entry each

What it does, strictly sequentially and paced below the ChurchTools rate limit (it waits out `429`s and records them):

1. Records the values in `passwordStore` (the baseline). They're never changed.
2. Creates 20 persons "CtPassStore Load 01…20" and gives each an entry, then existing persons (not the fixture users,
   not the admins, not persons with an entry) entries in stages: 50, 200, 500 in total.
3. At each stage, against a backend in a temporary sandbox (copies of `public/index.php` and `bin/cleanup.php`,
   symlinked `vendor/`, its own `config/`, `cache/`, `logs/`, generated `credentials.php` with a random
   `CLEANUP_TOKEN`): `GET /v1/entries/{id}` as admin for 50 persons with an empty persons cache and again cached,
   `PUT` for 20 entries the run created, and `GET /v1/test`. For comparison, it also times the KV list and one person
   lookup directly, and an unauthenticated request (PHP start-up only).
4. Archives 10 load persons and deletes 10, runs the web cron (`POST /v1/cleanup`, dry run, then `?apply=1` until
   `complete`, removing the sandbox's cooldown record between calls), then `bin/cleanup.php` (dry run, then a few
   gone entries again, dry run and `--apply`), and checks that exactly the gone persons' entries were removed.
5. Teardown, also after a failure: deletes the values it created, deletes the 20 persons, removes the sandbox and
   checks that `passwordStore` equals the baseline. A failed check is printed loudly.

If the fixture admin isn't in the instance's `adminUsers`, the run never changes the settings in ChurchTools. It puts
the real settings plus that admin into the **sandbox's own** settings cache instead, and says so in the results.

## Manual OAuth check before each release

The OAuth flow can't be automated. Check it by hand against the test instance:

1. Open the extension in ChurchTools as the test user. Expect a redirect to `/oauth/authorize` with
   `response_type=code`, `scope=api`, `state` and `code_challenge_method=S256`.
2. On the first login, ChurchTools shows the consent screen; after consenting, it redirects back to the extension page.
   On later logins, the redirect happens without a visible step.
3. The extension calls `POST /v1/auth/token` and gets `200` with `accessToken`, `tokenType: "Bearer"` and
   `expiresIn: 900`. Decode the token (e.g. on jwt.io with a test token only): `iss` `ctpassstore-backend`, `aud`
   `ctpassstore-api`, `sub` the person ID, `username` the ChurchTools username.
4. Repeat the request with the same code: `400 oauth-code-invalid`.
5. A user without the extension's `view` permission gets `403 no-service-access`.
6. A user without the right "Bei Drittsystem via ChurchTools-Benutzerkonto einloggen" for the OAuth application sees
   ChurchTools' "Du bist nicht berechtigt …" page and never reaches the backend.
7. `logs/app.log` contains "User <id> logged in." and no token, code or verifier.
8. Catalog CT-02 and CT-03: the ChurchTools token (in the browser's network tab, before it reaches the backend) is an
   RS256 JWT with `aud` = client ID and `scopes` containing `api`; `whoami` and `permissions/global` accept it as
   `Bearer` with `X-OnlyAuthenticated: 1`.
