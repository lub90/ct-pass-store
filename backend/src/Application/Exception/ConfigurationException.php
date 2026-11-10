<?php

declare(strict_types=1);

namespace CtPassStore\Application\Exception;

use CtPassStore\Application\Failure\Failure;
use CtPassStore\Application\Failure\FailureDefaults;
use CtPassStore\Application\Failure\Reason;

/**
 * The backend's setup is broken: `credentials.php`, the extension settings, the security store, or what ChurchTools
 * says about the backend's own credentials. The message names what's wrong and how to fix it, never a secret value;
 * the client gets it as the detail of `500 misconfigured` (spec 3.1, 3.2). The reason tells the cause apart in the log.
 */
final class ConfigurationException extends \RuntimeException implements Failure
{
    use FailureDefaults;

    public function __construct(string $message, private readonly Reason $reason = Reason::SettingsInvalid)
    {
        parent::__construct($message);
    }

    public function reason(): Reason
    {
        return $this->reason;
    }

    public function publicDetail(): string
    {
        return $this->getMessage();
    }
}
