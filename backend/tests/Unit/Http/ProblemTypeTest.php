<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Unit\Http;

use CtPassStore\Http\Problem\ProblemType;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Catalog ER-03: every problem type is documented in docs/problems.md with the same status and title as in the code,
 * and the page documents no type the code doesn't know.
 */
final class ProblemTypeTest extends TestCase
{
    private const DOCS = __DIR__ . '/../../../docs/problems.md';

    /**
     * @return array<string, array{status: int, title: string}> documented types by slug
     */
    private static function documentedTypes(): array
    {
        $markdown = (string) file_get_contents(self::DOCS);
        preg_match_all('/^## (\S+)\n\n- \*\*Status:\*\* (\d{3})\n- \*\*Title:\*\* (.+)$/m', $markdown, $matches, PREG_SET_ORDER);

        $types = [];
        foreach ($matches as [, $slug, $status, $title]) {
            $types[$slug] = ['status' => (int) $status, 'title' => $title];
        }

        return $types;
    }

    /**
     * @return iterable<string, array{ProblemType}>
     */
    public static function types(): iterable
    {
        foreach (ProblemType::cases() as $type) {
            yield $type->value => [$type];
        }
    }

    #[DataProvider('types')]
    public function testEveryTypeIsDocumentedWithTheSameStatusAndTitle(ProblemType $type): void
    {
        $documented = self::documentedTypes()[$type->value] ?? null;

        self::assertNotNull($documented, "docs/problems.md has no section for {$type->value}.");
        self::assertSame($type->status(), $documented['status']);
        self::assertSame($type->title(), $documented['title']);
    }

    public function testTheDocsDocumentNoUnknownTypes(): void
    {
        $known = array_map(static fn(ProblemType $t): string => $t->value, ProblemType::cases());

        self::assertSame([], array_values(array_diff(array_keys(self::documentedTypes()), $known)));
    }

    #[DataProvider('types')]
    public function testTypeUriPointsToItsDocsSection(ProblemType $type): void
    {
        self::assertSame('https://github.com/lub90/ct-pass-store/blob/main/backend/docs/problems.md#' . $type->value, $type->uri());
        self::assertMatchesRegularExpression('/^[a-z]+(-[a-z]+)*$/', $type->value);
    }
}
