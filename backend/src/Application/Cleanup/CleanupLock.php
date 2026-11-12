<?php

declare(strict_types=1);

namespace CtPassStore\Application\Cleanup;

/**
 * Keeps two cleanups from running at once (cleanup design 6.3): an exclusive, non-blocking `flock` on a file in the
 * cache folder. The operating system drops the lock when the process ends, so a crash can't leave it stuck.
 */
final class CleanupLock
{
    /** @var resource|null */
    private $handle;

    public function __construct(private readonly string $lockFile) {}

    /**
     * @return bool false if another cleanup holds the lock
     * @throws CleanupLockUnavailableException if the lock file can't be opened
     */
    public function tryAcquire(): bool
    {
        if ($this->handle !== null) {
            return false;
        }
        $dir = dirname($this->lockFile);
        if (!is_dir($dir)) {
            @mkdir($dir, 0o700, true);
        }
        $handle = @fopen($this->lockFile, 'c');
        if ($handle === false) {
            throw new CleanupLockUnavailableException("Can't open the lock file {$this->lockFile}.");
        }
        if (!flock($handle, LOCK_EX | LOCK_NB)) {
            fclose($handle);

            return false;
        }
        $this->handle = $handle;

        return true;
    }

    public function release(): void
    {
        if ($this->handle === null) {
            return;
        }
        flock($this->handle, LOCK_UN);
        fclose($this->handle);
        $this->handle = null;
    }
}
