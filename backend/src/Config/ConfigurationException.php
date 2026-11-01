<?php

declare(strict_types=1);

namespace CtPassStore\Config;

/**
 * Something an admin has to fix: configuration, settings, the public key, the extension's data structure in
 * ChurchTools or the service user's rights. Reported as `500 misconfigured` with the message as `detail`, so the
 * message must name what's wrong and never contain a secret value.
 */
final class ConfigurationException extends \RuntimeException {}
