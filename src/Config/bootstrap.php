<?php

declare(strict_types=1);

use Slim\App;
use Monolog\Logger;
use Monolog\Handler\StreamHandler;
use Dotenv\Dotenv;
use Psr\Container\ContainerInterface;
use CtPassStore\Service\ServiceSettings;
use CtPassStore\Service\ChurchtoolsAuth;
use CtPassStore\Service\ChurchtoolsAuthVerifier;
use CtPassStore\Service\ChurchToolsStore;


return function (App $app): void {

    // Load environment variables
    $dotenv = Dotenv::createImmutable(__DIR__ . '/../../');
    $dotenv->load();

    // Access DI container
    $container = $app->getContainer();

    // Register logger
    $container->set(Logger::class, function (): Logger {
        $logger = new Logger('ct-pass-store');
        $logPath = __DIR__ . '/../../logs/app.log';
        $logger->pushHandler(new StreamHandler($logPath, Logger::DEBUG));
        return $logger;
    });

    // Validate required environment variables
    $required = ['CT_API_URL', 'CT_API_TOKEN'];
    foreach ($required as $var) {
        if (empty($_ENV[$var])) {
            $logger = $container->get(Logger::class);
            $logger->error("Missing required environment variable: $var");
            throw new RuntimeException("Environment variable '$var' is not set.");
        }
    }

    // Load the settings from churchtools and provide them to the stack
    $container->set(ServiceSettings::class, function () use ($container): ServiceSettings {
        $apiUrl = $_ENV['CT_API_URL'];
        $apiToken = $_ENV['CT_API_TOKEN'];
        $logger = $container->get(Logger::class);
        return new ServiceSettings($apiUrl, $apiToken, $logger);
    });
    // Load the churchtools auth service
    $container->set(ChurchtoolsAuth::class, function () use ($container): ChurchtoolsAuth {
        $ctUrl = $_ENV['CT_API_URL'];
        return new ChurchtoolsAuth($ctUrl);
    });

    // The AuthVerifier to check if provided passwords are valid
    $container->set(ChurchtoolsAuthVerifier::class, function () use ($container): ChurchToolsAuthVerifier {
        $apiUrl = $_ENV['CT_API_URL'];
        $logger = $container->get(Logger::class);
        return new ChurchtoolsAuthVerifier($apiUrl, $logger);
    });

    // Register the binding to the entries backend in ChurchTools
    $container->set(ChurchToolsStore::class, function () use ($container): ChurchToolsStore {
        $apiUrl = $_ENV['CT_API_URL'];
        $apiToken = $_ENV['CT_API_TOKEN'];
        $logger = $container->get(Logger::class);
        return new ChurchToolsStore($apiUrl, $apiToken, $logger);
    });


    // Add the middlewares for Churchtools Authentication - registration order is inverse to call order
    $app->add(new \CtPassStore\Middleware\AuthMiddleware(
        $container->get(ChurchtoolsAuth::class),
        $container->get(Logger::class)
    ));
    
};
