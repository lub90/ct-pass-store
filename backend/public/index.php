<?php

declare(strict_types=1);

// PHP warnings and notices go to the server log, never into a response (spec 4.1).
ini_set('display_errors', '0');

require __DIR__ . '/../vendor/autoload.php';

use CtPassStore\Application;
use CtPassStore\ChurchTools\Credential;
use CtPassStore\ChurchTools\GuzzleChurchToolsClient;
use CtPassStore\Config\AppConfig;
use CtPassStore\Config\BackendConfig;
use CtPassStore\Exception\ConfigurationException;
use Monolog\Handler\StreamHandler;
use Monolog\Logger;

$credentialsPath = __DIR__ . '/../config/credentials.php';

try {
    if (!is_readable($credentialsPath)) {
        throw new ConfigurationException('config/credentials.php is missing or not readable by PHP.');
    }
    $config = BackendConfig::fromArray(require $credentialsPath, $credentialsPath);
} catch (ConfigurationException $e) {
    // Without a valid configuration there's no trustworthy logger either; PHP's error log is the fallback.
    error_log('ctpassstore: misconfigured: ' . $e->getMessage());
    Application::misconfigured($e->getMessage())->run();

    return;
}

$logger = new Logger('ct-pass-store');
$logger->pushHandler(new StreamHandler(__DIR__ . '/../logs/app.log', Logger::toMonologLevel($config->logLevel)));

$churchTools = new GuzzleChurchToolsClient(
    $config->apiUrl,
    Credential::loginToken($config->apiToken),
    AppConfig::EXTERNAL_REQUEST_TIMEOUT,
);

Application::create($config, $churchTools, $logger)->run();
