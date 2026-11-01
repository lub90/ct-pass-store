<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Kv;

/**
 * Names in the extension's ChurchTools KV store (spec 5.3, 5.4). The extension's frontend uses the same names.
 */
final class KvSchema
{
    public const EXTENSION_KEY = 'ctpassstore';

    public const PASSWORD_CATEGORY = 'passwordStore';
    public const SETTINGS_CATEGORY = 'settings';
    public const ENCRYPTION_CATEGORY = 'encryptionSettings';

    /** Fields of a value in PASSWORD_CATEGORY. */
    public const ENTRY_PERSON_ID = 'personId';
    public const ENTRY_CIPHERTEXT = 'secondaryPwd';

    /** Fields of the value in SETTINGS_CATEGORY. */
    public const SETTING_REQUIRE_PRIMARY_PASSWORD = 'requirePasswordForPasswordChange';
    public const SETTING_ALLOW_CUSTOM_PASSWORD = 'allowCustomPassword';
    public const SETTING_PASSWORD_LENGTH = 'passwordLength';
    public const SETTING_ADMIN_USERS = 'adminUsers';
    public const SETTING_READ_ACCESS_USERS = 'readAccessUsers';
    public const SETTING_BACKEND_URL = 'backendUrl';
    public const SETTING_MACHINE_CLIENTS = 'machineClients';

    /** Field of the value in ENCRYPTION_CATEGORY. */
    public const PUBLIC_KEY = 'publicKey';
}
