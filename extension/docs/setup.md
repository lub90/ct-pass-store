# CtPassStore Extension Setup

Currently, there is no ready‑to‑use build of the CtPassStore extension (though this is planned for future releases). For now, the extension must be built locally and then uploaded to your ChurchTools instance. This setup guide walks you through the process of building and installing the CtPassStore extension.

## Build CtPassStore extension

Clone the CtPassStore repository (if not already done) from [https://github.com/lub90/ct-pass-store](https://github.com/lub90/ct-pass-store). Stable builds are available on the **main** branch.

Next, navigate into the extension directory. Inside the directory, run a package install, and then start the build process.


```bash
git clone https://github.com/lub90/ct-pass-store
cd ct-pass-store/extension/
npm install
npm run deploy
```

The `npm` commands will:

1. Install all necessary dependencies
2. Build the project
3. Package the extension to a zip file

You can find the extension package in the releases directory.

> **Note:** We use npm for dependency and build management. Ensure npm is installed and available in your system’s PATH. Otherwise, the above commands will fail with an error.

---

## Upload extension to your ChurchTools instance

Go to your ChurchTools instance and select **Extensions** from the system settings dropdown in the toolbar (tools icon). Then click **Add extension**.

Name the extension as you like, but keep in mind that this name will be visible to all users in the toolbar.  

Set the short identifier for the extension. **Important:** The short identifier must be set to `ctpassstore` for the extension to work properly.

You can also add a description if desired. For example, you might use something like:

    This third-party ChurchTools extension manages your secondary password. Your secondary password can be used to login to selected services connected to ChurchTools, such as Wi-Fi or network drives.

Subsequently, select a sorting index according to your preference.

Finally, drop the generated extension package (`*.zip` file) into the bottom area of the creation window and click **Save**.

## Setup CtPassStore extension

The extension should now appear in the ChurchTools toolbar. If it does not, try refreshing the page and/or clearing your browser cache.  

Click on the extension in the toolbar. A message will indicate that the extension is not yet set up correctly. To begin the setup, click **Run setup** in the message dialog or select **Setup** from the left-hand side menu bar.  

The setup wizard will guide you through configuring the CtPassStore extension, including all required data categories, custom settings, and installation of the necessary PHP backend.