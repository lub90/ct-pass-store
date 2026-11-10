<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Support;

/**
 * Runs a PHP command in a separate process with an exact environment, for tests that need a fresh PHP (ini settings,
 * a whole PHPUnit run). The only place in the tests besides the contract helpers that may start processes.
 */
final class PhpProcess
{
    /**
     * @param list<string> $arguments passed to `php` as separate arguments, never through a shell
     * @param array<string, string> $environment the complete environment of the process
     * @return array{exit: int, output: string}
     */
    public static function run(array $arguments, array $environment, string $workingDirectory): array
    {
        // Errors go to a file, not a second pipe: reading two pipes one after the other can deadlock.
        $errors = (string) tempnam(sys_get_temp_dir(), 'ctps-stderr-');
        $process = proc_open([PHP_BINARY, ...$arguments], [1 => ['pipe', 'w'], 2 => ['file', $errors, 'w']], $pipes, $workingDirectory, $environment);
        if (!is_resource($process)) {
            throw new \RuntimeException('Could not start PHP.');
        }
        $output = (string) stream_get_contents($pipes[1]);
        fclose($pipes[1]);
        $exit = proc_close($process);
        $output .= (string) file_get_contents($errors);
        unlink($errors);

        return ['exit' => $exit, 'output' => $output];
    }
}
