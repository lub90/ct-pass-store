<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Http;

use CtPassStore\Application\Exception\AccessDeniedException;
use CtPassStore\Application\Exception\ApplicationException;
use CtPassStore\Application\Exception\CustomPasswordNotAllowedException;
use CtPassStore\Application\Exception\EntryNotFoundException;
use CtPassStore\Application\Exception\InvalidPrimaryPasswordException;
use CtPassStore\Application\Exception\PasswordRejectedException;
use CtPassStore\Application\Exception\PrimaryPasswordRequiredException;
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
    }

    public function testEveryApplicationExceptionIsCovered(): void
    {
        $covered = array_map(static fn(array $case): string => $case[0]::class, iterator_to_array(self::exceptions()));
        $declared = [];
        foreach (glob(__DIR__ . '/../../../src/Application/Exception/*Exception.php') ?: [] as $file) {
            $class = 'CtPassStore\\Application\\Exception\\' . basename($file, '.php');
            if ($class !== ApplicationException::class) {
                $declared[] = $class;
            }
        }
        sort($declared);
        $covered = array_values(array_unique($covered));
        sort($covered);

        self::assertSame($declared, $covered, 'A new ApplicationException needs a problem type in ErrorMiddleware and a case here.');
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
