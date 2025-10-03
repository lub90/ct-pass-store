<?php

declare(strict_types=1);

use Slim\App;
use Monolog\Logger;
use Monolog\Handler\StreamHandler;
use Dotenv\Dotenv;
use Psr\Container\ContainerInterface;
use CtPassStore\Service\ServiceSettings;
use CtPassStore\Service\ChurchtoolsAuth;


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
    $required = ['CT_API_TOKEN', 'CT_API_URL'];
    foreach ($required as $var) {
        if (empty($_ENV[$var])) {
            $logger = $container->get('logger');
            $logger->error("Missing required environment variable: $var");
            throw new RuntimeException("Environment variable '$var' is not set.");
        }
    }

    // Load the settings from churchtools and provide them to the stack
    $container->set(ServiceSettings::class, function () use ($container): ServiceSettings {
        $apiUrl = $_ENV['CT_API_URL'];
        $apiToken = $_ENV['CT_API_TOKEN'];
        return new ServiceSettings($apiUrl, $apiToken);
    });
    // Load the churchtools auth service
    $container->set(ChurchtoolsAuth::class, function () use ($container): ChurchtoolsAuth {
        $ctUrl = $_ENV['CT_API_URL'];
        return new ChurchtoolsAuth($ctUrl);
    });

    // Add the middlewares for Churchtools Authentication - registration order is inverse to call order
    $app->add(new \CtPassStore\Middleware\AuthMiddleware(
        $container->get(ChurchtoolsAuth::class),
        $container->get(Logger::class)
    ));
    
};
