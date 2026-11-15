<?php

declare(strict_types=1);

// Checks a release before it is built (spec 6.6, catalog DP-03): the tag is `backend-v` plus the VERSION file, CHANGELOG.md
// has a section `## [<version>] - <YYYY-MM-DD>` with a real date, and MAJOR.MINOR equals that of ../extension/package.json
// (AG-12, specs/versioning.md). Prints that section (the release notes) on success,
// one line per problem on stderr otherwise; exits 0 or 1.
// Usage: php bin/release-check.php <tag> [backend folder]

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit(1);
}

/**
 * @return array{list<string>, string} the problems, and the CHANGELOG section (empty when there are problems)
 */
function checkRelease(string $tag, string $backendDir): array
{
    $versionFile = (string) @file_get_contents("$backendDir/VERSION");
    $version = trim($versionFile);
    if (preg_match('/^\d+\.\d+\.\d+$/', $version) !== 1) {
        return [['VERSION does not contain a version x.y.z'], ''];
    }
    if ($tag !== "backend-v$version") {
        return [["Tag $tag does not match VERSION: expected backend-v$version"], ''];
    }

    $package = @file_get_contents(dirname($backendDir) . '/extension/package.json');
    $decoded = is_string($package) ? json_decode($package, true) : null;
    $extensionVersion = is_array($decoded) && is_string($decoded['version'] ?? null) ? $decoded['version'] : '';
    if (preg_match('/^(\d+\.\d+)\.\d+/', $extensionVersion, $extension) !== 1) {
        return [['extension/package.json is missing or has no version x.y.z'], ''];
    }
    $majorMinor = implode('.', array_slice(explode('.', $version), 0, 2));
    if ($majorMinor !== $extension[1]) {
        return [["MAJOR.MINOR $majorMinor differs from the extension's {$extension[1]} (versioning.md)"], ''];
    }

    $changelog = (string) @file_get_contents("$backendDir/CHANGELOG.md");
    $lines = preg_split('/\R/', $changelog) ?: [];
    $section = [];
    $found = false;
    foreach ($lines as $line) {
        if (str_starts_with($line, '## ')) {
            if ($found) {
                break;
            }
            if (preg_match('/^## \[' . preg_quote($version, '/') . '\](?: - (.*))?$/', $line, $matches) === 1) {
                $found = true;
                $date = trim($matches[1] ?? '');
                $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $date);
                if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) !== 1 || $parsed === false || $parsed->format('Y-m-d') !== $date) {
                    return [["CHANGELOG.md: section [$version] has no valid date (YYYY-MM-DD), found '$date'"], ''];
                }
            }
        }
        if ($found) {
            $section[] = $line;
        }
    }
    if (!$found) {
        return [["CHANGELOG.md has no section '## [$version] - YYYY-MM-DD'"], ''];
    }

    return [[], trim(implode("\n", array_slice($section, 1))) . "\n"];
}

$tag = $argv[1] ?? '';
if ($tag === '' && !isset($argv[1])) {
    fwrite(STDERR, "Usage: php bin/release-check.php <tag> [backend folder]\n");
    exit(1);
}

[$problems, $notes] = checkRelease($tag, rtrim($argv[2] ?? dirname(__DIR__), '/'));
foreach ($problems as $problem) {
    fwrite(STDERR, $problem . "\n");
}
if ($problems === []) {
    echo $notes;
}
exit($problems === [] ? 0 : 1);
