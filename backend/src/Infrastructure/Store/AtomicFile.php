<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Store;

/**
 * Atomic file replacement for the security store and the cache (spec 6.1).
 *
 * The content goes to a new temporary file next to the target (`600` before any content is in it), is flushed to disk
 * and then moved over the target with `rename`. A request killed mid-write leaves the old content intact, never an
 * empty file. The temporary file is named `<path>.<random>.tmp`.
 */
final class AtomicFile
{
    /**
     * @throws \RuntimeException if the file can't be written; no temporary file is left behind
     */
    public static function write(string $path, string $content): void
    {
        $temporary = $path . '.' . bin2hex(random_bytes(8)) . '.tmp';
        $handle = @fopen($temporary, 'x');
        if ($handle === false) {
            throw new \RuntimeException('the file can\'t be created');
        }
        $written = @chmod($temporary, 0o600)
            && fwrite($handle, $content) === strlen($content)
            && fflush($handle)
            && fsync($handle);
        fclose($handle);
        if (!$written || !@rename($temporary, $path)) {
            @unlink($temporary);
            throw new \RuntimeException('the file can\'t be written');
        }
    }
}
