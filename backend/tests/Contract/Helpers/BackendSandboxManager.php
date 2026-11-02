<?php

namespace CtPassStore\Tests\Contract\Helpers;

class BackendSandboxManager
{
    private ?int $pid = null;
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

        // Start the server in the background and remember its PID
        $command = sprintf('PHP_CLI_SERVER_WORKERS=%d php -S %s:%d -t %s > /dev/null 2>&1 & echo $!', $this->workers, $this->host, $this->port, $this->webroot);
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
    }

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
