<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Deploy;

use PHPUnit\Framework\TestCase;

/**
 * The optional OPcache template (`config/php.ini-example`) ships with setup.sh, and an admin copies it to
 * `public/php.ini`. Files in `public/` are served as they are unless `public/.htaccess` denies them first.
 */
final class PhpIniTemplateTest extends TestCase
{
    private const BACKEND = __DIR__ . '/../../..';

    public function testPublicHtaccessDeniesPhpIniBeforeServingFiles(): void
    {
        $lines = file(self::BACKEND . '/public/.htaccess', FILE_IGNORE_NEW_LINES) ?: [];
        $deny = $routing = null;
        foreach ($lines as $number => $line) {
            if (preg_match('/^RewriteRule (\S+) - \[F,L,NC\]$/', $line, $m) === 1 && preg_match('~' . $m[1] . '~i', 'php.ini') === 1) {
                $deny = ['line' => $number, 'pattern' => '~' . $m[1] . '~i'];
            }
            if (str_starts_with($line, 'RewriteRule ^ index.php')) {
                $routing = $number;
            }
        }

        self::assertNotNull($deny, 'public/.htaccess has no deny rule for php.ini.');
        self::assertNotNull($routing, 'Slim routing rule not found.');
        self::assertLessThan($routing, $deny['line'], 'The php.ini deny rule must come before the routing rules.');
        self::assertSame(1, preg_match($deny['pattern'], 'PHP.INI'));
        self::assertSame(0, preg_match($deny['pattern'], 'index.php'));
        self::assertSame(0, preg_match($deny['pattern'], 'php.ini-example'));
    }

    public function testTheTemplateShipsAndEnablesOpcache(): void
    {
        $template = (string) file_get_contents(self::BACKEND . '/config/php.ini-example');
        $settings = parse_ini_string($template);

        self::assertIsArray($settings, 'config/php.ini-example is not valid INI.');
        self::assertSame('1', $settings['opcache.enable'] ?? null);
        self::assertSame('1', $settings['opcache.validate_timestamps'] ?? null, 'Uploaded updates must take effect.');
        self::assertStringContainsString('config/php.ini-example', (string) file_get_contents(self::BACKEND . '/setup/setup.sh'));
    }
}
