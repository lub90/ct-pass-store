# CtPassStore Extension

The extension part of the project builds upon the official boilerplate code from [ChurchTools](https://www.church.tools) (see [https://github.com/churchtools/extension-boilerplate](https://github.com/churchtools/extension-boilerplate)). Thus, it is based on the offical ChurchTools extension interface.

## Setup

The setup of the CtPassStore extension, including the PHP backend is descriped [here](./docs/setup.md).

## Settings

The CtPassStore extension provides several configuration options to control how secondary passwords are managed and who has access to them. These settings can be adjusted in the extension’s settings form.

---

### Settings Overview

#### Require Primary Password
- **Option:** `Require primary password for secondary password change`
- **Description:** When enabled, users must enter their primary ChurchTools password before changing their secondary password.  
- **Default:** Enabled (`true`)

---

#### Allow Custom Passwords
- **Option:** `Allow custom passwords`
- **Description:**  
  - If enabled, users can choose their own secondary passwords.  
  - If disabled, passwords are generated automatically and can only be reset by the users themselves.  
- **Default:** Enabled (`true`)

---

#### Administrator User IDs
- **Option:** `Admin user IDs (comma-separated)`
- **Description:** Administrators listed here can read, set, and reset secondary passwords for other users.  
- **Important:** This is a critical role. Assign carefully, as it grants elevated rights.  
- **Format:** Comma-separated list of ChurchTools user IDs.

---

#### Read-Access User IDs
- **Option:** `Read access user IDs (comma-separated)`
- **Description:** Read-access users can view secondary passwords of other users.  
- **Typical Use Case:** Third-party systems that require cleartext passwords (e.g., challenge-response authentication).  
- **Format:** Comma-separated list of ChurchTools user IDs.

---

#### Minimum Password Length
- **Option:** `Minimum password length`
- **Description:** Defines the minimum length for secondary passwords.  
- **Requirement:** Must be greater than 8 characters.  
- **Default:** `12`

*Hint: Besides the password length, CtPassStore requires other characteristics for secure, secondary passwords - like letters, numbers and special characters to be included. For further information see the [PHP Backend Documentation](../backend/README.md).*

---

#### PHP Backend URL
- **Option:** `PHP Backend URL`
- **Description:** Specifies the URL of the PHP backend used by the extension.  
- **Requirement:** Must include the full URL, starting with `https://...`.


## Roles and Rights Management

There are different roles with respect to the CtPassStore extension:

- **Normal users**: These users simply use the extension to set their secondary password for other services. They can only set and read their own (encrypted) password. Yet, because the password is encrypted, it cannot be shown to them anymore, once set.
- **Read-access users**: These users have access to all encrypted passwords, but they need the private key to decrypt them. Read-access users are typically third-party systems that require a cleartext password (e.g., for challenge-response authentication) and store the private key for decryption internally. Read-access users can be configured in the extension’s settings page via their ChurchTools user ID.
- **Administrators**: There are two types of administrator roles:
  1. Administrators who are allowed to set secondary passwords for other users (not only themselves). This is a very critical role, so use it carefully. It may be necessary, for example, when transitioning from a previous secondary password system. These administrators have the same rights in the ChurchTools Rights Management as normal users and read-access users. This role is defined in the extension’s settings page under "Adming users".
  2. Administrators who configure the extension’s settings. This type of administrators needs its own role and access rights in the ChurchTools Rights Management.
- **PHP backend user**: This role should only be assigned to one user (the backend user). It also requires specific rights in ChurchTools.

---

### Rights for Different User Roles

The following rights must be set for the different user types in ChurchTools' right management system.

#### Normal users, Read-access users and Administrators (type 1)

- **View Extension**: Enable the user to view the CtPassStore extension.
- **View Custom Category**: Enable the user to view `settings`, `setupCompleted`
- **View Custom Data**: Enable the user to view data in `settings`, `setupCompleted`
- **Create Custom Data**: No access required.
- **Edit Custom Data**: No access required.
- **Delete Custom Data**: No access required.

---

#### Administrators of the extension (type 2)

- **View Extension**: Enable the user to view the CtPassStore extension.
- **View Custom Category**: Enable the user to view `settings`, `setupCompleted`
- **View Custom Data**: Enable the user to view data in `settings`, `setupCompleted`
- **Create Custom Data**: Enable the user to create data in `settings`
- **Edit Custom Data**: Enable the user to edit data in `settings`
- **Delete Custom Data**: Enable the user to delete data in `settings`

---

#### PHP backend user

- **View Extension**: Enable the user to view the CtPassStore extension.
- **View Custom Category**: Enable the user to view `passwordStore`, `encryptionSettings`, `settings`
- **View Custom Data**: Enable the user to view data in `passwordStore`, `encryptionSettings`, `settings`
- **Create Custom Data**: Enable the user to create data in `passwordStore`
- **Edit Custom Data**: Enable the user to edit data in `passwordStore`
- **Delete Custom Data**: Enable the user to delete data in `passwordStore`


## TODOs

### Builds & Packaging
- Provide stable builds for the CtPassStore extension.
- Rename compiled version for clarity.
- Add language settings.

### Settings Validation
- Ensure the PHP Backend URL is set to a valid format.
- Validate other input fields in settings (e.g., confirm that given user IDs actually exist).
- More thoroughly check the state of the settings when accessing them (e.g., verify that a PHP backend server is configured).

### Setup & Initialization
- Provide the `setupCompleted` result through the root component to other components (e.g., SetupGuard, PasswordView) to easily check whether setup has been completed without any overhead.
- Separate basic setup code logic in separate repository for reuse in other extensions.
- Fix `SetupCheckboxBox`: once checked, the next button is enabled, but if unchecked, the button should be disabled.

### UI & UX Improvements
- Adjust color scheme to fit ChurchTools (e.g., background of main app part).
- Make sidebar collapse on horizontally oriented screens.
- Check how the extension looks inside the ChurchTools app.
- Primary and Secondary Password labels on the password management page are not horizontally centered — fix alignment.
- Change sidebar to automatically use router components.
- Dropdown for admins to set passwords for other IDs.
- Enable retry button (and implement it) for the TestBackend step in the SetupProcess.

### Code Quality & Refactoring
- Improve `SetupProcessElements`: currently uses `public result: Promise<SetupProcessElementResult> | SetupProcessElementResult`. Use two separate variables instead.
- Problem in `ProcessSetupItem` component with dynamically adding new items → `resultPending` is read as undefined even when it is not.
- Problem in `ProcessSetup` component with dynamically adding new items or starting with an empty list → positive result message shows up too early.
- Remove dependencies on Angular.
- Add comments throughout the codebase.
- Add `public`/`protected` modifiers to functions in each class.
- Fix inconsistent/unnecessary use of ";"
- Add tests for reliability.
- After the rights confirmation step, verify that rights were assigned properly.
- Test access to the settings page with other users (should work, but confirm).
- Add types to ExtensionData class and synchronize with [ct-events-load persistence.ts](https://github.com/bensteUEM/ct-events-load/blob/ede2d1dad12d30ce182656365ac4f4bfe476f340/src/persistance.ts#L1-L205).
- Clean up component order and folder structure.

### Backup & Restore
- Add functionality to pull backups and reload backups.
