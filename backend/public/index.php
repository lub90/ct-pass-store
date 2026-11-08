<?php

declare(strict_types=1);

// PHP warnings and notices go to the server log, never into a response (spec 4.1).
ini_set('display_errors', '0');

require __DIR__ . '/../vendor/autoload.php';

CtPassStore\Application::bootstrap(
    __DIR__ . '/../config/credentials.php',
    __DIR__ . '/../cache',
    __DIR__ . '/../logs/app.log',
)->run();
