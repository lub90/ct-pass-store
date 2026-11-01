<?php

declare(strict_types=1);

// Code style configuration (see specs/backend-plan.md, item 0.3).
// Check with `composer cs`, fix with `composer cs:fix`.

$finder = (new PhpCsFixer\Finder())
    ->in([__DIR__ . '/src', __DIR__ . '/public', __DIR__ . '/tests', __DIR__ . '/config'])
    ->notPath('credentials.php')
    ->append([__FILE__]);

return (new PhpCsFixer\Config())
    ->setRules([
        '@PER-CS' => true,
        '@PHP83Migration' => true,
        'no_unused_imports' => true,
        'ordered_imports' => ['imports_order' => ['class', 'function', 'const'], 'sort_algorithm' => 'alpha'],
        'single_quote' => true,
        'no_extra_blank_lines' => true,
    ])
    ->setRiskyAllowed(false)
    ->setFinder($finder);
