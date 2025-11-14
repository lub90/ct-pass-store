<?php

namespace CtPassStore\Tests\EndToEnd;

class BackendSandboxManager
{
    private ?int $pid = null;
    private string $host;
    private int $port;
    private string $webroot;

    public function __construct(string $host = 'localhost', int $port = 8080, string $webroot = 'public')
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

        // Starte den Server im Hintergrund und speichere die PID
        $command = sprintf('php -S %s:%d -t %s > /dev/null 2>&1 & echo $!', $this->host, $this->port, $this->webroot);
        $output = [];
        exec($command, $output);
        $this->pid = isset($output[0]) ? (int) $output[0] : null;

        if ($this->pid === null || $this->pid <= 0) {
            throw new \RuntimeException('Failed to start PHP built-in server.');
        }

        // Kurze Pause, damit der Server hochfahren kann
        sleep(1);
    }

    public function stop(): void
    {
        if ($this->pid !== null) {
            exec('kill ' . $this->pid);
            $this->pid = null;
        }
    }

    public function getBaseUrl(): string
    {
        return sprintf('http://%s:%d', $this->host, $this->port);
    }
}
