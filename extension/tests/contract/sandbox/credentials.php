<?php

declare(strict_types=1);

// The backend sandbox's configuration. It holds no values: everything comes from the environment the contract test
// gives the PHP process (tests/contract/backend-sandbox.ts), so no secret is ever written to a file.
$env = static fn (string $name): string => (string) getenv($name);

return [
    'CT_API_URL' => $env('CPS_SANDBOX_CT_API_URL'),
    'CT_API_TOKEN' => $env('CPS_SANDBOX_CT_API_TOKEN'),
    'CORS' => [$env('CPS_SANDBOX_CORS_ORIGIN')],
    'OAUTH_CLIENT_ID' => $env('CPS_SANDBOX_OAUTH_CLIENT_ID'),
    'OAUTH_CLIENT_SECRET' => $env('CPS_SANDBOX_OAUTH_CLIENT_SECRET'),
    'JWT_SECRET' => $env('CPS_SANDBOX_JWT_SECRET'),
];
