<?php

declare(strict_types=1);

namespace CtPassStore\Http\Controller;

use CtPassStore\Application\Auth\AddressLimit;
use CtPassStore\Application\Exception\TooManyAttemptsException;
use CtPassStore\Application\Login;
use CtPassStore\Application\Port\AddressLimiter;
use CtPassStore\Http\JsonBody;
use CtPassStore\Http\Problem\ProblemException;
use CtPassStore\Http\Problem\ProblemType;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Log\LoggerInterface;

/**
 * `POST /v1/auth/token` (spec 4.4). Needs no access token.
 */
final class AuthController
{
    /** The longest accepted value of each field (spec 4.4, catalog AX-10a). */
    public const MAX_FIELD_LENGTH = 2048;

    private const FIELDS = ['code' => 'string', 'codeVerifier' => 'string', 'redirectUri' => 'string'];

    public function __construct(
        private readonly Login $login,
        private readonly AddressLimiter $limiter,
        private readonly LoggerInterface $logger,
    ) {}

    public function token(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        // First of all, before the body is read and before any ChurchTools call (spec 6.3, 6.2).
        $ip = (string) ($request->getServerParams()['REMOTE_ADDR'] ?? '');
        try {
            $this->limiter->hit(AddressLimit::Login, $ip);
        } catch (TooManyAttemptsException $blocked) {
            $this->logger->warning('Too many login attempts from this address.', ['ip' => $ip]);
            throw $blocked;
        }

        $body = JsonBody::parse($request, self::FIELDS);
        foreach (array_keys(self::FIELDS) as $field) {
            $value = $body[$field] ?? '';
            if ($value === '' || strlen($value) > self::MAX_FIELD_LENGTH) {
                throw new ProblemException(ProblemType::InvalidBody, sprintf('%s is required and may have at most %d characters.', $field, self::MAX_FIELD_LENGTH));
            }
        }

        $issued = $this->login->execute($body['code'], $body['codeVerifier'], $body['redirectUri']);

        $response->getBody()->write(json_encode([
            'accessToken' => $issued->token,
            'tokenType' => 'Bearer',
            'expiresIn' => $issued->expiresIn,
        ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES));

        return $response->withHeader('Content-Type', 'application/json')->withStatus(200);
    }
}
