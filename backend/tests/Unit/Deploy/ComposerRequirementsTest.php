<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Deploy;

use PHPUnit\Framework\TestCase;

/**
 * The PHP extensions the backend calls directly are declared, so Composer refuses an installation without them instead
 * of a fatal error at the first machine token or log line.
 */
final class ComposerRequirementsTest extends TestCase
{
    public function testTheExtensionsInUseAreRequired(): void
    {
        $composer = json_decode((string) file_get_contents(__DIR__ . '/../../../composer.json'), true, 512, JSON_THROW_ON_ERROR);
        self::assertIsArray($composer);

        // sodium: Ed25519 machine clients (MachineClient, token checks); mbstring: mb_ord in the log escaping.
        foreach (['ext-mbstring', 'ext-sodium'] as $extension) {
            self::assertArrayHasKey($extension, $composer['require'], $extension);
            self::assertSame('*', $composer['require'][$extension]);
        }
    }
}
