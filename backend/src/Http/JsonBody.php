<?php

declare(strict_types=1);

namespace CtPassStore\Http;

use CtPassStore\Http\Problem\ProblemException;
use CtPassStore\Http\Problem\ProblemType;
use Psr\Http\Message\ServerRequestInterface;

/**
 * Reads a request body according to spec 4.1.
 *
 * - An empty body is an empty object.
 * - A non-empty body needs `Content-Type: application/json` (optionally `charset=utf-8`), else `415`.
 * - More than 16 KB is `413`, checked before parsing.
 * - The body must be valid UTF-8 JSON with at most 32 levels of nesting, a single object, without duplicate keys,
 *   with only the fields the endpoint defines and with the defined types; else `400 invalid-body`.
 */
final class JsonBody
{
    public const MAX_BYTES = 16 * 1024;
    public const MAX_DEPTH = 32;

    /**
     * @param array<string, 'string'> $fields the allowed fields and their types
     * @return array<string, string> the fields that are present
     *
     * @throws ProblemException
     */
    public static function parse(ServerRequestInterface $request, array $fields): array
    {
        $raw = self::read($request);
        if ($raw === '') {
            return [];
        }

        self::assertJsonContentType($request->getHeaderLine('Content-Type'));

        try {
            // PHP counts one level more than there are nesting levels: an empty object already needs depth 2.
            $decoded = json_decode($raw, true, self::MAX_DEPTH + 1, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw self::invalid('The request body isn\'t valid JSON in UTF-8 (or it\'s nested too deeply).');
        }
        if (!is_array($decoded) || ($decoded !== [] && array_is_list($decoded)) || !str_starts_with(ltrim($raw, " \t\n\r"), '{')) {
            throw self::invalid('The request body must be a JSON object.');
        }
        self::assertNoDuplicateKeys($raw);

        $result = [];
        foreach ($decoded as $name => $value) {
            if (!array_key_exists((string) $name, $fields)) {
                throw self::invalid(sprintf('The field "%s" isn\'t allowed here. Allowed fields: %s.', self::printable((string) $name), implode(', ', array_keys($fields)) ?: 'none'));
            }
            if (!is_string($value)) {
                throw self::invalid(sprintf('The field "%s" must be a string.', $name));
            }
            $result[(string) $name] = $value;
        }

        return $result;
    }

    private static function read(ServerRequestInterface $request): string
    {
        $body = $request->getBody();
        $size = $body->getSize();
        if ($size !== null && $size > self::MAX_BYTES) {
            throw self::tooLarge();
        }
        if ($body->isSeekable()) {
            $body->rewind();
        }
        // Streams may return less than asked for, so read until the end, but never more than one byte past the limit.
        $raw = '';
        while (!$body->eof() && strlen($raw) <= self::MAX_BYTES) {
            $chunk = $body->read(self::MAX_BYTES + 1 - strlen($raw));
            if ($chunk === '') {
                break;
            }
            $raw .= $chunk;
        }
        if (strlen($raw) > self::MAX_BYTES) {
            throw self::tooLarge();
        }

        return $raw;
    }

    private static function assertJsonContentType(string $header): void
    {
        $parts = array_map('trim', explode(';', strtolower($header)));
        $type = array_shift($parts);
        $params = array_values(array_filter($parts, static fn(string $p): bool => $p !== ''));
        if ($type !== 'application/json' || ($params !== [] && $params !== ['charset=utf-8'])) {
            throw new ProblemException(ProblemType::UnsupportedMediaType, 'Send the request body as JSON with Content-Type: application/json.');
        }
    }

    /**
     * json_decode silently keeps the last of duplicate keys, so the value that's checked could differ from the one
     * another parser would use. This scans the keys of the top-level object.
     */
    private static function assertNoDuplicateKeys(string $json): void
    {
        $keys = [];
        $depth = 0;
        $expectKey = false;
        $length = strlen($json);

        for ($i = 0; $i < $length; $i++) {
            $char = $json[$i];
            if ($char === '"') {
                $start = $i;
                for ($i++; $i < $length && $json[$i] !== '"'; $i++) {
                    if ($json[$i] === '\\') {
                        $i++;
                    }
                }
                if ($depth === 1 && $expectKey) {
                    $key = json_decode(substr($json, $start, $i - $start + 1));
                    if (isset($keys[$key])) {
                        throw self::invalid(sprintf('The field "%s" appears more than once.', self::printable((string) $key)));
                    }
                    $keys[$key] = true;
                    $expectKey = false;
                }
            } elseif ($char === '{' || $char === '[') {
                $depth++;
                $expectKey = $char === '{' && $depth === 1;
            } elseif ($char === '}' || $char === ']') {
                $depth--;
            } elseif ($char === ',' && $depth === 1) {
                $expectKey = true;
            }
        }
    }

    private static function printable(string $value): string
    {
        return mb_substr((string) preg_replace('/[^\x20-\x7E]/', '?', $value), 0, 40);
    }

    private static function invalid(string $detail): ProblemException
    {
        return new ProblemException(ProblemType::InvalidBody, $detail);
    }

    private static function tooLarge(): ProblemException
    {
        return new ProblemException(ProblemType::PayloadTooLarge, 'The request body must not be larger than ' . self::MAX_BYTES . ' bytes.');
    }
}
