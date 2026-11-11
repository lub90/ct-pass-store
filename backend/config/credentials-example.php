<?php

// Copy this file to credentials.php and fill in the values. Never commit credentials.php.
return [
    'CT_API_URL' => 'https://your.church.tools/api',
    'CT_API_TOKEN' => 'LOGIN_TOKEN_OF_THE_SERVICE_USER',

    // CORS must include at least the ChurchTools instance you put in CT_API_URL.
    // Otherwise, the ChurchTools extension will fail to access your PHP backend.
    'CORS' => [
        'https://your.church.tools',
    ],

    // From the OAuth application in ChurchTools (docs/setup.md, step 2).
    'OAUTH_CLIENT_ID' => 'CLIENT_ID_OF_THE_OAUTH_APPLICATION',
    'OAUTH_CLIENT_SECRET' => 'CLIENT_SECRET_OF_THE_OAUTH_APPLICATION',

    // At least 32 bytes. Generate one with: php -r 'echo bin2hex(random_bytes(32)), PHP_EOL;'
    'JWT_SECRET' => 'RANDOM_SECRET_OF_AT_LEAST_32_BYTES',

    // Optional: debug, info (default), notice, warning or error.
    // 'LOG_LEVEL' => 'info',
];
