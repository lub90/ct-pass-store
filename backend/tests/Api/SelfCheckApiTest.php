<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Api;

/**
 * Today's behavior of `/test` (plan item 2.0). Phase 4 (item 4.2) extends the checks and restricts access to admins.
 */
final class SelfCheckApiTest extends ApiTestCase
{
    public function testAllChecksPassWithAValidSetup(): void
    {
        $response = $this->request('GET', '/test', self::USER);

        self::assertSame(200, $response->getStatusCode());
        $body = $this->json($response);
        self::assertIsString($body['summary']);
        self::assertIsArray($body['tests']);
        self::assertNotEmpty($body['tests']);
        foreach ($body['tests'] as $test) {
            self::assertIsArray($test);
            self::assertSame('ok', $test['status'], (string) $test['name']);
        }
    }

    public function testBrokenSettingsAreReportedAs207(): void
    {
        $this->churchTools->clearValues($this->categoryIds['settings']);

        $response = $this->request('GET', '/test', self::USER);

        self::assertSame(207, $response->getStatusCode());
        $failed = array_filter($this->json($response)['tests'], static fn(array $t): bool => $t['status'] === 'fail');
        self::assertNotEmpty($failed);
    }

    public function testRequiresAuthentication(): void
    {
        $this->assertProblem(\CtPassStore\Http\Problem\ProblemType::MissingToken, $this->request('GET', '/test'));
    }
}
