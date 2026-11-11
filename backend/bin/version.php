<?php

declare(strict_types=1);

// Prints the version string for the build (spec 6.5); the build writes it to version.txt.
// Command line only: this is the one place that asks git, so the web runtime never starts a process.

use CtPassStore\Infrastructure\Version;

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit(1);
}

require __DIR__ . '/../vendor/autoload.php';

/**
 * Runs git without a shell; returns [exit code, trimmed output], or null when git can't be started.
 *
 * @param list<string> $arguments
 * @return array{int, string}|null
 */
function git(array $arguments, string $directory): ?array
{
    $process = @proc_open(['git', ...$arguments], [1 => ['pipe', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes, $directory);
    if (!is_resource($process)) {
        return null;
    }
    $output = (string) stream_get_contents($pipes[1]);
    fclose($pipes[1]);

    return [proc_close($process), trim($output)];
}

$backendDir = dirname(__DIR__);
$tag = git(['describe', '--exact-match', '--tags', 'HEAD'], $backendDir);
$sha = git(['rev-parse', '--short=7', 'HEAD'], $backendDir);
$status = git(['status', '--porcelain', '--untracked-files=no'], $backendDir);

if ($sha === null || $sha[0] !== 0 || $sha[1] === '' || $status === null || $status[0] !== 0) {
    echo Version::base($backendDir) . '+unknown', "\n";
    exit(0);
}

echo Version::format(Version::base($backendDir), $tag !== null && $tag[0] === 0 ? $tag[1] : null, $sha[1], $status[1] !== ''), "\n";
