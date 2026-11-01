<?php

declare(strict_types=1);

namespace CtPassStore\Application\Port;

use CtPassStore\Config\ConfigurationException;
use CtPassStore\Domain\Settings;

interface SettingsRepository
{
    /**
     * @throws ConfigurationException if the settings are missing or invalid
     */
    public function settings(): Settings;
}
