<?php

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use CtPassStore\Application;
use CtPassStore\ChurchTools\Credential;
use CtPassStore\ChurchTools\GuzzleChurchToolsClient;
use CtPassStore\Config\AppConfig;
use CtPassStore\Config\BackendConfig;
use Monolog\Handler\StreamHandler;
use Monolog\Logger;

$credentialsPath = __DIR__ . '/../config/credentials.php';
$config = BackendConfig::fromArray(require $credentialsPath, $credentialsPath);

$logger = new Logger('ct-pass-store');
$logger->pushHandler(new StreamHandler(__DIR__ . '/../logs/app.log', Logger::DEBUG));

$churchTools = new GuzzleChurchToolsClient(
    $config->apiUrl,
    Credential::loginToken($config->apiToken),
    AppConfig::EXTERNAL_REQUEST_TIMEOUT,
);

Application::create($config, $churchTools, $logger)->run();
