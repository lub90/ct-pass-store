<?php


return [
    'CT_API_URL' => "https://your.church.tools/api",
    'CT_API_TOKEN' => "YOUR_CHURCHTOOLS_AUTH_TOKEN_FOR_YOUR_API_USER",

    // CORS must include at least the CurchTools instance you put in CT_API_URL. Otherwise, the ChurchTools extension will fail.
    'CORS' => [
       'https://your.church.tools'
    ]
];

