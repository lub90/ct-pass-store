<?php

declare(strict_types=1);

namespace CtPassStore\Service;

class ChurchToolsStore extends ChurchToolsBaseService
{
    public function put(int $personId, string $encryptedPassword): void
    {
        $this->logger->info("Stub: would store password for person $personId");
        // Future: use $this->endpoint("persons/$personId/note") and $this->defaultHeaders()
    }

    public function delete(int $personId): void
    {
        $this->logger->info("Stub: would delete password for person $personId");
    }
}
