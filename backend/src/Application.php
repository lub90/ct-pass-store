<?php

declare(strict_types=1);

namespace CtPassStore;

use CtPassStore\Application\DeletePassword;
use CtPassStore\Application\EntryGuard;
use CtPassStore\Application\GetPassword;
use CtPassStore\Application\SetPassword;
use CtPassStore\Config\BackendConfig;
use CtPassStore\Domain\PasswordPolicy;
use CtPassStore\Http\Controller\EntriesController;
use CtPassStore\Http\Controller\SelfCheckController;
use CtPassStore\Http\Middleware\AuthMiddleware;
use CtPassStore\Http\Middleware\CorsMiddleware;
use CtPassStore\Http\Middleware\ErrorMiddleware;
use CtPassStore\Http\Problem\ProblemResponseFactory;
use CtPassStore\Http\Problem\ProblemType;
use CtPassStore\Infrastructure\ChurchTools\ChurchToolsAuthenticator;
use CtPassStore\Infrastructure\ChurchTools\ChurchToolsClient;
use CtPassStore\Infrastructure\ChurchTools\ChurchToolsPasswordVerifier;
use CtPassStore\Infrastructure\Crypto\RsaPasswordCipher;
use CtPassStore\Infrastructure\Kv\ExtensionData;
use CtPassStore\Infrastructure\Kv\KvPasswordRepository;
use CtPassStore\Infrastructure\Kv\KvSettingsRepository;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;
use Psr\Log\LoggerInterface;
use Slim\App;
use Slim\Factory\AppFactory;

/**
 * Builds the Slim app. The only place where the layers are wired together (composition root).
 *
 * Configuration, the ChurchTools client and the logger are passed in, so `public/index.php` can use the real ones
 * and the API tests a fake ChurchTools (spec 6.6, plan item 2.0).
 */
final class Application
{
    /**
     * @return App<null>
     */
    public static function create(BackendConfig $config, ChurchToolsClient $churchTools, LoggerInterface $logger): App
    {
        $extensionData = new ExtensionData($churchTools);
        $settings = new KvSettingsRepository($extensionData);
        $passwords = new KvPasswordRepository($extensionData, $logger);
        $guard = new EntryGuard($settings, new ChurchToolsPasswordVerifier($churchTools, $logger), $logger);

        /** @var App<null> $app */
        $app = AppFactory::create();

        $entries = new EntriesController(
            new GetPassword($guard, $passwords),
            new SetPassword($guard, $settings, new PasswordPolicy(), new RsaPasswordCipher($settings), $passwords, $logger),
            new DeletePassword($guard, $passwords),
        );
        $app->get('/entries/{id}', [$entries, 'get']);
        $app->put('/entries/{id}', [$entries, 'put']);
        $app->delete('/entries/{id}', [$entries, 'delete']);

        $selfCheck = new SelfCheckController($settings, $config->credentialsPath);
        $app->get('/test', [$selfCheck, 'get']);

        // Slim calls the middleware added last first. Resulting order (spec 4.1, 5.7):
        // CORS → error handling → routing (404/405) → authentication → endpoint.
        $app->add(new AuthMiddleware(new ChurchToolsAuthenticator($churchTools), $logger));
        $app->addRoutingMiddleware();
        $app->add(new ErrorMiddleware($logger));
        $app->add(new CorsMiddleware($config->corsOrigins));

        return $app;
    }

    /**
     * An app that answers every request, including preflights, with `500 misconfigured` and no CORS headers. Used
     * when `credentials.php` itself is broken, so nothing else can be trusted (spec 3.1).
     *
     * @return App<null>
     */
    public static function misconfigured(string $detail): App
    {
        /** @var App<null> $app */
        $app = AppFactory::create();
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
