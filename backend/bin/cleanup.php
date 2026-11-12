<?php

declare(strict_types=1);

// Deletes the password entries of persons who are deleted or archived in ChurchTools (cleanup design 4), for a
// server cron job. Dry run by default; `--apply` deletes. Exit codes: 0 done, 1 done with findings, 2 aborted.
// Usage: php bin/cleanup.php [--apply]

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit(1);
}

ini_set('display_errors', '0');

require __DIR__ . '/../vendor/autoload.php';

exit(CtPassStore\Kernel::runCleanup(
    __DIR__ . '/../config/credentials.php',
    __DIR__ . '/../cache',
    __DIR__ . '/../logs/app.log',
    array_slice($argv, 1),
));
