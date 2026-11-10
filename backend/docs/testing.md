# PHP Backend Testing

The backend has three test layers (see `specs/backend-spec.md`, section 6.6):

| Layer | Suite | Needs | Command |
| --- | --- | --- | --- |
| Unit tests | `Unit` | nothing | `composer test` |
| API tests (the whole app with a fake ChurchTools) | `Api` | nothing | `composer test` |
| Contract tests | `Contract` | a ChurchTools test instance, one fixture, local config | `composer test:contract` |

`composer test` runs the unit and API tests with the shared configuration `phpunit.xml.dist`. They need no network
access and also run in the CI. `composer check` runs code style, PHPStan and these tests together, like the CI.

The contract tests run only on demand, before each release, with your local `phpunit.xml`. They check only what a fake
can't prove: that ChurchTools behaves as the backend assumes, and that the backend works against it. If something they
need is missing, they abort with a message that says what's missing.

Other checks:

- `composer cs` / `composer cs:fix`: check or fix the code style (PHP-CS-Fixer)
- `composer stan`: static analysis (PHPStan). The baseline `phpstan-baseline.neon` is empty; keep it that way.


## Contract test setup

You need:

- a **ChurchTools test instance** with the CtPassStore extension
- one **fixture** with a test user
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

- Without the matching private key it compares ciphertexts with what ChurchTools stored. To also decrypt, add
  `<env name="CT_TEST_PRIVATE_KEY_FILE" value="/path/to/private.pem"/>` to your local `phpunit.xml`.
- `testParallelPutsHeal` prints how long the parallel PUTs took compared with a single one. A run in which ChurchTools
  couldn't be reached is reported as incomplete, never as passed.

### Tokens without a browser

The real login needs a browser (OAuth). The contract tests therefore mint backend access tokens directly with
`UserTokens` and the `JWT_SECRET` from `config/credentials.php`, with the same claims `POST /v1/auth/token` issues.
Machine tokens are signed with a test key. This only works for test systems whose secrets you have.

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
