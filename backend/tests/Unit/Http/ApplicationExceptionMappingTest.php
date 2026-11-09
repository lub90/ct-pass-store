<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Http;

use CtPassStore\Application\Exception\AccessDeniedException;
use CtPassStore\Application\Exception\ApplicationException;
use CtPassStore\Application\Exception\CustomPasswordNotAllowedException;
use CtPassStore\Application\Exception\EntryNotFoundException;
use CtPassStore\Application\Exception\InvalidPrimaryPasswordException;
use CtPassStore\Application\Exception\InvalidRedirectUriException;
use CtPassStore\Application\Exception\InvalidTokenException;
use CtPassStore\Application\Exception\NoServiceAccessException;
use CtPassStore\Application\Exception\OAuthCodeInvalidException;
use CtPassStore\Application\Exception\PasswordRejectedException;
use CtPassStore\Application\Exception\PrimaryPasswordRequiredException;
use CtPassStore\Application\Exception\TokenExpiredException;
use CtPassStore\Application\Exception\TooManyAttemptsException;
use CtPassStore\Http\Middleware\ErrorMiddleware;
use Monolog\Handler\TestHandler;
use Monolog\Logger;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\RequestHandlerInterface;
use Slim\Psr7\Factory\ServerRequestFactory;

/**
 * Every refusal of the use cases has its own problem type, keeps its message as `detail` and isn't logged as an error.
 */
final class ApplicationExceptionMappingTest extends TestCase
{
    #[DataProvider('exceptions')]
    public function testMapsToItsProblemType(ApplicationException $exception, int $status, string $type): void
    {
        $log = new TestHandler();
        $middleware = new ErrorMiddleware(new Logger('test', [$log]));
        $handler = new class ($exception) implements RequestHandlerInterface {
            public function __construct(private readonly \Throwable $e) {}

            public function handle(ServerRequestInterface $request): ResponseInterface
            {
                throw $this->e;
            }
        };

        $response = $middleware->process((new ServerRequestFactory())->createServerRequest('GET', '/entries/1'), $handler);
        $body = json_decode((string) $response->getBody(), true, flags: JSON_THROW_ON_ERROR);

        self::assertSame($status, $response->getStatusCode());
        self::assertIsArray($body);
        self::assertStringEndsWith('#' . $type, (string) $body['type']);
        self::assertSame($exception->getMessage(), $body['detail']);
        self::assertFalse($log->hasErrorRecords(), 'Refused requests are not errors.');
    }

    /**
     * @return iterable<string, array{ApplicationException, int, string}>
     */
    public static function exceptions(): iterable
    {
        yield 'access denied' => [new AccessDeniedException('no'), 403, 'forbidden'];
        yield 'entry not found' => [new EntryNotFoundException('none'), 404, 'entry-not-found'];
        yield 'primary password required' => [new PrimaryPasswordRequiredException('need'), 400, 'primary-password-required'];
        yield 'invalid primary password' => [new InvalidPrimaryPasswordException('wrong'), 403, 'invalid-primary-password'];
        yield 'custom password not allowed' => [new CustomPasswordNotAllowedException('off'), 400, 'custom-password-not-allowed'];
        yield 'password rejected' => [new PasswordRejectedException('weak', ['too-short']), 400, 'password-invalid'];
        yield 'invalid token' => [new InvalidTokenException('bad'), 401, 'invalid-token'];
        yield 'token expired' => [new TokenExpiredException('old'), 401, 'token-expired'];
        yield 'oauth code invalid' => [new OAuthCodeInvalidException('code'), 400, 'oauth-code-invalid'];
        yield 'no service access' => [new NoServiceAccessException('view'), 403, 'no-service-access'];
        yield 'invalid redirect uri' => [new InvalidRedirectUriException('uri'), 400, 'invalid-body'];
        yield 'too many attempts' => [new TooManyAttemptsException('wait', 120), 429, 'too-many-attempts'];
    }

    /**
     * The mapping is a match without default, so PHPStan catches a missing reason; this checks that every reason also
     * gets a usable text.
     */
    public function testEveryReasonHasAProblemTypeAndAText(): void
    {
        foreach (\CtPassStore\Application\Failure\Reason::cases() as $reason) {
            $type = \CtPassStore\Http\Problem\ProblemMapping::type($reason);
            self::assertNotSame('', \CtPassStore\Http\Problem\ProblemMapping::fixedDetail($reason), $reason->value);
            self::assertNotSame(\CtPassStore\Http\Problem\ProblemType::InternalError, $type, $reason->value);
        }
    }

    /**
     * Infrastructure failures: a fixed text for the client (their messages name API paths), the reason in the log.
     *
     * @return iterable<string, array{\Throwable, int, string, string}>
     */
    public static function infrastructureFailures(): iterable
    {
        $ns = 'CtPassStore\\Infrastructure\\ChurchTools\\Exception\\';
        yield 'unavailable' => [new ($ns . 'UnavailableException')('GET x: down'), 502, 'upstream-unavailable', 'upstream-unavailable'];
        yield 'invalid' => [new ($ns . 'InvalidResponseException')('GET x: no JSON'), 502, 'upstream-invalid', 'upstream-invalid'];
        yield 'user call rejected unexpectedly' => [new ($ns . 'NotAuthenticatedException')('GET x: 401'), 502, 'upstream-invalid', 'upstream-invalid'];
        yield 'not found' => [new ($ns . 'NotFoundException')('GET x: 404'), 500, 'misconfigured', 'extension-not-installed'];
        yield 'service user rejected' => [new ($ns . 'ServiceCredentialRejectedException')('GET x: 403'), 500, 'misconfigured', 'service-user-rejected'];
        yield 'store tampered' => [new \CtPassStore\Application\Exception\ConfigurationException('tampered', \CtPassStore\Application\Failure\Reason::StoreTampered), 500, 'misconfigured', 'store-tampered'];
    }

    #[DataProvider('infrastructureFailures')]
    public function testInfrastructureFailuresAreLoggedWithTheirReason(\Throwable $failure, int $status, string $type, string $reason): void
    {
        $log = new TestHandler();
        $handler = new class ($failure) implements RequestHandlerInterface {
            public function __construct(private readonly \Throwable $e) {}

            public function handle(ServerRequestInterface $request): ResponseInterface
            {
                throw $this->e;
            }
        };

        $response = (new ErrorMiddleware(new Logger('test', [$log])))->process((new ServerRequestFactory())->createServerRequest('GET', '/x'), $handler);
        $body = json_decode((string) $response->getBody(), true, flags: JSON_THROW_ON_ERROR);

        self::assertSame($status, $response->getStatusCode());
        self::assertIsArray($body);
        self::assertStringEndsWith('#' . $type, (string) $body['type']);
        self::assertStringNotContainsString('GET x', (string) $body['detail'], 'Log-only messages never reach the client.');
        self::assertSame($reason, $log->getRecords()[0]['context']['reason'] ?? null);
    }

    public function testPasswordViolationsAreAnExtensionMember(): void
    {
        $middleware = new ErrorMiddleware(new Logger('test'));
        $handler = new class implements RequestHandlerInterface {
            public function handle(ServerRequestInterface $request): ResponseInterface
            {
                throw new PasswordRejectedException('weak', ['too-short', 'missing-digit']);
            }
        };

        $response = $middleware->process((new ServerRequestFactory())->createServerRequest('PUT', '/entries/1'), $handler);
        $body = json_decode((string) $response->getBody(), true, flags: JSON_THROW_ON_ERROR);

        self::assertIsArray($body);
        self::assertSame(['too-short', 'missing-digit'], $body['violations']);
    }
}
