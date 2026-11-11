<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\SelfCheck;

use CtPassStore\Application\SelfCheck\Check;
use CtPassStore\Application\SelfCheck\CheckOutcome;
use CtPassStore\Infrastructure\Store\SignedFileStore;

/**
 * `cache/` is closed to other users (0700, or 0770 with the web server's group), supports file locks and stays below the file limit (spec 3.1, 6.1).
 */
final class CacheFolderCheck implements Check
{
    public const MAX_FILES = 10000;

    public function __construct(
        private readonly string $directory,
        private readonly SignedFileStore $store,
    ) {}

    public function name(): string
    {
        return 'Cache folder';
    }

    public function run(): CheckOutcome
    {
        // The probe creates the folder (0700) if it is missing, so it runs first.
        $locking = $this->store->probeLocking();
        clearstatcache(true, $this->directory);
        $mode = @fileperms($this->directory);
        if ($mode === false || !is_dir($this->directory) || !is_writable($this->directory)) {
            return CheckOutcome::fail('cache/ does not exist or is not writable by PHP.');
        }
        if (($mode & 0o007) !== 0) {
            return CheckOutcome::fail(sprintf('cache/ is accessible to other users (mode %04o). Set it to 0700, or to 0770 with the web server\'s group when PHP runs as the web server user.', $mode & 0o777));
        }
        if (!$locking) {
            return CheckOutcome::fail('File locking does not work in cache/; the login limits would not hold on this file system.');
        }
        $count = $this->store->fileCount();
        if ($count > self::MAX_FILES) {
            return CheckOutcome::fail("cache/ holds $count files, more than the limit of " . self::MAX_FILES . '. Empty the folder.');
        }

        return CheckOutcome::ok("cache/ is closed to other users, locking works, $count files.");
    }
}
