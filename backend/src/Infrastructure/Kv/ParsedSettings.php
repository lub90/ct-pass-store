<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Kv;

use CtPassStore\Domain\Settings;

/**
 * The parsed settings and what was ignored or disabled on the way (for the log and `/test`).
 */
final class ParsedSettings
{
    /**
     * @param list<string> $findings
     */
    public function __construct(
        public readonly Settings $settings,
        public readonly array $findings,
    ) {}
}
