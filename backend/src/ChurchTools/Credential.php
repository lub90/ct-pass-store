<?php

declare(strict_types=1);

namespace CtPassStore\ChurchTools;

/**
 * A credential for calling the ChurchTools API: either a login token (`Authorization: Login …`) or an OAuth
 * access token (`Authorization: Bearer …`).
 *
 * The secret value is never exposed through string conversion, var_dump(), print_r(), var_export(), an array cast or
 * serialization, so it can't end up in logs or exception messages by accident. It's kept outside the object's
 * properties, in a map keyed by the object.
 */
final class Credential
{
    /** @var \WeakMap<self, string>|null */
    private static ?\WeakMap $tokens = null;

    private function __construct(
        private readonly string $scheme,
        #[\SensitiveParameter]
        string $token,
    ) {
        if ($token === '' || preg_match('/\s/', $token) === 1) {
            throw new \InvalidArgumentException('A ChurchTools credential must be a non-empty token without whitespace.');
        }
        self::$tokens ??= new \WeakMap();
        self::$tokens[$this] = $token;
    }

    public static function loginToken(#[\SensitiveParameter] string $token): self
    {
        return new self('Login', $token);
    }

    public static function bearerToken(#[\SensitiveParameter] string $token): self
    {
        return new self('Bearer', $token);
    }

    public function authorizationHeader(): string
    {
        return $this->scheme . ' ' . (self::$tokens[$this] ?? throw new \LogicException('Credential without token.'));
    }

    public function scheme(): string
    {
        return $this->scheme;
    }

    public function __toString(): string
    {
        return $this->scheme . ' [redacted]';
    }

    /**
     * @return array<string, string>
     */
    public function __debugInfo(): array
    {
        return ['scheme' => $this->scheme, 'token' => '[redacted]'];
    }

    public function __serialize(): array
    {
        throw new \LogicException('Credentials must not be serialized.');
    }
}
