<?php

declare(strict_types=1);

namespace CtPassStore\Http\Problem;

/**
 * Ends a request with a problem details response (spec 4.9). Thrown anywhere, turned into a response by the
 * error middleware.
 */
final class ProblemException extends \RuntimeException
{
    /**
     * @param array<string, mixed> $extensions extension members such as `violations` or `retryAfter`
     * @param array<string, string> $headers additional response headers such as `Allow` or `Retry-After`
     */
    public function __construct(
        public readonly ProblemType $type,
        public readonly string $detail,
        public readonly array $extensions = [],
        public readonly array $headers = [],
        ?\Throwable $previous = null,
    ) {
        parent::__construct($type->value . ': ' . $detail, 0, $previous);
    }
}
