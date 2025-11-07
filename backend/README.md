# 📡 CtPassStore API Documentation

This backend provides a secure interface for storing, updating, and deleting encrypted passwords for ChurchTools users. It is built with PHP and Slim Framework and uses ChurchTools authentication tokens for access control.

## 🔐 Authentication

All endpoints require a valid ChurchTools token in the Authorization header.

Required Headers

```http
Authorization: Login <churchtools-token>
Content-Type: application/json
Accept: application/json
 ```

## 📦 Endpoints

### GET /entries/{id}

Retrieves the encrypted password for the ChurchTools user with the given ID.

Path Parameter

    id — ChurchTools person ID

Request Body

    (none)

Response

 ```json
{
    "secondaryPassword": "your-encrypted-password"
}
 ```

- Returns the encrypted password as stored in the backend.
- If no password entry exists for the given user, a `404 Not Found` response is returned.


### PUT /entries/{id}

Sets or updates the encrypted password for the ChurchTools user with the given ID.

Path Parameter

    id — ChurchTools person ID

Request Body

 ```json
{
    "primaryPassword": "churchtools-login-password", // optional, required if password change protection is enabled
    "secondaryPassword": "your-new-password" // optional, will be generated if omitted
}
```

Behavior

- If secondaryPassword is provided and custom passwords are allowed, it will be encrypted and then stored.

- If omitted, a secure password will be generated and returned.

- If primaryPassword is required (based on config), it must be valid for the user.

Responses

- 204 No Content — password was set successfully (custom password)

- 200 OK — password was generated and returned

```json
{
    "secondaryPassword": "generated-password"
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

## 🧠 Validation Rules

- Only the user themselves or configured admin users may modify or delete entries.

- Passwords must meet complexity requirements (letter, digit, symbol).

- Custom passwords may be disallowed via configuration.

- Primary password may be required for changes, depending on settings.