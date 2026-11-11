<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\SelfCheck;

use CtPassStore\Application\SelfCheck\Check;
use CtPassStore\Application\SelfCheck\CheckOutcome;

/**
 * `config/credentials.php` is readable by PHP and not accessible to "other" (spec 3.1: 0600, or 0640 when the web
 * server's group must read it). Group read is allowed, group write is not (the file is `require`d code); messages name the file project-relative.
 */
final class CredentialsFileCheck implements Check
{
    public function __construct(private readonly string $path) {}

    public function name(): string
    {
        return 'Credentials file';
    }

    public function run(): CheckOutcome
    {
        clearstatcache(true, $this->path);
        $mode = @fileperms($this->path);
        if ($mode === false || !is_readable($this->path)) {
            return CheckOutcome::fail('config/credentials.php is missing or not readable by PHP.');
        }
        if (($mode & 0o027) !== 0) {
            return CheckOutcome::fail(sprintf('config/credentials.php is writable by its group or accessible to other users (mode %04o). Set it to 0600 or 0640.', $mode & 0o777));
        }

        return CheckOutcome::ok(sprintf('config/credentials.php is readable by PHP and closed to other users (mode %04o).', $mode & 0o777));
    }
}
