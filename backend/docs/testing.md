# PHP Backend Testing

This project uses **PHPUnit** to run tests against a ChurchTools backend.  
Currently, only **end‑to‑end tests** are implemented.


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

## ▶️ Running the Tests

Run the test suite with:

###
vendor/bin/phpunit
###