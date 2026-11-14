<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Logging;

/**
 * Monolog processor: control characters (newlines included) in the message and in context strings become `\xNN`, so
 * input that reaches the log can't forge additional log lines (spec 6.4).
 *
 * In valid UTF-8, the other Unicode controls become `\u{XXXX}` too: C1 controls, format characters (`\p{Cf}`, such as
 * the bidi override U+202E or U+200B) and the line and paragraph separators U+2028 and U+2029. They could reorder or
 * split what a reader sees, e.g. in a logged backend address. Invalid UTF-8 gets only the byte-wise escape.
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
            $value = (string) preg_replace_callback('/[\x00-\x1F\x7F]/', static fn(array $m): string => sprintf('\x%02X', ord($m[0])), $value);
            $unicode = preg_replace_callback('/[\p{Cc}\p{Cf}\x{2028}\x{2029}]/u', static fn(array $m): string => sprintf('\u{%04X}', mb_ord($m[0], 'UTF-8')), $value);

            return $unicode ?? $value;
        }

        return is_array($value) ? array_map(self::escape(...), $value) : $value;
    }
}
