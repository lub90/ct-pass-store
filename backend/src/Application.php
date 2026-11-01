<?php

declare(strict_types=1);

namespace CtPassStore;

use CtPassStore\ChurchTools\ChurchToolsClient;
use CtPassStore\Config\AppConfig;
use CtPassStore\Config\BackendConfig;
use CtPassStore\Controller\PasswordController;
use CtPassStore\Controller\TestController;
use CtPassStore\Http\Problem\ProblemResponseFactory;
use CtPassStore\Http\Problem\ProblemType;
use CtPassStore\Middleware\AuthMiddleware;
use CtPassStore\Middleware\CorsMiddleware;
use CtPassStore\Middleware\ErrorMiddleware;
use CtPassStore\Service\ChurchtoolsAuth;
use CtPassStore\Service\ChurchToolsAuthVerifier;
use CtPassStore\Service\ChurchToolsStore;
use CtPassStore\Service\EncryptionService;
use CtPassStore\Service\ExtensionDataService;
use CtPassStore\Service\PasswordValidator;
use CtPassStore\Service\ServiceSettings;
use DI\Container;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;
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

        // Slim calls the middleware added last first. Resulting order (spec 4.1, 5.7):
        // CORS → error handling → routing (404/405) → authentication → endpoint.
        $app->add(new AuthMiddleware(new ChurchtoolsAuth($churchTools, $logger), $logger));
        $app->addRoutingMiddleware();
        $app->add(new ErrorMiddleware($logger));
        $app->add(new CorsMiddleware($config->corsOrigins));

        return $app;
    }

    /**
     * An app that answers every request, including preflights, with `500 misconfigured` and no CORS headers. Used
     * when `credentials.php` itself is broken, so nothing else can be trusted (spec 3.1).
     *
     * @return App<Container>
     */
    public static function misconfigured(string $detail): App
    {
        /** @var App<Container> $app */
        $app = AppFactory::createFromContainer(new Container());
        $app->add(new class ($detail) implements MiddlewareInterface {
            public function __construct(private readonly string $detail) {}

            public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
            {
                return ProblemResponseFactory::create(ProblemType::Misconfigured, $this->detail);
            }
        });

        return $app;
    }
}
