# PHP Backend Testing

The backend has three test layers (see `specs/backend-spec.md`, section 6.6):

| Layer | Suite | Needs | Command |
| --- | --- | --- | --- |
| Unit tests | `Unit` | nothing | `composer test` |
| API tests (the whole app with a fake ChurchTools) | `Api` | nothing | `composer test` |
| End-to-end tests | `EndToEnd` | a ChurchTools test instance, fixtures, local config | `composer test:e2e` |

`composer test` runs the unit and API tests with the shared configuration `phpunit.xml.dist`. They need no network
access and also run in the CI. `composer check` runs code style, PHPStan and these tests together, like the CI.

The end-to-end tests run only on demand, with your local `phpunit.xml`. If something they need is missing, they abort
with a message that says what's missing.

Other checks:

- `composer cs` / `composer cs:fix`: check or fix the code style (PHP-CS-Fixer)
- `composer stan`: static analysis (PHPStan). Existing findings are recorded in `phpstan-baseline.neon`; new code must
  not add any.


## ⚙️ End‑to‑End Test Setup

To run the end‑to‑end tests, you need:

- A properly configured **ChurchTools instance**
- A set of **fixtures**
- A valid **backend configuration**
- A valid **phpunit.xml**



## 🛠 ChurchTools Backend Setup

You must provide a ChurchTools instance dedicated to testing.

⚠️ **Warning:**  
The test suite creates and modifies data inside the ChurchTools backend. 
**Never use a production ChurchTools instance**, as data may be overwritten or deleted.

Inside your ChurchTools installation:

1. Upload the **ctpassstore** extension.  
2. **Run the setup** of the CtPassStore extension until the step "Setting up the data structure...". You can then just abort the setup (close the tap or navigate elsewhere)

---

## 📁 Fixtures

Place the following JSON files into:

```bash
tests/EndToEnd/fixtures/
```

Required files:

- `admin_users.json`
- `no_access_allowed_users.json`
- `normal_users.json`
- `read_access_users.json`

Each file must follow this structure:

```json
[
    {"id": 101, "pwd": "the_password", "username": "the_username"},
    ...
]
```

### Field descriptions

- **id** — The user’s ID in your ChurchTools backend  
- **pwd** — The user’s password  
- **username** — The user’s ChurchTools username  

These users **must already exist** in your ChurchTools instance.  
Create them manually or use existing accounts.

### Permission requirements

- Users in  
  - `admin_users.json`  
  - `normal_users.json`  
  - `read_access_users.json`  
  must have permission to **see the CtPassStore extension**.

- Users in  
  - `no_access_allowed_users.json`  
  must **not** have permission to see the CtPassStore extension.

Set this up properly in ChurchTools overall rights management.

## 🔧 Backend Configuration & phpunit.xml

Create the backend credentials file:

```bash
/config/credentials.php
```

This file must contain your backend connection details as described in the [Backend Setup Guide](./setup.md).

Additionally:

1. Copy `phpunit-example.xml` → `phpunit.xml`
2. Insert your test configuration values also into the new file at the appropriate place.

---

## ▶️ Running the End-to-End Tests

```bash
composer test:e2e
```

Keep the local files with credentials private (`chmod 600 config/credentials.php phpunit.xml tests/EndToEnd/fixtures/*.json`).

### Tests that leave the instance's setup alone

Two parts of the suite never change settings or keys and can run against a shared test instance:

```bash
vendor/bin/phpunit -c phpunit.xml --filter 'ChurchToolsClientContractTest|LiveEntriesTest'
```

- `ChurchToolsClientContractTest` writes only values with `personId` `0` and deletes them again.
  Its OAuth cases (unknown code, wrong client secret) read `OAUTH_CLIENT_ID` and `OAUTH_CLIENT_SECRET` from
  `config/credentials.php` and are skipped while those are missing. They send no valid code, so nothing changes.
- `LiveEntriesTest` starts the backend locally (port 8091, several workers) and writes only the entry of the first user
  in `normal_users.json`. It skips if that user already has an entry, and it deletes what it created. It needs an
  instance that allows custom passwords without a primary password.
  - Without the matching private key it compares ciphertexts with what ChurchTools stored. To also decrypt, add
    `<env name="CT_TEST_PRIVATE_KEY_FILE" value="/path/to/private.pem"/>` to your local `phpunit.xml`.
  - `testParallelPutsHeal` prints how long the parallel PUTs took compared with a single one, to show whether they
    really overlapped.
