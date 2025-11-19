<?php

namespace CtPassStore\Config;

final class AppConfig
{
    public const CT_EXTENSION_ID = 'ctpassstore';
    public const CT_PWD_CATEGORY_NAME = 'passwordStore';
    public const CT_SETTINGS_CATEGORY_NAME = 'settings';

    public const CT_ALLOW_CUSTOM_PASSWORD_FIELD_NAME = 'allowCustomPassword';

    public const CT_REQUIRE_PWD_FOR_PWD_CHANGE_FIELD_NAME = 'requirePasswordForPasswordChange';


    public const CT_ENCRYPTION_SETTINGS_CATEGORY_NAME = 'encryptionSettings';

    public const CT_PUBLIC_KEY_FIELD_NAME = 'publicKey';
    public const CT_ENCRYPTED_PWD_FIELD = 'secondaryPwd';
    public const CT_PERSON_ID_PWD_FIELD = 'personId';
    public const EXTERNAL_REQUEST_TIMEOUT = 5.0; // seconds

    public const PERMISSIONS_ENDPOINT = 'permissions/global';

    // TODO: should be able to remove them later on
    public const USER_ATTRIBUTE = 'user';
    public const CT_USER_NAME_FIELD = 'cmsUserId';
    public const CT_USER_ID_FIELD = 'id';

    // TODO: Is the same as CT_PERSON_ID_PWD_FIELD
    public const REQUEST_PRIMARY_PWD_FIELD = 'primaryPwd';

    // TODO: This is also a response field. Rename ist - is also the same as CT_ENCRUPTED_PWD_FIELD
    public const REQUEST_SECONDARY_PWD_FIELD = 'secondaryPwd';
}
