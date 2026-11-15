# 🔑 CtPassStore

A ChurchTools Secondary Password Extension and Management Backend

## 📖 About this Project
This project takes a step forward in positioning ChurchTools as a central authentication and authorization entity for church and community IT systems. It introduces the concept of a **secondary password** in ChurchTools. Modern IT systems often use secondary passwords to separate core account credentials from those needed for specific - often external - services, reducing the risk of exposing the primary login. This layered approach enhances security by ensuring that even if a secondary password is compromised, the main account remains protected.
Secondary passwords are (amongst other reasons) designed for systems that require access to a cleartext password (e.g., challenge‑response authentication procedures).

CtPassStore provides an extension to ChurchTools that allows every user to have an individual, securely protected secondary password. This secondary password can then be used in:

- 📡 **RADIUS servers** for ChurchTools-based WiFi authentication (see [ct-radius project](https://github.com/lub90/ct-radius))  
- 🔐 **VPN connections** with ChurchTools-based rights management (project draft based on [strongSwan](https://strongswan.org/))  
- 📂 **Samba integration** for ChurchTools-based network drive and shared folder management (project to be started)  
- 🗂️ **LDAP services** using secondary, NT-hashed passwords (project to be started) 
- ➕ **And many more...**  

## 🚀 Features of CtPassStore

- 🖥️ **Integrated GUI** within ChurchTools that allows users to easily set and update their personal secondary passwords.
- 🔐 **Security by design:** all secondary passwords are protected using modern asymmetric encryption (RSA‑4096 with OAEP and SHA‑256). Decryption keys are kept separate from ChurchTools and the dedicated PHP backend, ensuring that even in the event of a system breach, passwords remain secure.
- 🔗 **Seamless integration** of external IT systems into ChurchTools’ user rights and user management through a simple [REST API](./backend/README.md) to access the encrypted passwords. This enables scenarios such as personal WiFi access control via the [ct‑radius project](https://github.com/lub90/ct-radius) and other challenge‑response based authentication systems (e.g., samba drives, vpn access).
- 🧑‍💼 **Administrative control panel** for configuring which external systems are permitted to access secondary passwords, providing clear oversight and easy setup.

## ⚙️ Setup

### Prerequisites
- A running ChurchTools instance with extensions enabled  
- A web hosting environment with PHP support

### CtPassStore Components

CtPassStore consists of:
- A **ChurchTools Extension** where the secondary passwords are stored securily. Users can manage their secondary password directly in ChurchTools and administrators can define which systems are allowed to access which passwords.
- A **PHP backend** that handles encryption, integration, and access management with external IT systems, because this is not possible with a ChurchTools extension. The PHP backend can be hosted on any "usual" webhosting platform. As such, no separate server capacity, infrastructure or complicated setup is required.

### Setup Procedure
> **Version 0.1.0 is not released yet.** Its setup and migration assistant isn't built yet, so a new installation can't be set up and an existing one can't be migrated. The release waits for it; keep running your current version until then.

- **Extension:** get the release ZIP (or build it yourself) and upload it to ChurchTools under the key `ctpassstore`, as described in the [extension setup guide](./extension/docs/setup.md).
- **PHP backend:** install it by hand as described in the [backend setup guide](./backend/docs/setup.md).
- **Connecting both:** writing the extension's settings (backend address, OAuth client, role groups and their rights) is the job of the coming setup assistant.

Install backend and extension with the same first two version numbers (e.g. backend `0.1.x` with extension `0.1.x`; see [specs/versioning.md](./specs/versioning.md)). Releases are tagged `extension-vX.Y.Z` and `backend-vX.Y.Z`.

### Using CtPassStore
The [user guide](./extension/docs/user-guide.md) shows the extension's pages for users and admins, on a computer and on a phone, and explains why everyone who can change the backend address (normally the admin group) must be as trustworthy as your ChurchTools administrators. What changed in each version is in the CHANGELOGs of the [extension](./extension/CHANGELOG.md) and the [backend](./backend/CHANGELOG.md).


## 🧩 CtPassStore Architecture

The **CtPassStore** project has a unique architecture that combines a ChurchTools extension with a dedicated PHP backend.  

- The **CtPassStore extension** provides the user interface and stores the encrypted secondary passwords in its key‑value store directly in ChurchTools.  
- The **PHP backend** ensures that only authorized users and systems can access these encrypted passwords through a secure REST API.  

### 🔄 Password Lifecycle
The process of setting or resetting a secondary password works as follows:

1. The CtPassStore ChurchTools extension offers a GUI where users can manage their secondary password.  
   - Depending on configuration, users may either choose their own password or automatically generate and reset it.  
   - Depending on configuration, setting or resetting a password may require the user’s primary ChurchTools password.  
2. The chosen or generated secondary password is sent to the PHP backend, where it is **asymmetrically encrypted**.  
3. The encrypted password is then stored back in the ChurchTools extension’s key‑value store.  
4. External IT systems that need access must authenticate against the backend’s REST API to retrieve the encrypted password (see [details here](./backend/README.md)).  

### 🔒 Encryption Details
We use a state‑of‑the‑art encryption procedure to protect secondary passwords:

- **Algorithm:** RSA  
- **Key size:** 4096 bits  
- **Padding:** OAEP (Optimal Asymmetric Encryption Padding)  
- **Hash function:** SHA‑256  

Because asymmetrical encryption is used, the **encryption key is never stored in ChurchTools nor in the PHP backend**. Even if ChurchTools or the PHP backend were compromised, secondary passwords remain secure. Only external IT systems holding the corresponding **private key locally** can decrypt and use the cleartext secondary password. Access is strictly restricted and read‑only, preventing any widespread security breach.

## 🤝 Contribution

We welcome contributions of all kinds!  
If you’ve discovered a bug, have an idea for improvement, or already prepared a fix, feel free to get involved.  

You can reach out and share your feedback or code either through:  
- [GitHub](https://github.com/lub90/)  
- [ChurchTools Forum](https://forum.church.tools/user/lubl)  

Together we can make this project stronger.

### Pre-commit check (secrets and private terms)

A repository hook refuses commits that add private or secret values. Enable it once per clone (no npm or composer
needed; it only sets `core.hooksPath` in the clone's `.git/config`):

```sh
sh scripts/install-hooks.sh      # or: git config core.hooksPath .githooks
```

`.githooks/pre-commit` runs `node scripts/check-private.mjs`, which checks **only the lines added in the staged diff**
(and the paths of the staged files) against:

- the local, gitignored block list **`.private-terms`** at the repository root: copy `.private-terms.example` and
  list one term per line (`#` comments; case-insensitive; spaces, dots, hyphens and underscores inside a term match any
  such separators or none). Intended occurrences get a path exception: `Some Term ## allow: LICENSE, specs/*.md`
  (globs on the repo-relative path; `*` within a directory, `**` across). Worth listing: the church's name and
  abbreviations, real person names, ChurchTools instance host names, e-mail addresses, phone numbers, addresses;
- the values in your local credential files, if present: `extension/.env` and `extension/.env.*` (values of 6 or
  more characters, plus the host name of URL values), the `<env value>`s of `backend/phpunit.xml`, and the
  pwd/password/token/secret/username fields of `backend/tests/Contract/fixtures/*.json`.

Harmless words that coincide with such values (`ctpassstore`, `churchtools`) never block. A hit prints only
`<file>:<line>: matches <source> entry #<n>` (the term's line in `.private-terms`, or the key and line in the credential
file), **never the value**; the commit is refused. Without `.private-terms` the hook prints a one-line hint and still
checks the credential files. If a `gitleaks` binary is on `PATH`, the hook also runs it on the staged changes with
`.gitleaks.toml` and `--redact`; otherwise it prints a one-line hint (CI runs gitleaks on the whole history anyway).

Other modes: `node scripts/check-private.mjs --range main..HEAD` (every line added by every commit in the range, also
lines a later commit removed again) and `--all` (every tracked file). Tests: `node --test 'scripts/*.test.mjs'`
(also run in CI, `.github/workflows/extension.yml`, job `private-check`).

**Emergency bypass:** `git commit --no-verify` skips the hook. It should be rare and deliberate: prefer fixing the line
or adding a reviewed `## allow:` exception; never bypass for a real credential.

## 📝 TODOs
- Add a README for contributors, explaining the architecture, the reasoning behind it and how to run the tests
- Implement "require current secondary password for password reset" on top of primary password option
- Implement service specific access rights depending on groups etc.
- Implement automatic key rotation mechanisms for the exentsion, backend and related services
- And many more: See TODOs in the README of the [PHP backend](./backend/README.md) and the [ChurchTools extension](./extension/README.md) for further detailed TODOs considering only one of both CtPassStore components

## 📜 License

This project is licensed under the [MIT License](https://opensource.org/licenses/MIT). See [LICENSE](LICENSE) file for further information.

## 🙌 Credits

Developed by Lukas with love for automation, SSO, and ChurchTools integration. Challenged, tested and companioned by Microsoft Copilot 🤝.


