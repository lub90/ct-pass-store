<?php

declare(strict_types=1);

namespace CtPassStore;

use CtPassStore\ChurchTools\ChurchToolsClient;
use CtPassStore\Config\AppConfig;
use CtPassStore\Config\BackendConfig;
use CtPassStore\Controller\PasswordController;
use CtPassStore\Controller\TestController;
use CtPassStore\Middleware\AuthMiddleware;
use CtPassStore\Middleware\CorsMiddleware;
use CtPassStore\Service\ChurchtoolsAuth;
use CtPassStore\Service\ChurchToolsAuthVerifier;
use CtPassStore\Service\ChurchToolsStore;
use CtPassStore\Service\EncryptionService;
use CtPassStore\Service\ExtensionDataService;
use CtPassStore\Service\PasswordValidator;
use CtPassStore\Service\ServiceSettings;
use DI\Container;
use Psr\Log\LoggerInterface;
use Slim\App;
use Slim\Factory\AppFactory;

/**
 * Builds the Slim app.
 *
 * Configuration, the ChurchTools client and the logger are passed in, so `public/index.php` can use the real ones
 * and the API tests a fake ChurchTools (spec 6.6, plan item 2.0).
 */
final class Application
{
    /**
     * @return App<Container>
     */
    public static function create(BackendConfig $config, ChurchToolsClient $churchTools, LoggerInterface $logger): App
    {
        $container = new Container();
        $container->set(LoggerInterface::class, $logger);
        $container->set(ChurchToolsClient::class, $churchTools);

        $extensionData = new ExtensionDataService($churchTools, AppConfig::CT_EXTENSION_ID);
        $settings = new ServiceSettings($extensionData, $logger);

        /** @var App<Container> $app */
        $app = AppFactory::createFromContainer($container);

        $passwords = new PasswordController(
            $settings,
            new ChurchToolsStore($extensionData, $logger),
            new EncryptionService($settings, $logger),
            new PasswordValidator($logger),
            new ChurchToolsAuthVerifier($churchTools, $logger),
            $logger,
        );
        $app->get('/entries/{id}', [$passwords, 'get']);
        $app->put('/entries/{id}', [$passwords, 'put']);
        $app->delete('/entries/{id}', [$passwords, 'delete']);

        $selfCheck = new TestController($settings, $logger, $config->credentialsPath);
        $app->get('/test', [$selfCheck, 'get']);

        // Registration order is the reverse of the call order: CORS runs first, then authentication.
        $app->add(new AuthMiddleware(new ChurchtoolsAuth($churchTools, $logger), $logger));
        $app->add(new CorsMiddleware($config->corsOrigins));

        return $app;
    }
}
