<?php

declare(strict_types=1);

namespace CtPassStore\Application\Port;

/**
 * Marks an exception that means "the other side couldn't be asked at all" (network error, timeout, server error).
 * Only such outages withdraw a primary-password attempt (spec 6.3): every other answer means the attempt arrived.
 */
interface UpstreamOutage extends \Throwable {}
