# PHP Backend Setup

This setup guide assumes that the CtPassStore extension in your ChurchTools instance is at least partially configured. A partial setup means that all required data categories are already in place. If you arrived here through the CtPassStore setup process, these prerequisites have already been fulfilled and you can continue with the following steps.

## Create a ChurchTools User for the PHP Backend

The PHP backend requires a dedicated ChurchTools user account to access ChurchTools data.  

Create a new ChurchTools user with the following permissions:  
- **Category `passwordStore` of the CtPassStore extension**: Read, Write, and Delete entries
- **Category `settings` of the CtPassStore extension**: Read access

These rights must be assigned through the ChurchTools rights management system. The username for your user can be chosen freely, so pick something easy to recognize later on.

### Obtain the Login Token
1. Log in as the newly created user.  
2. Open your profile.  
3. Click **“Permissions” → “Login token”**.  
4. Copy the login token - you will need it later.

---

## Generate PHP Backend Files

Clone the CtPassStore repository (if not already done) from [https://github.com/lub90/ct-pass-store](https://github.com/lub90/ct-pass-store). Stable builds are available on the **main** branch. Then navigate into the backend directory and the setup directory. Inside the setup directory, run:

```bash
git clone https://github.com/lub90/ct-pass-store
cd ct-pass-store/backend/setup
./setup.sh
```

This script collects all required PHP files and places them into a separate folder, ready to be uploaded to your webhost or any other server running the backend.  

> **Note:** We use Composer for dependency management. Ensure Composer is installed and available in your system’s PATH. Otherwise, the setup script will abort with an error.

The script will first ask you to provide the path to an empty folder where the files can be stored. After that, it will copy all necessary files into this folder.

---

## Configure the PHP Backend

Before uploading to your hosting provider, you must configure the backend with the base URL of your ChurchTools instance and the login token of the API user you created earlier.

### Example `credentials.php`

```php
<?php

return [
    'CT_API_URL' => "https://your.church.tools/api",
    'CT_API_TOKEN' => "YOUR_CHURCHTOOLS_AUTH_TOKEN_FOR_YOUR_API_USER",

    // CORS must include at least the ChurchTools instance you put in CT_API_URL.
    // Otherwise, the ChurchTools extension will fail to access your PHP backend.
    'CORS' => [
       'https://your.church.tools'
    ]
];
```

### Explanation of Each Entry
- **CT_API_URL**: The base API endpoint of your ChurchTools instance, including the trailing `/api`.  
- **CT_API_TOKEN**: The login token of the ChurchTools API user you created.
- **CORS**: Defines which domains are allowed to access the backend. Since the PHP backend runs on a different server/URL than your ChurchTools instance, you must include your ChurchTools domain here so the extension can communicate properly with your PHP Backend.


---

## Upload to Your Hosting Service or Start the Server

Upload all files from the generated folder to your hosting provider. Configure your hosting so that the **`public/`** directory is set as the webroot.  

Additional requirements:  
- Block public read access to all files outside of `/public`.  
- Grant the webserver user write access to `logs/app.log`.  

> This setup already provides some guards regarding the above mentioned read access blocking. Yet, it only works for servers that respect `.htaccess` files (e.g., Apache). For Nginx, a different configuration approach is required (not yet tested).

Save the URL to your PHP backend. You need to insert it into the settings of your CtPassStore extension.

---

## Test Your PHP Backend

Once everything is set up, test your backend by calling the `/test` endpoint with valid credentials (see [general introduction to the PHP Backend](../README.md)). If everything is setup properly, you should receive a response similar to:

```json
{
    "summary": "All backend self-tests passed successfully.",
    "tests": [
        {
            "name": "credentials.php file permission check",
            "status": "fail",
            "message": "credentials.php file permissions too loose: 664. Expected 0600 or stricter."
        },
        {
            "name": "ServiceSettings::requirePasswordForPasswordChange()",
            "status": "ok",
            "message": "Settings object for requirePasswordForPasswordChange can be accessed."
        },
        {
            "name": "ServiceSettings::allowCustomPasswords()",
            "status": "ok",
            "message": "Settings object for allowCustomPasswords can be accessed."
        },
        {
            "name": "ServiceSettings::adminUsers()",
            "status": "ok",
            "message": "Settings object for adminUsers can be accessed."
        },
        {
            "name": "ServiceSettings::readAccessUsers()",
            "status": "ok",
            "message": "Settings object for readAccessUsers can be accessed."
        },
        {
            "name": "ServiceSettings::pwdLength()",
            "status": "ok",
            "message": "Settings object for pwdLength can be accessed."
        },
        {
            "name": "ServiceSettings::publicKey()",
            "status": "ok",
            "message": "Settings object for publicKey can be accessed."
        }
    ]
}
```

You can now continue with the remaining setup steps for your CtPassStore extension in Churchtools!