<?php

declare(strict_types=1);

namespace CtPassStore\Application\Failure;

/**
 * An exception thrown on purpose, with its reason. Its message is safe to show to the client unless the reason's
 * problem type has a fixed text (upstream failures, whose messages are for the log).
 */
interface Failure extends \Throwable
{
    public function reason(): Reason;

    /**
     * Seconds after which a retry makes sense, for reasons that have one (rate limits).
     */
    public function retryAfterSeconds(): ?int;

    /**
     * The text for the client, or null if the message is only for the log (then the reason's fixed text is used).
     */
    public function publicDetail(): ?string;

    /**
     * Extra members for the client, e.g. `violations` (spec 4.9).
     *
     * @return array<string, mixed>
     */
    public function extensions(): array;
}
