<?php

declare(strict_types=1);

// Checks a deploy folder before upload (spec 6.6, catalog DP-01): no real credentials.php, no dev files, no instance
// URL or login token, and the expected layout. Prints one line per problem; exits 0 when the folder is clean, else 1.
// Independent of setup.sh and of the autoloader, so it also runs on a release zip that was unpacked (spec 6.5).
// Usage: php bin/check-deploy.php <folder>

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit(1);
}

/**
 * Placeholders that are allowed to name church.tools: the example credentials and comments in the sources use them.
 */
const PLACEHOLDER_HOSTS = ['your.church.tools', 'example.church.tools'];

/** A run of this many letters and digits looks like a login token (ChurchTools tokens are 64+ characters). */
const TOKEN_LENGTH = 100;

/**
 * @return list<string> one message per problem, with paths relative to the folder
 */
function checkDeployFolder(string $folder): array
{
    $problems = [];

    foreach (['public/index.php', 'vendor/autoload.php', 'version.txt'] as $required) {
        if (!is_file("$folder/$required")) {
            $problems[] = "Missing required file: $required";
        }
    }
    if (!is_dir("$folder/src")) {
        $problems[] = 'Missing required folder: src';
    }

    if (file_exists("$folder/config/credentials.php")) {
        $problems[] = 'Forbidden: config/credentials.php (only credentials-example.php may be deployed)';
    }
    foreach (glob("$folder/phpunit.xml*") ?: [] as $file) {
        $problems[] = 'Forbidden dev file: ' . basename($file);
    }
    foreach (['tests', '.git'] as $forbiddenFolder) {
        if (file_exists("$folder/$forbiddenFolder")) {
            $problems[] = "Forbidden: $forbiddenFolder/";
        }
    }
    foreach (['phpunit', 'phpstan', 'friendsofphp'] as $tool) {
        if (file_exists("$folder/vendor/$tool")) {
            $problems[] = "Forbidden dev tool in vendor: vendor/$tool";
        }
    }

    // Content scan outside vendor/ (dependencies legitimately contain long strings and URLs). Links aren't followed.
    $files = new RecursiveIteratorIterator(
        new RecursiveCallbackFilterIterator(
            new RecursiveDirectoryIterator($folder, FilesystemIterator::SKIP_DOTS),
            static fn(SplFileInfo $entry, string $key, RecursiveDirectoryIterator $iterator): bool => !$entry->isLink()
                && !in_array($iterator->getSubPathname(), ['vendor', '.git', 'tests'], true),
        ),
    );
    $problems = array_merge($problems, scanFiles($folder, $files));
    sort($problems);

    return $problems;
}

/**
 * @param iterable<SplFileInfo> $files
 * @return list<string>
 */
function scanFiles(string $folder, iterable $files): array
{
    $problems = [];
    foreach ($files as $file) {
        if (!$file->isFile()) {
            continue;
        }
        $content = (string) file_get_contents($file->getPathname());
        $relative = substr($file->getPathname(), strlen($folder) + 1);
        if (str_contains(str_replace(PLACEHOLDER_HOSTS, '', $content), 'church.tools')) {
            $problems[] = "Instance URL (church.tools) in $relative";
        }
        // The token itself is never printed.
        if (preg_match('/[A-Za-z0-9]{' . TOKEN_LENGTH . ',}/', $content) === 1) {
            $problems[] = 'Something that looks like a login token (' . TOKEN_LENGTH . "+ letters and digits in a row) in $relative";
        }
    }

    return $problems;
}

$folder = $argv[1] ?? '';
if ($folder === '' || !is_dir($folder)) {
    fwrite(STDERR, "Usage: php bin/check-deploy.php <folder>\n");
    exit(1);
}

$problems = checkDeployFolder(rtrim($folder, '/'));
foreach ($problems as $problem) {
    echo $problem, "\n";
}
if ($problems === []) {
    echo "Deploy check passed: $folder\n";
}
exit($problems === [] ? 0 : 1);
