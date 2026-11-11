<?php

declare(strict_types=1);

namespace CtPassStore\Http\Controller;

use CtPassStore\Application\DeletePassword;
use CtPassStore\Application\Exception\AccessDeniedException;
use CtPassStore\Application\GetPassword;
use CtPassStore\Application\SetPassword;
use CtPassStore\Domain\PersonId;
use CtPassStore\Domain\Principal;
use CtPassStore\Http\JsonBody;
use CtPassStore\Http\Middleware\AuthMiddleware;
use CtPassStore\Http\PathId;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Log\LoggerInterface;

/**
 * `GET|PUT|DELETE /entries/{id}`: parses the request, runs the use case and writes the response.
 *
 * Order of checks (spec 4.1): authentication (middleware) → path ID and body syntax (here) → authorization →
 * primary password → password policy → storage (use cases).
 */
final class EntriesController
{
    private const PRIMARY_PASSWORD = 'primaryPwd';
    private const SECONDARY_PASSWORD = 'secondaryPwd';

    /** Bodies of PUT and DELETE (spec 4.6, 4.7). */
    private const PUT_FIELDS = [self::PRIMARY_PASSWORD => 'string', self::SECONDARY_PASSWORD => 'string'];
    private const DELETE_FIELDS = [self::PRIMARY_PASSWORD => 'string'];

    public function __construct(
        private readonly GetPassword $getPassword,
        private readonly SetPassword $setPassword,
        private readonly DeletePassword $deletePassword,
        private readonly LoggerInterface $logger,
    ) {}

    /**
     * @param array<string, string> $args
     */
    public function get(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        $target = PathId::parse($args['id'] ?? null);
        $ciphertext = $this->denialLogged($request, $target, fn(): string => $this->getPassword->execute(self::principal($request), $target));

        return self::json($response, 200, [self::SECONDARY_PASSWORD => $ciphertext]);
    }

    /**
     * @param array<string, string> $args
     */
    public function put(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        $target = PathId::parse($args['id'] ?? null);
        $body = JsonBody::parse($request, self::PUT_FIELDS);

        $generated = $this->denialLogged($request, $target, fn(): ?string => $this->setPassword->execute(
            self::principal($request),
            $target,
            $body[self::SECONDARY_PASSWORD] ?? null,
            $body[self::PRIMARY_PASSWORD] ?? null,
        ));

        return $generated === null
            ? $response->withStatus(204)
            : self::json($response, 200, [self::SECONDARY_PASSWORD => $generated]);
    }

    /**
     * @param array<string, string> $args
     */
    public function delete(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        $target = PathId::parse($args['id'] ?? null);
        $body = JsonBody::parse($request, self::DELETE_FIELDS);

        $this->denialLogged($request, $target, fn() => $this->deletePassword->execute(self::principal($request), $target, $body[self::PRIMARY_PASSWORD] ?? null));

        return $response->withStatus(204);
    }

    /**
     * Runs the use case; a denial is logged as a warning with the caller and `REMOTE_ADDR` (spec 6.3, 6.4) and then
     * answered as before.
     *
     * @template T
     * @param \Closure(): T $useCase
     * @return T
     */
    private function denialLogged(ServerRequestInterface $request, PersonId $target, \Closure $useCase): mixed
    {
        try {
            return $useCase();
        } catch (AccessDeniedException $e) {
            $this->logger->warning(ucfirst(self::principal($request)->describe()) . " tried to access the entry of person {$target} without permission.", [
                'ip' => (string) ($request->getServerParams()['REMOTE_ADDR'] ?? ''),
            ]);
            throw $e;
        }
    }

    private static function principal(ServerRequestInterface $request): Principal
    {
        $principal = $request->getAttribute(AuthMiddleware::PRINCIPAL);
        if (!$principal instanceof Principal) {
            throw new \LogicException('The request has no authenticated principal.');
        }

        return $principal;
    }

    /**
     * @param array<string, string> $data
     */
    private static function json(ResponseInterface $response, int $status, array $data): ResponseInterface
    {
        $response->getBody()->write(json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES));

        return $response->withHeader('Content-Type', 'application/json')->withStatus($status);
    }
}
