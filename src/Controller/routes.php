<?php

declare(strict_types=1);

use Slim\App;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

use CtPassStore\Controller\PasswordController;
use CtPassStore\Service\ServiceSettings;
use CtPassStore\Service\ChurchToolsStore;
use CtPassStore\Service\EncryptionService;
use CtPassStore\Service\PasswordValidator;
use CtPassStore\Service\ChurchtoolsAuthVerifier;


return function (App $app): void {
    $container = $app->getContainer();
    $controller = new PasswordController(
        $container->get(ServiceSettings::class),
        $container->get(ChurchToolsStore::class),
        $container->get(EncryptionService::class),
        $container->get(PasswordValidator::class),
        $container->get(ChurchtoolsAuthVerifier::class)
    );

    $app->put('/entries/{id}', [$controller, 'put']);
    $app->delete('/entries/{id}', [$controller, 'delete']);
};
