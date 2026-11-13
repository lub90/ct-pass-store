<?php

namespace CtPassStore\Tests\Contract\Helpers;

/**
 * Runs the backend in PHP's built-in server for tests. The server sets no `HTTPS` server variable, so the backend would
 * answer every request with `400 https-required` (spec 4.1). A router script therefore sets `HTTPS=on`, as a TLS
 * front end would, and then serves the request like the web server: existing files as they are, everything else
 * through `index.php` of the web root. Test helper only; nothing shipped depends on it.
 */
class BackendSandboxManager
{
    private ?int $pid = null;
    private ?string $router = null;
    private string $host;
    private int $port;
    private string $webroot;

    /**
     * @param int $workers PHP_CLI_SERVER_WORKERS: more than 1 lets the built-in server handle requests in parallel
     */
    public function __construct(string $host = 'localhost', int $port = 8080, string $webroot = 'public', private readonly int $workers = 1)
    {
        $this->host = $host;
        $this->port = $port;
        $this->webroot = $webroot;
    }

    public function start(): void
    {
        if ($this->pid !== null) {
            throw new \RuntimeException('Backend is already running.');
        }

        if (!$this->isPortAvailable()) {
            throw new \RuntimeException(sprintf('Port %d on host %s is already in use.', $this->port, $this->host));
        }

        $this->router = (string) tempnam(sys_get_temp_dir(), 'ctps-router-');
        file_put_contents($this->router, self::ROUTER);

        // Start the server in the background and remember its PID
        $command = sprintf(
            'PHP_CLI_SERVER_WORKERS=%d php -S %s:%d -t %s %s > /dev/null 2>&1 & echo $!',
            $this->workers,
            $this->host,
            $this->port,
            escapeshellarg($this->webroot),
            escapeshellarg($this->router),
        );
        $output = [];
        exec($command, $output);
        $this->pid = isset($output[0]) ? (int) $output[0] : null;

        if ($this->pid === null || $this->pid <= 0) {
            throw new \RuntimeException('Failed to start PHP built-in server.');
        }

        // Give the server time to start up
        sleep(1);
    }

    public function stop(): void
    {
        if ($this->pid !== null) {
            exec('kill ' . $this->pid);
            $this->pid = null;
            // Give the server time to shut down
            sleep(1);
        }
        if ($this->router !== null) {
            @unlink($this->router);
            $this->router = null;
        }
    }

    private const ROUTER = <<<'PHP'
        <?php
        // Router of the test server: HTTPS as behind a TLS front end, then static file or index.php.
        $_SERVER['HTTPS'] = 'on';
        $path = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
        if ($path !== '/' && is_file($_SERVER['DOCUMENT_ROOT'] . $path)) {
            return false;
        }
        require $_SERVER['DOCUMENT_ROOT'] . '/index.php';

        PHP;

    public function getBaseUrl(): string
    {
        return sprintf('http://%s:%d', $this->host, $this->port);
    }

    private function isPortAvailable(): bool
    {
        $connection = @fsockopen($this->host, $this->port);
        if (is_resource($connection)) {
            fclose($connection);
            return false; // Port is already in use
        }
        return true; // Port is free
    }
}
