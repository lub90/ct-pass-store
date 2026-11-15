<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Http;

use CtPassStore\Http\Middleware\ErrorMiddleware;
use Monolog\Handler\TestHandler;
use Monolog\Logger;
use PHPUnit\Framework\TestCase;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\RequestHandlerInterface;
use Slim\Psr7\Factory\ServerRequestFactory;

/**
 * Spec 6.3 (no secrets in logs): the trace of a logged error carries no argument values, even on a host where PHP
 * records them (`zend.exception_ignore_args = Off`, the php.ini-development default). PHP shortens string arguments
 * to `zend.exception_string_param_max_len` characters; the secret fits that length and the limit is set to its
 * default (15), so a leak would show the whole secret, and a shortened one is caught by the prefix check.
 */
final class ErrorMiddlewareTest extends TestCase
{
    /** At most 15 characters, so PHP's default limit doesn't shorten it in a trace. */
    private const SECRET = 'Arg-SECRET-4711';

    private string|false $ignoreArgs;
    private string|false $paramMaxLen;

    protected function setUp(): void
    {
        $this->ignoreArgs = ini_get('zend.exception_ignore_args');
        ini_set('zend.exception_ignore_args', '0');
        $this->paramMaxLen = ini_get('zend.exception_string_param_max_len');
        ini_set('zend.exception_string_param_max_len', '15');
    }

    protected function tearDown(): void
    {
        if ($this->ignoreArgs !== false) {
            ini_set('zend.exception_ignore_args', $this->ignoreArgs);
        }
        if ($this->paramMaxLen !== false) {
            ini_set('zend.exception_string_param_max_len', $this->paramMaxLen);
        }
    }

    public static function failWith(string $secret): never
    {
        throw new \LogicException('Bug.');
    }

    public function testLoggedTracesCarryNoArgumentValues(): void
    {
        $log = new TestHandler();
        $handler = new class implements RequestHandlerInterface {
            public function handle(ServerRequestInterface $request): ResponseInterface
            {
                ErrorMiddlewareTest::failWith(ErrorMiddlewareTest::secret());
            }
        };

        $response = (new ErrorMiddleware(new Logger('test', [$log])))
            ->process((new ServerRequestFactory())->createServerRequest('GET', '/v1/entries/5'), $handler);

        self::assertSame(500, $response->getStatusCode());
        $records = $log->getRecords();
        self::assertCount(1, $records);
        $context = $records[0]['context'];
        self::assertIsArray($context['trace']);
        $logged = (string) json_encode($context, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        // The leak checks come first, so a leaking format fails on them, not on the format check below.
        self::assertStringNotContainsString(self::SECRET, $logged);
        self::assertStringNotContainsString(substr(self::SECRET, 0, 5), $logged, 'Not even a shortened secret.');
        self::assertStringNotContainsString("failWith('", $logged, 'No string argument, not even an elided one.');
        self::assertStringContainsString('ErrorMiddlewareTest::failWith()', implode("\n", $context['trace']));
    }

    /** Precondition: without the stripping, PHP really would hand the secret to the log. */
    public function testPhpRecordsTheArgumentHere(): void
    {
        try {
            self::failWith(self::SECRET);
        } catch (\LogicException $e) {
            self::assertSame([self::SECRET], $e->getTrace()[0]['args'] ?? null);
            self::assertStringContainsString("failWith('" . self::SECRET . "')", $e->getTraceAsString(), 'shown in full');
        }
    }

    public static function secret(): string
    {
        return self::SECRET;
    }
}
