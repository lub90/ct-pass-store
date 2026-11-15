# CtPassStore Extension Setup

> **State of version 0.1.0:** the extension's new **setup and migration assistant** is not built yet. Without it, a
> new installation can't be set up and an existing one can't be migrated to the new data layout. Version 0.1.0 is
> therefore **not released** until the assistant exists (its own spec, together with the backend's `/v1/setup`).
> Keep running your current version until then. This guide describes what already works: getting the extension's
> ZIP and uploading it.

## Get the extension package

**From a release** (once one is published): the GitHub release `extension-vX.Y.Z` of
[lub90/ct-pass-store](https://github.com/lub90/ct-pass-store/releases) has `ctpassstore-extension-X.Y.Z.zip` and its
checksum `ctpassstore-extension-X.Y.Z.zip.sha256`. Check the download before uploading it:

```sh
sha256sum --check ctpassstore-extension-X.Y.Z.zip.sha256
# Stronger: proves the ZIP was built by the release workflow from that tag (GitHub CLI, logged in).
gh attestation verify ctpassstore-extension-X.Y.Z.zip --repo lub90/ct-pass-store \
  --signer-workflow lub90/ct-pass-store/.github/workflows/extension-release.yml \
  --source-ref refs/tags/extension-vX.Y.Z
```

**Built yourself** (development and test instances): with Node.js 24 and npm,

```sh
git clone https://github.com/lub90/ct-pass-store
cd ct-pass-store/extension/
npm ci
npm run deploy
```

`npm run deploy` builds the extension, checks the build (`scripts/check-dist.js`) and writes the ZIP to
`extension/releases/`.

Install backend and extension with the same first two version numbers (extension `0.1.x` with backend `0.1.x`; see
[`specs/versioning.md`](../../specs/versioning.md)). The backend is installed by hand, see
[`backend/docs/setup.md`](../../backend/docs/setup.md).

## Upload the extension to ChurchTools

1. In ChurchTools, open **Extensions** from the system settings menu in the toolbar (tools icon) and click **Add
   extension** (or open the existing CtPassStore extension to update it).
2. Name the extension as you like; everyone sees the name in the toolbar.
3. Set the short identifier to **`ctpassstore`**. The extension works only under this key (its pages live under
   `/ccm/ctpassstore/`).
4. Optionally add a description, for example: "Your secondary password for services connected to ChurchTools, such as
   the Wi-Fi."
5. Drop the ZIP into the upload area and click **Save**.

Updating an extension in ChurchTools keeps its stored data.

## After the upload

Open the extension from the toolbar. Until the setup assistant exists:

- On a new installation, and on an installation of an earlier version (old data layout), everyone sees „Die
  Erweiterung wird gerade eingerichtet“; people with the rights to set it up also see that the setup assistant
  sets it up and isn't available yet. Nothing is changed in ChurchTools.
- The settings, the admin group and the machine clients can only be managed once the extension's data (`settings`
  with the backend address and the OAuth client ID, and `access` with the role groups) exists. Writing them is the
  assistant's job; its spec also defines the rights each group gets (extension spec section 16).

What the extension's pages do once it is set up is described in the [user guide](user-guide.md).
