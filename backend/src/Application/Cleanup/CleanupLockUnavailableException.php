<?php

declare(strict_types=1);

namespace CtPassStore\Application\Cleanup;

/**
 * The lock file can't be opened (missing or read-only cache folder). Not the same as a lock that is held.
 */
final class CleanupLockUnavailableException extends \RuntimeException {}
