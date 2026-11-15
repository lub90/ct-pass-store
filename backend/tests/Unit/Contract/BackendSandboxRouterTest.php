<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Contract;

use CtPassStore\Tests\Contract\Helpers\BackendSandboxManager;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * The router script of the contract and load tests' built-in server (test review M13): it sets `HTTPS=on` as a TLS
 * front end would, serves existing files as they are and sends everything else to `index.php`. Run here in-process
 * against a temporary web root, without starting a server.
 */
final class BackendSandboxRouterTest extends TestCase
{
    private string $root;

    private string $router;

    /** @var array<string, mixed> */
    private array $server;

    protected function setUp(): void
    {
        $this->server = $_SERVER;
        $this->root = sys_get_temp_dir() . '/ctps-router-' . bin2hex(random_bytes(6));
        mkdir($this->root . '/assets', 0o700, true);
        file_put_contents($this->root . '/index.php', "<?php\n\$GLOBALS['ctpsRouterTest'][] = \$_SERVER['HTTPS'] ?? null;\n");
        file_put_contents($this->root . '/style.css', 'body {}');
        file_put_contents($this->root . '/assets/app.js', '');
        $this->router = $this->root . '/router.php';
        file_put_contents($this->router, BackendSandboxManager::ROUTER);
        $GLOBALS['ctpsRouterTest'] = [];
    }

    protected function tearDown(): void
    {
        $_SERVER = $this->server;
        unset($GLOBALS['ctpsRouterTest']);
        foreach (['index.php', 'style.css', 'assets/app.js', 'router.php'] as $file) {
            unlink($this->root . '/' . $file);
        }
        rmdir($this->root . '/assets');
        rmdir($this->root);
    }

    /**
     * @return array{result: mixed, index: list<mixed>, https: mixed}
     */
    private function route(?string $uri): array
    {
        $_SERVER['DOCUMENT_ROOT'] = $this->root;
        unset($_SERVER['HTTPS']);
        if ($uri === null) {
            unset($_SERVER['REQUEST_URI']);
        } else {
            $_SERVER['REQUEST_URI'] = $uri;
        }
        $router = $this->router;
        $result = (static fn(): mixed => include $router)();

        return ['result' => $result, 'index' => $GLOBALS['ctpsRouterTest'], 'https' => $_SERVER['HTTPS'] ?? null];
    }

    /**
     * @return iterable<string, array{string|null}>
     */
    public static function toIndex(): iterable
    {
        yield 'root' => ['/'];
        yield 'API path' => ['/v1/entries/5'];
        yield 'API path with query' => ['/v1/cleanup?apply=1'];
        yield 'missing file' => ['/missing.js'];
        yield 'a folder' => ['/assets'];
        yield 'a folder with slash' => ['/assets/'];
        yield 'no request URI' => [null];
    }

    #[DataProvider('toIndex')]
    public function testEverythingElseGoesToIndexWithHttpsOn(?string $uri): void
    {
        $routed = $this->route($uri);

        self::assertNotFalse($routed['result']);
        self::assertSame(['on'], $routed['index'], 'index.php ran once and saw HTTPS=on.');
        self::assertSame('on', $routed['https']);
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function staticFiles(): iterable
    {
        yield 'file' => ['/style.css'];
        yield 'file with query' => ['/style.css?v=2'];
        yield 'file in a folder' => ['/assets/app.js'];
        // The built-in server then runs index.php itself (with HTTPS=on, set before).
        yield 'index.php itself' => ['/index.php'];
    }

    #[DataProvider('staticFiles')]
    public function testExistingFilesAreServedAsTheyAre(string $uri): void
    {
        $routed = $this->route($uri);

        self::assertFalse($routed['result'], 'false lets the built-in server serve the file.');
        self::assertSame([], $routed['index']);
        self::assertSame('on', $routed['https']);
    }
}
