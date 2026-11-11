<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure;

/**
 * The backend version string (spec 6.5): x.y.z, x.y.z+<sha> or x.y.z+<sha>-dirty.
 *
 * The web runtime never starts processes: it only reads version.txt, which bin/version.php writes at build time.
 */
final class Version
{
    private const PATTERN = '/^\d+\.\d+\.\d+(\+[0-9a-f]{7,40}(-dirty)?)?$/';

    /** Pure formatting: the bare version only for a clean checkout of exactly the tag v<base>. */
    public static function format(string $base, ?string $exactTag, string $sha, bool $dirty): string
    {
        if ($exactTag === 'v' . $base && !$dirty) {
            return $base;
        }

        return $base . '+' . $sha . ($dirty ? '-dirty' : '');
    }

    /** The version written by the build into version.txt, or `<base>+unknown`. Never calls git. */
    public static function current(string $backendDir): string
    {
        $content = @file_get_contents($backendDir . '/version.txt');
        if (is_string($content)) {
            $content = trim($content);
            if (preg_match(self::PATTERN, $content) === 1) {
                return $content;
            }
        }

        return self::base($backendDir) . '+unknown';
    }

    /** The base version x.y.z from the VERSION file. */
    public static function base(string $backendDir): string
    {
        $content = @file_get_contents($backendDir . '/VERSION');

        return is_string($content) ? trim($content) : '0.0.0';
    }
}
