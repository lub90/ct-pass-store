<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Load\Helpers;

/**
 * The load test's results file (security review M7). It is always created new, with `O_CREAT | O_EXCL` (`fopen` mode
 * `x`) under umask `077`, so it is `600` from the first moment and an existing file is never overwritten. PHP resolves
 * symlinks before it opens, so `x` alone would create the target of a dangling symlink: a link at the path is
 * therefore refused before the open, and after it the open file must be the path itself (same inode, not a link),
 * which catches a link planted in between. The default name is random, so nobody can plant anything there. Later
 * writes go through the same open handle, never through the path again.
 */
final class ResultsFile
{
    /**
     * @param resource $handle
     */
    private function __construct(public readonly string $path, private $handle) {}

    /**
     * @param string|false $configured LOAD_RESULTS_FILE as getenv() returns it; false or empty for a new file with a
     *     random name in $tempDir
     */
    public static function create(string|false $configured, string $tempDir): self
    {
        $path = $configured !== false && $configured !== ''
            ? $configured
            : rtrim($tempDir, '/') . '/ctps-load-results-' . bin2hex(random_bytes(8)) . '.json';

        if (is_link($path)) {
            throw new \RuntimeException("The results file $path is a link; remove it or choose another LOAD_RESULTS_FILE.");
        }
        $umask = umask(0o077);
        try {
            $handle = @fopen($path, 'x');
        } finally {
            umask($umask);
        }
        if ($handle === false) {
            throw new \RuntimeException(file_exists($path)
                ? "The results file $path already exists; remove it or choose another LOAD_RESULTS_FILE."
                : "Can't create the results file $path.");
        }

        if (!self::isFileAt($handle, $path)) {
            fclose($handle);
            throw new \RuntimeException("The results file $path changed while it was created (a link?); nothing was written.");
        }

        return new self($path, $handle);
    }

    /**
     * Whether the open handle is the file at the path itself: same inode and device, and the path is no link.
     *
     * @param resource $handle
     */
    public static function isFileAt($handle, string $path): bool
    {
        $opened = fstat($handle);
        clearstatcache();
        $atPath = @lstat($path);

        return $opened !== false && $atPath !== false && !is_link($path)
            && $opened['ino'] === $atPath['ino'] && $opened['dev'] === $atPath['dev'];
    }

    /**
     * @param array<string, mixed> $results
     */
    public function write(array $results): void
    {
        $json = json_encode($results, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR);
        if (!ftruncate($this->handle, 0) || !rewind($this->handle) || fwrite($this->handle, $json) !== strlen($json) || !fflush($this->handle)) {
            throw new \RuntimeException("Can't write the results file {$this->path}.");
        }
    }

    public function close(): void
    {
        if (is_resource($this->handle)) {
            fclose($this->handle);
        }
    }
}
