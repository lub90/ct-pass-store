<?php

declare(strict_types=1);

namespace CtPassStore;

use CtPassStore\Application\Auth\Authenticator;
use CtPassStore\Application\Auth\MachineTokens;
use CtPassStore\Application\Auth\UserTokens;
use CtPassStore\Application\DeletePassword;
use CtPassStore\Application\EntryGuard;
use CtPassStore\Application\Exception\ConfigurationException;
use CtPassStore\Application\GetPassword;
use CtPassStore\Application\Login;
use CtPassStore\Application\Port\Clock;
use CtPassStore\Application\SetPassword;
use CtPassStore\Config\BackendConfig;
use CtPassStore\Domain\PasswordPolicy;
use CtPassStore\Http\Controller\AuthController;
use CtPassStore\Http\Controller\EntriesController;
use CtPassStore\Http\Controller\SelfCheckController;
use CtPassStore\Http\Middleware\AuthMiddleware;
use CtPassStore\Http\Middleware\CorsMiddleware;
use CtPassStore\Http\Middleware\ErrorMiddleware;
use CtPassStore\Http\Problem\ProblemResponseFactory;
use CtPassStore\Http\Problem\ProblemType;
use CtPassStore\Infrastructure\Auth\FileAttemptLimiter;
use CtPassStore\Infrastructure\Auth\FileReplayCache;
use CtPassStore\Infrastructure\Auth\FirebaseTokenCodec;
use CtPassStore\Infrastructure\ChurchTools\ChurchToolsClient;
use CtPassStore\Infrastructure\ChurchTools\ChurchToolsIdentityProvider;
use CtPassStore\Infrastructure\ChurchTools\ChurchToolsPasswordVerifier;
use CtPassStore\Infrastructure\ChurchTools\Credential;
use CtPassStore\Infrastructure\ChurchTools\GuzzleChurchToolsClient;
use CtPassStore\Infrastructure\Crypto\RsaPasswordCipher;
use CtPassStore\Infrastructure\Kv\ExtensionData;
use CtPassStore\Infrastructure\Kv\KvPasswordRepository;
use CtPassStore\Infrastructure\Kv\KvSettingsRepository;
use CtPassStore\Infrastructure\Logging\EscapeControlCharacters;
use CtPassStore\Infrastructure\Store\RecordSigner;
use CtPassStore\Infrastructure\Store\SignedFileCache;
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
final class Kernel
{
    /**
     * @return App<null>
     */
    public static function create(BackendConfig $config, ChurchToolsClient $churchTools, LoggerInterface $logger, ?Clock $clock = null): App
    {
        $clock ??= new SystemClock();
        $codec = new FirebaseTokenCodec();
        $tokens = new UserTokens($config->jwtSecret, $clock, $codec);
        // One folder (spec 6.1): the fail-open cache for settings, public key and IDs (`cache-*`), and the fail-closed
        // security stores (`sec-*`). Different purposes, so a record of one is never accepted by the other.
        $cache = new SignedFileCache($config->cacheDir, new RecordSigner($config->jwtSecret, SignedFileCache::PURPOSE), $clock, $logger);
        $extensionData = new ExtensionData($churchTools, cache: $cache);
        $settings = new KvSettingsRepository($extensionData, $logger, $cache);
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

        $authenticator = new Authenticator($codec, $tokens, new MachineTokens($settings, new FileReplayCache($securityStore), $clock, $codec));

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

        return self::create($config, new GuzzleChurchToolsClient($config->apiUrl, Credential::loginToken($config->apiToken)), self::logger($logFile, $config->logLevel));
    }

    /**
     * The production logger. Control characters (newlines included) in messages and context values are escaped as
     * `\xNN`, so input that reaches the log can't forge additional log lines (spec 6.4).
     */
    public static function logger(string $logFile, string $level): Logger
    {
        $logger = new Logger('ct-pass-store');
        $logger->pushHandler(new StreamHandler($logFile, Logger::toMonologLevel($level)));
        $logger->pushProcessor(new EscapeControlCharacters());

        return $logger;
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
