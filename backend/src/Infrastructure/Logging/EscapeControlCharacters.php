<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Logging;

/**
 * Monolog processor: control characters (newlines included) in the message and in context strings become `\xNN`, so
 * input that reaches the log can't forge additional log lines (spec 6.4).
 */
final class EscapeControlCharacters
{
    /**
     * @param array<string, mixed> $record
     * @return array<string, mixed>
     */
    public function __invoke(array $record): array
    {
        $record['message'] = self::escape($record['message'] ?? '');
        $record['context'] = self::escape($record['context'] ?? []);

        return $record;
    }

    private static function escape(mixed $value): mixed
    {
        if (is_string($value)) {
            return (string) preg_replace_callback('/[\x00-\x1F\x7F]/', static fn(array $m): string => sprintf('\x%02X', ord($m[0])), $value);
        }

        return is_array($value) ? array_map(self::escape(...), $value) : $value;
    }
}
