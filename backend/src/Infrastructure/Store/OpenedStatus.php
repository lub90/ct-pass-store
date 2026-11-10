<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Store;

/**
 * What `RecordSigner::open()` found in a record file (spec 6.1).
 */
enum OpenedStatus
{
    /** Signed with the current key and intact, or no content yet. */
    case Valid;
    /** Signed with another key (`JWT_SECRET` was rotated); not trusted, the record starts over. */
    case OldKey;
    /** Signed with the current key, or not a record at all, and the check failed. */
    case Tampered;
}
