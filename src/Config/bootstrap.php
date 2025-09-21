<?php

declare(strict_types=1);

use Slim\App;
use Monolog\Logger;
use Monolog\Handler\StreamHandler;
use Dotenv\Dotenv;
use Psr\Container\ContainerInterface;

return function (App $app): void {

    // Load environment variables
    $dotenv = Dotenv::createImmutable(__DIR__ . '/../../');
    $dotenv->load();

    // Access DI container
    $container = $app->getContainer();

    // Register logger
    $container->set('logger', function (): Logger {
        $logger = new Logger('ct-pass-store');
        $logPath = __DIR__ . '/../../logs/app.log';
        $logger->pushHandler(new StreamHandler($logPath, Logger::DEBUG));
        return $logger;
    });

    // Validate required environment variables
    $required = ['DB_DSN', 'DB_USER', 'DB_PASS'];
    foreach ($required as $var) {
        if (empty($_ENV[$var])) {
            $logger = $container->get('logger');
            $logger->error("Missing required environment variable: $var");
            throw new RuntimeException("Environment variable '$var' is not set.");
        }
    }

    // Register PDO database connection
    $container->set('db', function () use ($container): PDO {
        $dsn = $_ENV['DB_DSN'];
        $user = $_ENV['DB_USER'];
        $pass = $_ENV['DB_PASS'];

        try {
            $pdo = new PDO($dsn, $user, $pass, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            ]);
            return $pdo;
        } catch (PDOException $e) {
            $container->get('logger')->error('Database connection failed: ' . $e->getMessage());
            throw new RuntimeException('Failed to connect to database.');
        }
    });

    // Add the middlewares for IP-Filtering and Authentication - registration order is inverse to call order
    $logger = $container->get('logger');

    $ctUrl = $_ENV['CT_API_URL'];
    $ctAuth = new \CtPassStore\Service\ChurchtoolsAuth($ctUrl);
    $app->add(new \CtPassStore\Middleware\AuthMiddleware($ctAuth, $logger));

    $allowed = explode(',', $_ENV['ALLOWED_IPS'] ?? '');
    $app->add(new \CtPassStore\Middleware\IPFilter($allowed, $logger));

    
};
