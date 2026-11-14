<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Contract\Helpers;

/**
 * Makes a response body safe for an assertion message: JSON only, every value under a key that contains `token`,
 * `secret`, `password`, `pwd` or `code` (any case, any separator) blanked at any depth; anything that isn't JSON is replaced
 * by a placeholder, so no part of it is shown.
 */
final class Redact
{
    private const MAX = 300;

    public static function body(string $body): string
    {
        try {
            $data = json_decode($body, true, 64, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return '<non-JSON body, ' . strlen($body) . ' bytes>';
        }
        if (!is_array($data)) {
            return '<JSON scalar, ' . strlen($body) . ' bytes>';
        }
        $json = json_encode(self::blank($data), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR);

        return substr($json === false ? '<unencodable>' : $json, 0, self::MAX);
    }

    private static function blank(mixed $value): mixed
    {
        if (!is_array($value)) {
            return $value;
        }
        $out = [];
        foreach ($value as $key => $item) {
            $secret = is_string($key) && preg_match('/token|secret|password|pwd|code/i', $key) === 1;
            $out[$key] = $secret ? '…' : self::blank($item);
        }

        return $out;
    }
}
