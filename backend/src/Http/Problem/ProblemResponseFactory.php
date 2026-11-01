<?php

declare(strict_types=1);

namespace CtPassStore\Http\Problem;

use Psr\Http\Message\ResponseInterface;
use Slim\Psr7\Response;

/**
 * Builds `application/problem+json` responses (spec 4.9).
 */
final class ProblemResponseFactory
{
    public static function fromException(ProblemException $problem): ResponseInterface
    {
        return self::create($problem->type, $problem->detail, $problem->extensions, $problem->headers);
    }

    /**
     * @param array<string, mixed> $extensions
     * @param array<string, string> $headers
     */
    public static function create(ProblemType $type, string $detail, array $extensions = [], array $headers = []): ResponseInterface
    {
        $body = [
            'type' => $type->uri(),
            'title' => $type->title(),
            'status' => $type->status(),
            'detail' => $detail,
        ] + $extensions;

        $response = new Response($type->status());
        $response->getBody()->write(json_encode($body, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE));
        $response = $response->withHeader('Content-Type', 'application/problem+json');
        foreach ($headers as $name => $value) {
            $response = $response->withHeader($name, $value);
        }

        return $response;
    }
}
