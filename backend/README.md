# 📡 CtPassStore PHP Backend Documentation

## API Documentation

This backend provides a secure interface for storing, updating, and deleting encrypted, secondary passwords for ChurchTools users. It is built with PHP and Slim Framework and uses ChurchTools authentication tokens for access control.

---

### 🔐 Authentication

All endpoints require a valid ChurchTools token in the Authorization header.

Required Headers

```http
Authorization: Login <churchtools-token>
Content-Type: application/json
Accept: application/json
 ```

---

### 📦 Endpoints

### GET /entries/{id}

Retrieves the encrypted password for the ChurchTools user with the given ID.

Path Parameter

    id — ChurchTools person ID

Request Body

    (none)

Response

 ```json
{
    "secondaryPwd": "your-encrypted-password"
}
 ```

- Returns the encrypted secondary password as stored in the backend.
- If no password entry exists for the given user, a `404 Not Found` response is returned.
- If your are no allowed to retrieve the entrypted password for the given user, a `403 Forbidden` response is returned.


### PUT /entries/{id}

Sets or updates the secondary password for the ChurchTools user with the given ID.

Path Parameter

    id — ChurchTools person ID

Request Body

 ```json
{
    "primaryPwd": "churchtools-login-password", // optional, required if password change protection is enabled
    "secondaryPwd": "your-new-password" // optional, will be generated if omitted
}
```

Behavior

- If secondaryPwd is provided and custom passwords are allowed, it will be encrypted and then stored.

- If omitted, a secure secondary password will be generated and returned.

- If primaryPwd is required (based on config), it must be valid for the user.

Responses

- 204 No Content — password was set successfully (custom password)

- 200 OK — password was generated and returned

```json
{
    "secondaryPwd": "generated-password"
}
```

### DELETE /entries/{id}

Deletes the stored password for the ChurchTools user with the given ID.

Path Parameter

    id — ChurchTools person ID


Request Body

    (none)

Response

- 204 No Content — password deleted successfully

## 🧠 Validation Rules for Secondary Passwords

- Only the user themselves or configured admin users may modify or delete entries.
- Passwords must meet complexity requirements (letter, digit, symbol).
- Custom passwords may be disallowed via configuration.
- Primary password may be required for changes, depending on settings.

## Setup

Setting up the PHP backend is closely tied to configuring the CtPassStore extension in ChurchTools. We recommend following the steps outlined in the [CtPassStore extension setup guide](../extension/docs/setup.md).

If you prefer to focus only on the backend, you can find the standalone instructions in the [PHP Backend Setup Guide](./docs/setup.md).


## TODOs

### Tests
- Complete the remaining tests for entry operations (`GET`, `PUT`, `DELETE`)
- Add tests for valid passwords when custom passwords are not allowed
- Add tests for invalid passwords (disallowed characters, too short, insufficient entropy)
- Add tests for `requirePasswordForPasswordChange = true`
- Add additional tests for `DELETE`
- Add tests for unknown endpoints or missing IDs in the entries endpoint (must have no side effects)
- Write comprehensive unit tests for all components

### Fixes
- Ensure wrong HTTP methods on endpoints return proper client responses with `405 Method Not Allowed` without side effects instead of internal server errors
- Ensure HTTP methods on non-existing endpoints return `404 Not Found` without any side effects
- Extend self-tests at the `/test` endpoint to also check whether reade and write access to the database work
- Optimize backend calls by moving `ExtensionDataContainer` into its own container (current `GET`, `PUT`, `DELETE` responses are slow)
- Implement and test 2FA when `requirePasswordForPasswordChange = true`
- Extend the `/test` endpoint to verify that log files and non-public folders are not accessible externally
- Rename `ServiceSettings` to `ChurchtoolsServiceSettings`
- Standardize spelling of “ChurchTools” across the codebase
- Extend the setup.md instructions to also check that https is enforced
- Centralize timeout configuration for all ChurchTools API communication in a single file
- Add clear comments to each class
- Investigate and implement paging support
- Test HTTPS enforcement via `.htaccess`
- Test that access to folders outside of `/public` is blocked via `.htaccess`
- Implement a cron job to clean up the database and remove non-existent users from the key-value store