<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Api;

use PHPUnit\Framework\Attributes\DataProvider;

/**
 * Catalog EC-04 and EC-05 (spec 4.1, 6.3): encoded and traversing paths address exactly the caller's own entry, or
 * nothing (400/404). They never reach another person's entry, another endpoint or a file.
 */
final class PathApiTest extends ApiTestCase
{
    private const OWN = 'b3du';
    private const FOREIGN = 'Zm9yZWlnbg==';

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedEntry(self::USER, self::OWN);
        $this->seedEntry(self::OTHER, self::FOREIGN);
    }

    /**
     * USER is person 10, OTHER is person 11.
     *
     * @return iterable<string, array{string}>
     */
    public static function paths(): iterable
    {
        yield 'percent-encoded own ID' => ['/v1/entries/%31%30'];
        yield 'NUL after the ID' => ['/v1/entries/10%00'];
        yield 'NUL before another ID' => ['/v1/entries/10%0011'];
        yield 'double encoded' => ['/v1/entries/%2531%2530'];
        yield 'encoded slash and dots' => ['/v1/entries/10%2F..%2F11'];
        yield 'encoded slash to the self-check' => ['/v1/entries/10%2F..%2F..%2Ftest'];
        yield 'trailing slash' => ['/v1/entries/10/'];
        yield 'other case' => ['/v1/Entries/10'];
        yield 'double slash' => ['/v1/entries//11'];
        yield 'dot segment to the self-check' => ['/v1/entries/../test'];
        yield 'encoded dot segment' => ['/v1/entries/..%2Ftest'];
        yield 'dot segment to another ID' => ['/v1/entries/10/../11'];
        yield 'credentials file' => ['/../config/credentials.php'];
        yield 'encoded credentials file' => ['/%2E%2E/config/credentials.php'];
        yield 'semicolon parameter' => ['/v1/entries/10;11'];
        yield 'space-padded' => ['/v1/entries/%2011'];
    }

    #[DataProvider('paths')]
    public function testPathsReachOnlyTheOwnEntryOrNothing(string $path): void
    {
        $response = $this->request('GET', $path, self::USER);
        $body = (string) $response->getBody();

        self::assertStringNotContainsString(self::FOREIGN, $body, 'Another person\'s entry was reached.');
        self::assertStringNotContainsString('"summary"', $body, 'The self-check was reached.');
        self::assertStringNotContainsString('CT_API_TOKEN', $body);
        if ($response->getStatusCode() === 200) {
            self::assertSame(['secondaryPwd' => self::OWN], $this->json($response), 'Only the own entry may come back.');
        } else {
            self::assertContains($response->getStatusCode(), [400, 404], $body);
        }
    }

    #[DataProvider('paths')]
    public function testPathsChangeNothingButTheOwnEntry(string $path): void
    {
        $this->request('DELETE', $path, self::USER, []);

        $foreign = array_filter($this->storedEntries(), static fn(array $e): bool => $e['personId'] === self::OTHER);
        self::assertCount(1, $foreign, 'Another person\'s entry was deleted.');
    }
}
