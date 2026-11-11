# CtPassStore PHP Backend

Stores encrypted secondary passwords for ChurchTools users. Built with PHP and Slim. The specification
([specs/backend-spec.md](../specs/backend-spec.md)) is the reference; this page is an overview. See
[CHANGELOG.md](./CHANGELOG.md) for what changed from the old backend.

## API

All routes live under `/v1/` and need HTTPS. Bodies are JSON (`Content-Type: application/json`).

| Route | Who | Purpose |
| --- | --- | --- |
| `POST /v1/auth/token` | anyone with an OAuth code | Exchanges a ChurchTools OAuth code for a backend token |
| `GET /v1/entries/{id}` | the person, admins, machine clients with read permission | Returns the encrypted secondary password: `{"secondaryPwd": "..."}` |
| `PUT /v1/entries/{id}` | the person, admins | Sets the password. Body (all optional): `primaryPwd`, `secondaryPwd`. `204` for a custom password; `200` with the generated one if `secondaryPwd` is omitted |
| `DELETE /v1/entries/{id}` | the person, admins | Deletes the entry, `204` |
| `GET /v1/test` | admins | Self-check, `200` or `207`; `?write=1` also tests writing to `passwordStore` |

`{id}` is the ChurchTools person ID. `PUT` and `DELETE` need the caller's own `primaryPwd` when
`requirePasswordForPasswordChange` is set. Other paths answer `404 not-found`, other methods `405`.
`/v1/setup` (first configuration over the extension) is planned (spec 4.10).

### Authentication

- **Users** log in with the ChurchTools OAuth authorization code flow (PKCE). The extension sends the code, the PKCE
  verifier and the redirect URI to `POST /v1/auth/token` and receives a backend token valid for 15 minutes. It sends it
  as `Authorization: Bearer <token>`. The backend never sees the user's permanent ChurchTools login token (spec 4.4).
- **Machine clients** (ct-radius) don't log in. They sign a short-lived EdDSA (Ed25519) JWT for every request, with a
  unique `jti`, and send it as `Authorization: Bearer <jwt>`. They are registered with their public key in the
  extension's settings (spec 4.4a).

### Errors

Every error is an RFC 9457 problem details object (`application/problem+json`). Clients switch on `type`; all types are
listed in [docs/problems.md](./docs/problems.md).

### Limits

- Primary password: 5 wrong attempts per person within 15 minutes, then `429 too-many-attempts`.
- Per address (`REMOTE_ADDR` only, IPv6 per `/64`): 30 `POST /v1/auth/token` and 60 rejected tokens per minute, and
  100 logins per minute across all addresses. Details in spec 6.3.

## Setup

Setting up the backend is tied to configuring the CtPassStore extension in ChurchTools; see the
[extension setup guide](../extension/docs/setup.md). The standalone instructions for the backend are in the
[PHP Backend Setup Guide](./docs/setup.md). Tests are described in [docs/testing.md](./docs/testing.md).
