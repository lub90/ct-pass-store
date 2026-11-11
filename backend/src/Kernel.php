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
use CtPassStore\Application\SelfCheck\SelfCheck;
use CtPassStore\Application\SetPassword;
use CtPassStore\Config\BackendConfig;
use CtPassStore\Domain\PasswordPolicy;
use CtPassStore\Http\Controller\AuthController;
use CtPassStore\Http\Controller\EntriesController;
use CtPassStore\Http\Controller\SelfCheckController;
use CtPassStore\Http\Middleware\AuthMiddleware;
use CtPassStore\Http\Middleware\CorsMiddleware;
use CtPassStore\Http\Middleware\ErrorMiddleware;
use CtPassStore\Http\Middleware\HeadNotAllowedMiddleware;
use CtPassStore\Http\Middleware\HttpsOnlyMiddleware;
use CtPassStore\Http\Middleware\SecurityHeadersMiddleware;
use CtPassStore\Http\Problem\ProblemResponseFactory;
use CtPassStore\Http\Problem\ProblemType;
use CtPassStore\Infrastructure\Auth\FileAddressLimiter;
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
use CtPassStore\Infrastructure\Logging\AddVersionToErrors;
use CtPassStore\Infrastructure\Logging\EscapeControlCharacters;
use CtPassStore\Infrastructure\SelfCheck\CacheFolderCheck;
use CtPassStore\Infrastructure\SelfCheck\CredentialsFileCheck;
use CtPassStore\Infrastructure\SelfCheck\LogFolderCheck;
use CtPassStore\Infrastructure\SelfCheck\OAuthClientCheck;
use CtPassStore\Infrastructure\SelfCheck\OAuthConfigurationCheck;
use CtPassStore\Infrastructure\SelfCheck\PasswordStoreReadCheck;
use CtPassStore\Infrastructure\SelfCheck\PublicKeyCheck;
use CtPassStore\Infrastructure\SelfCheck\ServiceUserRightsCheck;
use CtPassStore\Infrastructure\SelfCheck\SettingsCheck;
use CtPassStore\Infrastructure\SelfCheck\WriteRoundTripCheck;
use CtPassStore\Infrastructure\Store\RecordSigner;
use CtPassStore\Infrastructure\Store\SignedFileCache;
use CtPassStore\Infrastructure\Store\SignedFileStore;
use CtPassStore\Infrastructure\Time\SystemClock;
use CtPassStore\Infrastructure\Version;
use Monolog\Handler\RotatingFileHandler;
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
    public static function create(BackendConfig $config, ChurchToolsClient $churchTools, LoggerInterface $logger, ?Clock $clock = null, ?string $version = null): App
    {
        $clock ??= new SystemClock();
        $version ??= Version::current(dirname(__DIR__));
        $codec = new FirebaseTokenCodec();
        $tokens = new UserTokens($config->jwtSecret, $clock, $codec);
        // One folder (spec 6.1): the fail-open cache for settings, public key and IDs (`cache-*`), and the fail-closed
        // security stores (`sec-*`). Different purposes, so a record of one is never accepted by the other.
        $cache = new SignedFileCache($config->cacheDir, new RecordSigner($config->jwtSecret, SignedFileCache::PURPOSE), $clock, $logger);
        $extensionData = new ExtensionData($churchTools, cache: $cache);
        $settings = new KvSettingsRepository($extensionData, $logger, $cache, $clock);
        $passwords = new KvPasswordRepository($extensionData, $logger);
        $securityStore = new SignedFileStore($config->cacheDir, $config->jwtSecret, $logger);
        $addressLimiter = new FileAddressLimiter($securityStore, $clock, $config->jwtSecret);
        $guard = new EntryGuard($settings, new ChurchToolsPasswordVerifier($churchTools, $logger), new FileAttemptLimiter($securityStore, $clock), $logger);

        /** @var App<null> $app */
        $app = AppFactory::create();

        $entries = new EntriesController(
            new GetPassword($guard, $passwords),
            new SetPassword($guard, $settings, new PasswordPolicy(), new RsaPasswordCipher($settings), $passwords, $logger),
            new DeletePassword($guard, $passwords),
            $logger,
        );
        // The log folder is `logs/` next to the cache folder, as `public/index.php` lays them out (spec 3.1).
        $selfCheck = new SelfCheckController($settings, new SelfCheck([
            new CredentialsFileCheck($config->credentialsPath),
            new LogFolderCheck(dirname($config->cacheDir) . '/logs'),
            new CacheFolderCheck($config->cacheDir, $securityStore),
            new OAuthConfigurationCheck($config),
            new SettingsCheck($settings),
            new PublicKeyCheck($settings, new RsaPasswordCipher($settings)),
            new PasswordStoreReadCheck($extensionData),
            new ServiceUserRightsCheck($churchTools, $extensionData),
            new OAuthClientCheck($churchTools, $config),
        ], $logger, [
            new WriteRoundTripCheck($passwords, new RsaPasswordCipher($settings)),
        ]), $version);
        $login = new AuthController(new Login(
            $config->instanceOrigin(),
            new ChurchToolsIdentityProvider($churchTools, $config->oauthClientId, $config->oauthClientSecret, $logger),
            $tokens,
            $logger,
        ), $addressLimiter, $logger);

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
        })->add(new AuthMiddleware($authenticator, $addressLimiter, $logger));

        // Slim calls the middleware added last first. Resulting order (spec 4.1, 4.2, 5.7):
        // security headers → CORS (answers preflights) → HTTPS check → error handling → routing (404/405)
        // → HEAD is 405 → authentication (per route) → endpoint.
        $app->add(new HeadNotAllowedMiddleware());
        $app->addRoutingMiddleware();
        $app->add(new ErrorMiddleware($logger));
        $app->add(new HttpsOnlyMiddleware());
        $app->add(new CorsMiddleware($config->corsOrigins));
        $app->add(new SecurityHeadersMiddleware());

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

        return self::create($config, new GuzzleChurchToolsClient($config->apiUrl, Credential::loginToken($config->apiToken)), self::logger($logFile, $config->logLevel, Version::current(dirname(__DIR__))));
    }

    /**
     * The production logger: one file per day, `app-YYYY-MM-DD.log` for `app.log`, the newest 14 kept (spec 6.4).
     * Control characters (newlines included) in messages and context values are escaped as `\xNN`, so input that
     * reaches the log can't forge additional log lines. Records of level `error` and above carry the backend version.
     *
     * Monolog runs the processor pushed last first: the version is added first and then escaped with everything else.
     */
    public static function logger(string $logFile, string $level, string $version): Logger
    {
        $logger = new Logger('ct-pass-store');
        $logger->pushHandler(new RotatingFileHandler($logFile, 14, Logger::toMonologLevel($level)));
        $logger->pushProcessor(new EscapeControlCharacters());
        $logger->pushProcessor(new AddVersionToErrors($version));

        return $logger;
    }

    /**
     * An app that answers every request, including preflights, with `500 misconfigured`, the security headers and no
     * CORS headers. Used when `credentials.php` itself is broken, so nothing else can be trusted (spec 3.1).
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
        $app->add(new SecurityHeadersMiddleware());

        return $app;
    }
}
