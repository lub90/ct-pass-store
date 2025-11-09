<?php

namespace CtPassStore\Config;

final class AppConfig
{
    public const CT_EXTENSION_ID = 'ctpassstore';
    public const CT_PWD_CATEGORY_NAME = 'passwordStore';
    public const CT_SETTINGS_CATEGORY_NAME = 'settings';
    public const CT_ENCRYPTION_SETTINGS_CATEGORY_NAME = 'encryptionSettings';
    public const CT_ENCRYPTED_PWD_FIELD = 'secondaryPwd';
    public const EXTERNAL_REQUEST_TIMEOUT = 5.0; // seconds

    // TODO: should be able to remove them later on
    public const USER_ATTRIBUTE = 'user';
    public const CT_USER_NAME_FIELD = 'cmsUserId';
    public const CT_PERSON_ID_FIELD = 'id';
    public const CT_USER_ID_FIELD = 'id';

    public const REQUEST_PRIMARY_PWD_FIELD = 'primaryPwd';
    public const REQUEST_SECONDARY_PWD_FIELD = 'secondaryPwd';
}
