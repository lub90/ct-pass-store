<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Logging;

/**
 * Monolog processor: control characters (newlines included) in the message and in context strings become `\xNN`, so
 * input that reaches the log can't forge additional log lines (spec 6.4).
 *
 * In valid UTF-8, the other Unicode controls become `\u{XXXX}` too: C1 controls, format characters (`\p{Cf}`, such as
 * the bidi override U+202E or U+200B) and the line and paragraph separators U+2028 and U+2029. They could reorder or
 * split what a reader sees, e.g. in a logged backend address. In invalid UTF-8 the encodings of the most important
 * of them are escaped byte-wise (INVALID_UTF8_CONTROLS).
 */
final class EscapeControlCharacters
{
    /**
     * Byte sequences escaped in invalid UTF-8: C1 controls (U+0080-U+009F), U+061C, U+200B-U+200F, U+2028-U+202E,
     * U+2060-U+2069 and U+FEFF.
     */
    private const INVALID_UTF8_CONTROLS = '/\xC2[\x80-\x9F]|\xD8\x9C|\xE2\x80[\x8B-\x8F\xA8-\xAE]|\xE2\x81[\xA0-\xA9]|\xEF\xBB\xBF/';

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
            if ($unicode !== null) {
                return $unicode;
            }

            // Not valid UTF-8 (one stray byte is enough): the encodings of the controls that matter most are escaped
            // byte by byte, so the string can't turn the Unicode escape off.
            return (string) preg_replace_callback(self::INVALID_UTF8_CONTROLS, static fn(array $m): string => implode('', array_map(static fn(string $b): string => sprintf('\x%02X', ord($b)), str_split($m[0]))), $value);
        }

        return is_array($value) ? array_map(self::escape(...), $value) : $value;
    }
}
