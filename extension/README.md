# Documentation for ct-pass-store extension



## TODO:
- Rename compiled version...
- Ugly approach in SetupProcessElements: public result: Promise<SetupProcessElementResult>|SetupProcessElementResult - Use two separate variables here and check later on...
- Remove old setup step classes and rename the setup step components to properly work...
- Dropdown für admins um auch für andere Ids setzen zu können
- Clean up component orders and folders etc.
- More thorougly check the state of the settings etc. when accessing everything... - e.g., is a PHP backend server set...
- Problem in the ProcessSetupItem component with dynamically adding new items --> resultPending is then read as undefined, even if it is not!
- Problem in the ProcessSetup compponent with dynamically adding new items or starting with an empty list --> Positive result message then shows up too early...
- Remove dependencies to angular etc....
- Change sidebar to automatically use the router components...

- Add the steps giving instruction to setup the backend as well as the step to test the backend connections
- Add comments
- Add public/procted etc. to the different functions in each class
- Add tests
- After the rights confirmation step check that the rights were assigned properly
- Test access to settings page with other users (should work, just to be sure...)

- Add types etc. to Extension data and synchronize with https://github.com/bensteUEM/ct-events-load/blob/ede2d1dad12d30ce182656365ac4f4bfe476f340/src/persistance.ts#L1:L205


- With the SetupCheckboxBox, once checked the next button will be enabled. If it is unchecked, the button won't be disabled... -> Fix that

- Add possibility to pull backup and reload backup

## Bugs/Wishes towards churchtools

- Schema Setting suddenly, stopped to work... I always receive a return { data: null } value as a return, even if the data is set correctly...
- Possibility to associate values with users, so that they are deleted, when the user is deleted or when the extension is deleted
- Possbility to check whether we have read access in general to a certain dataset. Not only specific to values... (via old API this is possible, but not via new one)
- No minus sign in extension key allowed --> suboptimal

# ChurchTools Extension Boilerplate

This project provides a boilerplate for building your own extension for [ChurchTools](https://www.church.tools).

## Getting Started

### Prerequisites

-   Node.js (version compatible with the project)
-   npm or yarn

### Installation

1. Clone the repository
2. Install dependencies:
    ```bash
    npm install
    ```

### Optional: Using Dev Container

This project includes a dev container configuration. If you use VS Code with the "Dev Containers" extension, you can:

1. Clone the repository
2. Open it in VS Code
3. Click the Remote Indicator in the bottom-left corner of VS Code status bar
4. Select "Reopen in Container"

The container includes the tools mentioned in the prerequisites pre-installed and also runs `npm install` on startup.

## Configuration

Copy `.env-example` to `.env` and fill in your data.

In the `.env` file, configure the necessary constants for your project. This file is included in `.gitignore` to prevent sensitive data from being committed to version control.

## Development and Deployment

### Development Server

Start a development server with hot-reload:

```bash
npm run dev
```

> **Note:** For local development, make sure to configure CORS in your ChurchTools
> instance to allow requests from your local development server
> (typically `http://localhost:5173`).
> This can be done in the ChurchTools admin settings under:
> "System Settings" > "Integrations" > "API" > "Cross-Origin Resource Sharing"
>
> If login works in Chrome but not in Safari, the issue is usually that Safari has stricter cookie handling:
> - Safari blocks `Secure; SameSite=None` cookies on `http://localhost` (Chrome allows them in dev).
> - Safari also blocks cookies if the API is on another domain (third‑party cookies).
>
> **Fix:**
> 1. Use a Vite proxy so API calls go through your local server (`/api → https://xyz.church.tools`). This makes cookies look first‑party.
> 2. Run your dev server with **HTTPS**. You can generate a local trusted certificate with [mkcert](https://github.com/FiloSottile/mkcert).
>
> With proxy + HTTPS, Safari will accept and store cookies just like Chrome.

### Building for Production

To create a production build:

```bash
npm run build
```

### Preview Production Build

To preview the production build locally:

```bash
npm run preview
```

### Deployment

To build and package your extension for deployment:

```bash
npm run deploy
```

This command will:

1. Build the project
2. Package it using the `scripts/package.js` script

You can find the package in the `releases` directory.

## API

Following endpoints are available. Permissions are possible per route. Types are documented in `ct-types.d.ts` (CustomModuleCreate, CustomModuleDataCategoryCreate, CustomModuleDataValueCreate)

GET `/custommodules` get all extensions  
GET `/custommodules/{extensionkey}` get an extensions by its key  
GET `/custommodules/{moduleId}` get an extension by its ID

GET `/custommodules/{moduleId}/customdatacategories`  
POST `/custommodules/{moduleId}/customdatacategories`  
PUT `/custommodules/{moduleId}/customdatacategories/{dataCategoryId}`  
DELETE `/custommodules/{moduleId}/customdatacategories/{dataCategoryId}`

GET `/custommodules/{moduleId}/customdatacategories/{dataCategoryId}/customdatavalues`  
POST `/custommodules/{moduleId}/customdatacategories/{dataCategoryId}/customdatavalues`  
PUT `/custommodules/{moduleId}/customdatacategories/{dataCategoryId}/customdatavalues/{valueId}`  
DELETE `/custommodules/{moduleId}/customdatacategories/{dataCategoryId}/customdatavalues/{valueId}`

## Support

For questions about the ChurchTools API, visit the [Forum](https://forum.church.tools).
