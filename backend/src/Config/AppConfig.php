<?php

namespace CtPassStore\Config;

final class AppConfig
{
    public const CT_EXTENSION_ID = 'ct-pass-store';
    public const EXTERNAL_REQUEST_TIMEOUT = 5.0; // seconds

    public const USER_ATTRIBUTE = 'user';
    public const CT_USER_NAME_FIELD = 'cmsUserId';
    public const CT_USER_ID_FIELD = 'id';

    public const REQUEST_PRIMARY_PWD_FIELD = 'primaryPwd';
    public const REQUEST_SECONDARY_PWD_FIELD = 'secondaryPwd';
}
