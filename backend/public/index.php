<?php

declare(strict_types=1);

// Autoload dependencies and classes
require __DIR__ . '/../vendor/autoload.php';

use Slim\Factory\AppFactory;
use DI\Container;

// Create a new dependency injection container
$container = new Container();
AppFactory::setContainer($container);

// Create the Slim app instance
$app = AppFactory::create();

// Load environment variables and configure dependencies
(require __DIR__ . '/../src/Config/bootstrap.php')($app);

// Register application routes
(require __DIR__ . '/../src/Controller/routes.php')($app);

// Run the Slim application
$app->run();
