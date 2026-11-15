<?php

declare(strict_types=1);

// Test-only entry point of the backend sandbox (extension contract tests, tests/contract/backend-sandbox.ts).
// PHP's built-in server speaks plain HTTP on 127.0.0.1; in production a TLS terminator (Apache with .htaccess, a
// proxy) sets HTTPS=on. This router plays that part, so the backend's own HTTPS check passes; the extension's client
// still talks to an https:// address, mapped to this server by the test transport.
//
// It wires the backend as Kernel::bootstrap() does, except that the ChurchTools client is wrapped in
// SandboxChurchTools: the settings variant and admin group of this sandbox (from the environment) replace the
// instance's values in what the backend reads, never in ChurchTools.
$_SERVER['HTTPS'] = 'on';
ini_set('display_errors', '0');

$backend = getenv('CPS_SANDBOX_BACKEND_DIR');
$cache = getenv('CPS_SANDBOX_CACHE_DIR');
if (!is_string($backend) || $backend === '' || !is_string($cache) || $cache === '') {
    http_response_code(500);
    exit;
}

require $backend . '/vendor/autoload.php';
require_once __DIR__ . '/SandboxChurchTools.php';

$credentials = __DIR__ . '/credentials.php';
try {
    $config = CtPassStore\Config\BackendConfig::fromArray(require $credentials, $credentials, $cache);
} catch (CtPassStore\Application\Exception\ConfigurationException $e) {
    CtPassStore\Kernel::misconfigured($e->getMessage())->run();
    exit;
}
try {
    $churchTools = CtPassStore\ContractSandbox\SandboxChurchTools::wrap(
        new CtPassStore\Infrastructure\ChurchTools\GuzzleChurchToolsClient($config->apiUrl, CtPassStore\Infrastructure\ChurchTools\Credential::loginToken($config->apiToken)),
        getenv(),
    );
} catch (InvalidArgumentException) {
    // A malformed override: the sandbox doesn't start (the readiness check wants a 404).
    http_response_code(500);
    exit;
}
$logger = CtPassStore\Kernel::logger(dirname($cache) . '/logs/app.log', $config->logLevel, CtPassStore\Infrastructure\Version::current($backend));
CtPassStore\Kernel::create($config, $churchTools, $logger)->run();
