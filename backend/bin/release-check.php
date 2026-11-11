<?php

declare(strict_types=1);

// Checks a release before it is built (spec 6.6, catalog DP-03): the tag is `v` plus the VERSION file, and CHANGELOG.md
// has a section `## [<version>] - <YYYY-MM-DD>` with a real date. Prints that section (the release notes) on success,
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
    if ($tag !== "v$version") {
        return [["Tag $tag does not match VERSION: expected v$version"], ''];
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
