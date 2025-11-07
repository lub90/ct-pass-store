<?php

declare(strict_types=1);

use Slim\App;
use Psr\Log\LoggerInterface;
use Monolog\Logger;
use Monolog\Handler\StreamHandler;
use Psr\Container\ContainerInterface;
use CtPassStore\Service\ServiceSettings;
use CtPassStore\Service\ChurchtoolsAuth;
use CtPassStore\Service\ChurchtoolsAuthVerifier;
use CtPassStore\Service\ChurchToolsStore;
use CtPassStore\Service\EncryptionService;
use CtPassStore\Service\PasswordValidator;


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

    // Load the settings from churchtools and provide them to the stack
    $container->set(ServiceSettings::class, function () use ($container, $credentials): ServiceSettings {
        $apiUrl = $credentials['CT_API_URL'];
        $apiToken = $credentials['CT_API_TOKEN'];
        $logger = $container->get(LoggerInterface::class);
        return new ServiceSettings($apiUrl, $apiToken, $logger);
    });
    // Load the churchtools auth service
    $container->set(ChurchtoolsAuth::class, function () use ($container, $credentials): ChurchtoolsAuth {
        $ctUrl = $credentials['CT_API_URL'];
        return new ChurchtoolsAuth($ctUrl);
    });

    // The AuthVerifier to check if provided passwords are valid
    $container->set(ChurchtoolsAuthVerifier::class, function () use ($container, $credentials): ChurchToolsAuthVerifier {
        $apiUrl = $credentials['CT_API_URL'];
        $logger = $container->get(LoggerInterface::class);
        return new ChurchtoolsAuthVerifier($apiUrl, $logger);
    });

    // The Encryption service
    $container->set(EncryptionService::class, function () use ($container, $credentials): EncryptionService {
        $serviceSettings = $container->get(ServiceSettings::class);
        $logger = $container->get(LoggerInterface::class);
        return new EncryptionService($serviceSettings, $logger);
    });

    // The password validation service
    $container->set(PasswordValidator::class, function () use ($container, $credentials): PasswordValidator {
        $logger = $container->get(LoggerInterface::class);
        return new PasswordValidator($logger);
    });

    // Register the binding to the entries backend in ChurchTools
    $container->set(ChurchToolsStore::class, function () use ($container, $credentials): ChurchToolsStore {
        $apiUrl = $credentials['CT_API_URL'];
        $apiToken = $credentials['CT_API_TOKEN'];
        $logger = $container->get(LoggerInterface::class);
        return new ChurchToolsStore($apiUrl, $apiToken, $logger);
    });


    // Add the middlewares for Churchtools Authentication - registration order is inverse to call order
    $app->add(new \CtPassStore\Middleware\AuthMiddleware(
        $container->get(ChurchtoolsAuth::class),
        $container->get(LoggerInterface::class)
    ));
    
};
