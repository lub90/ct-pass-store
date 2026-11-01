<?php

declare(strict_types=1);

use CtPassStore\ChurchTools\ChurchToolsClient;
use CtPassStore\ChurchTools\Credential;
use CtPassStore\ChurchTools\GuzzleChurchToolsClient;
use CtPassStore\Config\AppConfig;
use CtPassStore\Middleware\AuthMiddleware;
use CtPassStore\Middleware\CorsMiddleware;
use CtPassStore\Service\ChurchtoolsAuth;
use CtPassStore\Service\ChurchtoolsAuthVerifier;
use CtPassStore\Service\ChurchToolsStore;
use CtPassStore\Service\EncryptionService;
use CtPassStore\Service\ExtensionDataService;
use CtPassStore\Service\PasswordValidator;
use CtPassStore\Service\ServiceSettings;
use Monolog\Handler\StreamHandler;
use Monolog\Logger;
use Psr\Log\LoggerInterface;
use Slim\App;

return function (App $app): void {

    // Access DI container
    $container = $app->getContainer();

    // Load the credentials
    $credentials = require __DIR__ . '/../../config/credentials.php';

    // Register logger
    $container->set(LoggerInterface::class, function (): LoggerInterface {
        $logger = new Logger('ct-pass-store');
        $logPath = __DIR__ . '/../../logs/app.log';
        $logger->pushHandler(new StreamHandler($logPath, Logger::DEBUG));
        return $logger;
    });

    // The only way the backend talks to ChurchTools (spec 5.6)
    $container->set(ChurchToolsClient::class, function () use ($credentials): ChurchToolsClient {
        return new GuzzleChurchToolsClient(
            $credentials['CT_API_URL'],
            Credential::loginToken($credentials['CT_API_TOKEN']),
            AppConfig::EXTERNAL_REQUEST_TIMEOUT,
        );
    });

    // The extension's data in the ChurchTools KV store, as the service user
    $container->set(ExtensionDataService::class, function () use ($container): ExtensionDataService {
        return new ExtensionDataService($container->get(ChurchToolsClient::class), AppConfig::CT_EXTENSION_ID);
    });

    // Load the settings from churchtools and provide them to the stack
    $container->set(ServiceSettings::class, function () use ($container): ServiceSettings {
        return new ServiceSettings($container->get(ExtensionDataService::class), $container->get(LoggerInterface::class));
    });

    // Load the churchtools auth service
    $container->set(ChurchtoolsAuth::class, function () use ($container): ChurchtoolsAuth {
        return new ChurchtoolsAuth($container->get(ChurchToolsClient::class), $container->get(LoggerInterface::class));
    });

    // The AuthVerifier to check if provided passwords are valid
    $container->set(ChurchtoolsAuthVerifier::class, function () use ($container): ChurchToolsAuthVerifier {
        return new ChurchtoolsAuthVerifier($container->get(ChurchToolsClient::class), $container->get(LoggerInterface::class));
    });

    // The Encryption service
    $container->set(EncryptionService::class, function () use ($container): EncryptionService {
        $serviceSettings = $container->get(ServiceSettings::class);
        $logger = $container->get(LoggerInterface::class);
        return new EncryptionService($serviceSettings, $logger);
    });

    // The password validation service
    $container->set(PasswordValidator::class, function () use ($container): PasswordValidator {
        $logger = $container->get(LoggerInterface::class);
        return new PasswordValidator($logger);
    });

    // Register the binding to the entries backend in ChurchTools
    $container->set(ChurchToolsStore::class, function () use ($container): ChurchToolsStore {
        return new ChurchToolsStore($container->get(ExtensionDataService::class), $container->get(LoggerInterface::class));
    });

    // Add the middlewares for Churchtools Authentication - registration order is inverse to call order
    $app->add(new AuthMiddleware(
        $container->get(ChurchtoolsAuth::class),
        $container->get(LoggerInterface::class)
    ));

    // Add the middleware for CORS
    $app->add(new CorsMiddleware($credentials['CORS']));

};
