<?php

declare(strict_types=1);

namespace CtPassStore;

use CtPassStore\Application\DeletePassword;
use CtPassStore\Application\EntryGuard;
use CtPassStore\Application\GetPassword;
use CtPassStore\Application\Login;
use CtPassStore\Application\Port\Clock;
use CtPassStore\Application\SetPassword;
use CtPassStore\Config\BackendConfig;
use CtPassStore\Config\ConfigurationException;
use CtPassStore\Domain\PasswordPolicy;
use CtPassStore\Http\Controller\AuthController;
use CtPassStore\Http\Controller\EntriesController;
use CtPassStore\Http\Controller\SelfCheckController;
use CtPassStore\Http\Middleware\AuthMiddleware;
use CtPassStore\Http\Middleware\CorsMiddleware;
use CtPassStore\Http\Middleware\ErrorMiddleware;
use CtPassStore\Http\Problem\ProblemResponseFactory;
use CtPassStore\Http\Problem\ProblemType;
use CtPassStore\Infrastructure\Auth\BearerAuthenticator;
use CtPassStore\Infrastructure\Auth\FileAttemptLimiter;
use CtPassStore\Infrastructure\Auth\MachineTokenVerifier;
use CtPassStore\Infrastructure\Auth\ReplayGuard;
use CtPassStore\Infrastructure\Auth\TokenService;
use CtPassStore\Infrastructure\ChurchTools\ChurchToolsClient;
use CtPassStore\Infrastructure\ChurchTools\ChurchToolsIdentityProvider;
use CtPassStore\Infrastructure\ChurchTools\ChurchToolsPasswordVerifier;
use CtPassStore\Infrastructure\ChurchTools\Credential;
use CtPassStore\Infrastructure\ChurchTools\GuzzleChurchToolsClient;
use CtPassStore\Infrastructure\Crypto\RsaPasswordCipher;
use CtPassStore\Infrastructure\Kv\ExtensionData;
use CtPassStore\Infrastructure\Kv\KvPasswordRepository;
use CtPassStore\Infrastructure\Kv\KvSettingsRepository;
use CtPassStore\Infrastructure\Store\SignedFileStore;
use CtPassStore\Infrastructure\Time\SystemClock;
use Monolog\Handler\StreamHandler;
use Monolog\Logger;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;
use Psr\Log\LoggerInterface;
use Slim\App;
use Slim\Factory\AppFactory;
use Slim\Interfaces\RouteCollectorProxyInterface;

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
    public static function create(BackendConfig $config, ChurchToolsClient $churchTools, LoggerInterface $logger, ?Clock $clock = null): App
    {
        $clock ??= new SystemClock();
        $tokens = new TokenService($config->jwtSecret, $clock);
        $extensionData = new ExtensionData($churchTools);
        $settings = new KvSettingsRepository($extensionData, $logger);
        $passwords = new KvPasswordRepository($extensionData, $logger);
        $securityStore = new SignedFileStore($config->cacheDir, $config->jwtSecret, $logger);
        $guard = new EntryGuard($settings, new ChurchToolsPasswordVerifier($churchTools, $logger), new FileAttemptLimiter($securityStore, $clock), $logger);

        /** @var App<null> $app */
        $app = AppFactory::create();

        $entries = new EntriesController(
            new GetPassword($guard, $passwords),
            new SetPassword($guard, $settings, new PasswordPolicy(), new RsaPasswordCipher($settings), $passwords, $logger),
            new DeletePassword($guard, $passwords),
        );
        $selfCheck = new SelfCheckController($settings, $config->credentialsPath);
        $login = new AuthController(new Login(
            $config->instanceOrigin(),
            new ChurchToolsIdentityProvider($churchTools, $config->oauthClientId, $config->oauthClientSecret, $logger),
            $tokens,
            $logger,
        ));

        $authenticator = new BearerAuthenticator(
            $tokens,
            new MachineTokenVerifier($settings, new ReplayGuard($securityStore), $clock),
        );

        // Every path lives under /v1 (Q20); the old paths without prefix are unknown routes (404).
        // The only route without an access token (spec 4.1):
        $app->post('/v1/auth/token', [$login, 'token']);

        // Authentication runs per route, after routing, so unknown routes and wrong methods get 404/405 first.
        $app->group('/v1', function (RouteCollectorProxyInterface $group) use ($entries, $selfCheck): void {
            $group->get('/entries/{id}', [$entries, 'get']);
            $group->put('/entries/{id}', [$entries, 'put']);
            $group->delete('/entries/{id}', [$entries, 'delete']);
            $group->get('/test', [$selfCheck, 'get']);
        })->add(new AuthMiddleware($authenticator, $logger));

        // Slim calls the middleware added last first. Resulting order (spec 4.1, 5.7):
        // CORS → error handling → routing (404/405) → authentication (per route) → endpoint.
        $app->addRoutingMiddleware();
        $app->add(new ErrorMiddleware($logger));
        $app->add(new CorsMiddleware($config->corsOrigins));

        return $app;
    }

    /**
     * The app as `public/index.php` runs it: configuration from `credentials.php`, the real ChurchTools client and the
     * log file. A missing or broken `credentials.php` gives the misconfigured app instead (spec 3.1).
     *
     * @return App<null>
     */
    public static function bootstrap(string $credentialsPath, string $cacheDir, string $logFile): App
    {
        try {
            if (!is_readable($credentialsPath)) {
                throw new ConfigurationException('config/credentials.php is missing or not readable by PHP.');
            }
            $config = BackendConfig::fromArray(require $credentialsPath, $credentialsPath, $cacheDir);
        } catch (ConfigurationException $e) {
            // Without a valid configuration there's no trustworthy logger either; PHP's error log is the fallback.
            error_log('ctpassstore: misconfigured: ' . $e->getMessage());

            return self::misconfigured($e->getMessage());
        }

        $logger = new Logger('ct-pass-store');
        $logger->pushHandler(new StreamHandler($logFile, Logger::toMonologLevel($config->logLevel)));

        return self::create($config, new GuzzleChurchToolsClient($config->apiUrl, Credential::loginToken($config->apiToken)), $logger);
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
