export class AppConfig {
    // Extension metadata
    static readonly EXTENSION_KEY = 'organigramm'
    /**
     * Returns the base URL prefix for the extension, e.g. "/ccm/organigramm"
     */
    static getExtensionUrlPrefix(): string {
        return `/ccm/${this.EXTENSION_KEY}`;
    }


    static readonly SETTINGS_CATEGORY = 'settings';
    static readonly SETTINGS_CATEGORY_SHORTY = 'sett';
    static readonly SETTINGS_SCHEMA = `
            {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "title": "Extension Settings",
            "type": "object",
            "properties": {
                "requirePasswordForPasswordChange": {
                    "type": "boolean",
                    "description": "Whether password change requires entering the old password"
                },
                "allowCustomPassword": {
                    "type": "boolean",
                    "description": "Whether users are allowed to set custom passwords (true) or can only reset their password (false)"
                },
                "adminUsers": {
                    "type": "array",
                    "items": {
                        "type": "integer",
                        "minimum": 1
                    },
                    "description": "List of user IDs with admin privileges"
                },
                "passwordLength": {
                    "type": "integer",
                    "minimum": 8,
                    "description": "Minimum required password length"
                },
                "backendUrl": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Backend URL for password operations"
                }
            },
            "required": [
                "requirePasswordForPasswordChange",
                "allowCustomPassword",
                "adminUsers",
                "passwordLength",
                "backendUrl"
            ],
            "additionalProperties": false
            }

            `;

    static readonly ENCRYPTION_SETTINGS_CATEGORY = 'encryptionSettings';
    static readonly ENCRYPTION_SETTINGS_CATEGORY_SHORTY = 'eSett';
    static readonly ENCRYPTION_SETTINGS_SCHEMA = `
        {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "Encryption Settings",
        "type": "object",
        "properties": {
            "publicKey": {
                "type": "string",
                "minLength": 1,
                "description": "Public key used for encryption or verification"
            }
        },
        "required": ["publicKey"],
        "additionalProperties": false
        }
        `;

    static readonly SETUP_COMPLETED_CATEGORY = 'setupCompleted';
    static readonly SETUP_COMPLETED_CATEGORY_SHORTY = 'sComp';
    static readonly SETUP_COMPLETED_SCHEMA = `
        {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "Internal Settings",
        "type": "object",
        "properties": {
            "setupCompleted": {
                "type": "boolean",
                "description": "Indicates whether the setup process has been completed"
            }
        },
        "required": ["setupCompleted"],
        "additionalProperties": false
        }
        `;


    static readonly PASSWORD_STORE_CATEGORY = 'passwordStore';
    static readonly PASSWORD_STORE_CATEGORY_SHORTY = 'pwdSt';
    static readonly PASSWORD_STORE_SCHEMA = `
            {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "title": "Password Store Entry",
            "type": "object",
            "properties": {
                "id": {
                "type": "integer",
                "minimum": 1,
                "description": "Unique positive identifier for the person to whom this password  belongs to."
                },
                "secondaryPwd": {
                "type": "string",
                "minLength": 1,
                "description": "Secondary password (encrypted, must not be empty)"
                }
            },
            "required": ["id", "secondaryPwd"],
            "additionalProperties": false
            }
            `;

    // Routing
    static readonly DEFAULT_ROUTE = 'password';
}
