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
        // A RewriteCond binds to the next RewriteRule and would make the deny conditional.
        $previous = null;
        for ($i = $deny['line'] - 1; $i >= 0; $i--) {
            $trimmed = trim($lines[$i]);
            if ($trimmed !== '' && !str_starts_with($trimmed, '#')) {
                $previous = $trimmed;
                break;
            }
        }
        self::assertFalse(
            $previous !== null && stripos($previous, 'RewriteCond') === 0,
            'No RewriteCond may come directly before the php.ini deny rule.',
        );
        self::assertSame(1, preg_match($deny['pattern'], 'PHP.INI'));
        self::assertSame(0, preg_match($deny['pattern'], 'index.php'));
        self::assertSame(0, preg_match($deny['pattern'], 'php.ini-example'));
    }

    /**
     * Security M1: when `public/` is the web root, `../.htaccess` isn't read, so `public/.htaccess` must deny hidden
     * files (`.user.ini`, `.htaccess`) and `php.ini` itself, independent of the rewrite rules.
     *
     * @return iterable<string, array{string, bool}>
     */
    public static function publicFiles(): iterable
    {
        yield '.user.ini' => ['.user.ini', true];
        yield '.htaccess' => ['.htaccess', true];
        yield '.env' => ['.env', true];
        yield 'php.ini' => ['php.ini', true];
        yield 'PHP.INI' => ['PHP.INI', true];
        yield 'index.php' => ['index.php', false];
        yield 'php.ini-example' => ['php.ini-example', false];
        yield 'my.php.ini' => ['my.php.ini', false];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('publicFiles')]
    public function testPublicHtaccessDeniesHiddenFilesAndPhpIniWithoutRewrite(string $file, bool $denied): void
    {
        $matched = false;
        foreach ($this->deniedFilesMatchPatterns() as $pattern) {
            $matched = $matched || preg_match('~' . str_replace('~', '\\~', $pattern) . '~', $file) === 1;
        }

        self::assertSame($denied, $matched, "$file in public/.htaccess FilesMatch denies");
    }

    /**
     * @return list<string> the patterns of `<FilesMatch>` blocks in public/.htaccess that deny access on Apache 2.4
     *     (`Require all denied`) and on 2.2 (`Deny from all`)
     */
    private function deniedFilesMatchPatterns(): array
    {
        $htaccess = (string) file_get_contents(self::BACKEND . '/public/.htaccess');
        preg_match_all('~^<FilesMatch "([^"]+)">\R(.*?)^</FilesMatch>~ms', $htaccess, $blocks, PREG_SET_ORDER);
        $patterns = [];
        foreach ($blocks as [, $pattern, $body]) {
            if (preg_match('~^\s*Require all denied$~m', $body) === 1 && preg_match('~^\s*Deny from all$~m', $body) === 1) {
                $patterns[] = $pattern;
            }
        }

        return $patterns;
    }

    public function testTheTemplateEnablesOpcache(): void
    {
        $settings = $this->template();

        self::assertSame('opcache.so', $settings['zend_extension'] ?? null);
        self::assertTrue($this->flag($settings, 'opcache.enable'));
        self::assertSame(64, $settings['opcache.memory_consumption'] ?? null);
        self::assertSame(8, $settings['opcache.interned_strings_buffer'] ?? null);
        self::assertSame(4000, $settings['opcache.max_accelerated_files'] ?? null);
        self::assertTrue($this->flag($settings, 'opcache.validate_timestamps'), 'Uploaded updates must take effect.');
        self::assertSame(2, $settings['opcache.revalidate_freq'] ?? null, 'Uploaded updates take effect within seconds.');
    }

    /**
     * Security M2: a folder php.ini may replace the host's whole configuration, so it sets the safe values itself.
     */
    public function testTheTemplateHardensErrorOutputAndSharedCaches(): void
    {
        $settings = $this->template();

        self::assertFalse($this->flag($settings, 'display_errors'), 'Errors must not reach the client.');
        self::assertFalse($this->flag($settings, 'display_startup_errors'));
        self::assertTrue($this->flag($settings, 'log_errors'));
        self::assertFalse($this->flag($settings, 'expose_php'));
        self::assertTrue($this->flag($settings, 'opcache.validate_permission'));
        self::assertTrue($this->flag($settings, 'opcache.validate_root'));
    }

    /**
     * Security M3: no phpinfo() step; GET /v1/test reports the OPcache status instead.
     */
    public function testTheTemplateDoesNotAskForPhpinfo(): void
    {
        $template = (string) file_get_contents(self::BACKEND . '/config/php.ini-example');

        self::assertStringNotContainsStringIgnoringCase('phpinfo', $template);
        self::assertStringContainsString('/v1/test', $template);
    }

    public function testSetupShipsTheTemplate(): void
    {
        $lines = file(self::BACKEND . '/setup/setup.sh', FILE_IGNORE_NEW_LINES) ?: [];

        $copiesTemplate = preg_grep('~^cp "\$BACKEND_DIR/config/credentials-example\.php" "\$BACKEND_DIR/config/php\.ini-example" "\$BUILD_DIR/config"/$~', $lines);
        $shipsConfig = preg_grep('~^cp -r .*"\$BUILD_DIR/config" .*"\$TARGET_DIR"/$~', $lines);

        self::assertCount(1, $copiesTemplate ?: [], 'setup.sh must copy config/php.ini-example into the build.');
        self::assertCount(1, $shipsConfig ?: [], 'setup.sh must copy the built config/ into the target.');
    }

    /**
     * @param array<string, mixed> $settings
     * @return bool|null null when the setting is missing or not a boolean
     */
    private function flag(array $settings, string $key): ?bool
    {
        $value = $settings[$key] ?? null;

        return is_bool($value) || is_int($value) ? filter_var($value, FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) : null;
    }

    /**
     * @return array<string, mixed>
     */
    private function template(): array
    {
        $settings = parse_ini_string((string) file_get_contents(self::BACKEND . '/config/php.ini-example'), false, INI_SCANNER_TYPED);
        self::assertIsArray($settings, 'config/php.ini-example is not valid INI.');

        return $settings;
    }
}
