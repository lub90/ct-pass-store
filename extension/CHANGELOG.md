# Changelog

All notable changes to the extension are documented here, in the style of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - Unreleased

A rework from the ground up. Install backend and extension with the same first two version numbers: this extension
works with backend `0.1.x`.

### Changed

- **New design** that fits into ChurchTools: one card for your own password, a sidebar for admins (a menu at the top on
  a phone), light and dark mode as in ChurchTools, and every page works on a phone.
- **Login through ChurchTools.** The extension logs in to the backend with your ChurchTools account (OAuth). It no
  longer hands your ChurchTools login token to the backend.
- **Admins through a group.** Whoever is a member of the admin group in ChurchTools is an admin of the extension; the
  list of admin users in the settings is gone. Admins set or delete the passwords of other people („Passwörter
  verwalten“) and change the settings.
- **Both languages.** The extension speaks German and English, following the languages set in your browser (English if
  it lists neither). Title and explanation of the password card can be set per language („Einstellungen“ →
  „Texte“).
- **Settings on pages of their own:** password rules, texts, access (admin group and machine clients such as
  ct-radius), and backend & status with a self-test.
- **The minimum password length is now 12 characters.** Existing passwords keep working, shorter ones too: nobody has
  to do anything. If your password is shorter than 12 characters, you may want to set a new one („Mein Passwort“ →
  „Neues Passwort festlegen“).

### Updating from an earlier version

- Update the backend to `0.1.x` as well; its CHANGELOG lists what changes there.
- The extension stores its data in a new layout. Moving existing data into it, and setting up a new installation, is
  the job of the setup and migration assistant, which isn't part of this version yet: this version is released only
  together with it. Until the data is migrated, everyone who can't run the migration sees „Die Erweiterung wird
  gerade eingerichtet“.
