<?php

declare(strict_types=1);

// Test-only entry point of the backend sandbox (extension contract tests, tests/contract/backend-sandbox.ts).
// PHP's built-in server speaks plain HTTP on 127.0.0.1; in production a TLS terminator (Apache with .htaccess, a
// proxy) sets HTTPS=on. This router plays that part, so the backend's own HTTPS check passes; the extension's client
// still talks to an https:// address, mapped to this server by the test transport.
$_SERVER['HTTPS'] = 'on';
ini_set('display_errors', '0');

$backend = getenv('CPS_SANDBOX_BACKEND_DIR');
$cache = getenv('CPS_SANDBOX_CACHE_DIR');
if (!is_string($backend) || $backend === '' || !is_string($cache) || $cache === '') {
    http_response_code(500);
    exit;
}

require $backend . '/vendor/autoload.php';

CtPassStore\Kernel::bootstrap(__DIR__ . '/credentials.php', $cache, dirname($cache) . '/logs/app.log')->run();
