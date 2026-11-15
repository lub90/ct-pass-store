<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\SelfCheck;

use CtPassStore\Application\SelfCheck\Check;
use CtPassStore\Application\SelfCheck\CheckOutcome;

/**
 * Whether OPcache is on and checks for changed files (`validate_timestamps`). It replaces a phpinfo() page, so it
 * reports these two values only and nothing else about the host (no paths, memory figures or versions). OPcache is
 * optional, so the check never fails.
 */
final class OpcacheCheck implements Check
{
    /** @var \Closure(): (array<string, mixed>|false) */
    private readonly \Closure $status;

    /** @var \Closure(string): (string|false) */
    private readonly \Closure $ini;

    /**
     * @param (\Closure(): (array<string, mixed>|false))|null $status `opcache_get_status(false)` by default
     * @param (\Closure(string): (string|false))|null $ini `ini_get()` by default
     */
    public function __construct(?\Closure $status = null, ?\Closure $ini = null)
    {
        // Without the extension there's no function; with `opcache.restrict_api` it returns false and warns.
        $this->status = $status ?? static fn(): array|false => function_exists('opcache_get_status') ? @opcache_get_status(false) : false;
        $this->ini = $ini ?? static fn(string $name): string|false => ini_get($name);
    }

    public function name(): string
    {
        return 'OPcache';
    }

    public function run(): CheckOutcome
    {
        $status = ($this->status)();
        if (!is_array($status) || ($status['opcache_enabled'] ?? false) !== true) {
            return CheckOutcome::ok('OPcache is off (see docs/setup.md to turn it on).');
        }

        $validate = ($this->ini)('opcache.validate_timestamps');
        $validate = $validate === false ? null : filter_var($validate, FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE);

        return CheckOutcome::ok(match ($validate) {
            true => 'OPcache is on; validate_timestamps is on.',
            false => 'OPcache is on; validate_timestamps is off, so uploaded updates and a changed config/credentials.php take effect only after an OPcache reset or a PHP restart.',
            null => 'OPcache is on; validate_timestamps is unknown.',
        });
    }
}
