<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Logging;

use Monolog\Logger;

/**
 * Monolog processor: records of level `error` and above get the backend version in their context (spec 6.4, 6.5).
 * PHP has no single startup moment to log it, so every error entry carries it.
 *
 * Runs before EscapeControlCharacters (Kernel::logger()), because the version comes from a file and is escaped like
 * any other context value.
 */
final class AddVersionToErrors
{
    public function __construct(private readonly string $version) {}

    /**
     * @param array<string, mixed> $record
     * @return array<string, mixed>
     */
    public function __invoke(array $record): array
    {
        if (($record['level'] ?? 0) >= Logger::ERROR) {
            $record['context']['version'] = $this->version;
        }

        return $record;
    }
}
