<?php

declare(strict_types=1);

namespace CtPassStore\Http\Controller;

use CtPassStore\Auth\AuthenticatedPerson;
use CtPassStore\Config\AppConfig;
use CtPassStore\Http\JsonBody;
use CtPassStore\Http\PathId;
use CtPassStore\Http\Problem\ProblemException;
use CtPassStore\Http\Problem\ProblemType;
use CtPassStore\Service\BaseService;
use CtPassStore\Service\ChurchToolsAuthVerifier;
use CtPassStore\Service\ChurchToolsStore;
use CtPassStore\Service\EncryptionService;
use CtPassStore\Service\PasswordValidator;
use CtPassStore\Service\ServiceSettings;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Log\LoggerInterface;

/**
 * `GET|PUT|DELETE /entries/{id}`.
 *
 * Order of checks (spec 4.1): authentication (middleware) → path ID and body syntax → authorization (before any
 * entry is looked up) → primary password → password policy → storage.
 */
class EntriesController extends BaseService
{
    /** Bodies of PUT and DELETE (spec 4.6, 4.7). */
    private const PUT_FIELDS = [AppConfig::REQUEST_PRIMARY_PWD_FIELD => 'string', AppConfig::REQUEST_SECONDARY_PWD_FIELD => 'string'];
    private const DELETE_FIELDS = [AppConfig::REQUEST_PRIMARY_PWD_FIELD => 'string'];

    public function __construct(
        private readonly ServiceSettings $settings,
        private readonly ChurchToolsStore $store,
        private readonly EncryptionService $encryption,
        private readonly PasswordValidator $validator,
        private readonly ChurchToolsAuthVerifier $authVerifier,
        LoggerInterface $logger,
    ) {
        parent::__construct($logger);
    }

    /**
     * @param array<string, string> $args
     */
    public function get(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        $targetId = PathId::parse($args['id'] ?? null);
        $this->authorize($request, $targetId, true);

        $ciphertext = $this->store->getPwd($targetId);
        if ($ciphertext === null) {
            throw new ProblemException(ProblemType::EntryNotFound, "Person {$targetId} has no secondary password.");
        }

        return $this->json($response, 200, [AppConfig::REQUEST_SECONDARY_PWD_FIELD => $ciphertext]);
    }

    /**
     * @param array<string, string> $args
     */
    public function put(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        $targetId = PathId::parse($args['id'] ?? null);
        $body = JsonBody::parse($request, self::PUT_FIELDS);
        $user = $this->authorize($request, $targetId, false);
        $this->checkPrimaryPassword($user, $body);

        $custom = $body[AppConfig::REQUEST_SECONDARY_PWD_FIELD] ?? null;
        if ($custom !== null) {
            if (!$this->settings->allowCustomPasswords()) {
                $this->logger->warning("User {$user->id} tried to set a custom password, but custom passwords are disabled.");
                throw new ProblemException(ProblemType::CustomPasswordNotAllowed, 'Custom passwords are disabled; omit secondaryPwd to get a generated password.');
            }
            $violations = $this->validator->violations($custom, $this->settings->pwdLength());
            if ($violations !== []) {
                $this->logger->info("User {$user->id} tried to set a password that doesn't meet the policy.");
                throw new ProblemException(ProblemType::PasswordInvalid, sprintf(
                    'The password must have %d to %d characters, contain a letter, a digit and one of ! @ $ %% & * - _ + = ? . and no other characters.',
                    $this->settings->pwdLength(),
                    PasswordValidator::MAX_LENGTH,
                ), ['violations' => $violations]);
            }
            $password = $custom;
        } else {
            $password = $this->validator->generateRandom($this->settings->pwdLength());
        }

        // Stored first; a generated password is only returned once it's saved (spec 4.6).
        $this->store->putPwd($targetId, $this->encryption->encrypt($password));

        if ($custom !== null) {
            return $response->withStatus(204);
        }

        return $this->json($response, 200, [AppConfig::REQUEST_SECONDARY_PWD_FIELD => $password]);
    }

    /**
     * @param array<string, string> $args
     */
    public function delete(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        $targetId = PathId::parse($args['id'] ?? null);
        $body = JsonBody::parse($request, self::DELETE_FIELDS);
        $user = $this->authorize($request, $targetId, false);
        $this->checkPrimaryPassword($user, $body);

        $this->store->deletePwd($targetId);

        return $response->withStatus(204);
    }

    /**
     * Throws `403 forbidden` unless the caller may act on the target's entry. Runs before the entry is looked up,
     * so the answer never reveals whether it exists.
     */
    private function authorize(ServerRequestInterface $request, int $targetId, bool $isRead): AuthenticatedPerson
    {
        $user = $request->getAttribute(AppConfig::USER_ATTRIBUTE);
        if (!$user instanceof AuthenticatedPerson) {
            throw new \LogicException('The request has no authenticated person.');
        }

        if ($user->id !== $targetId) {
            $allowed = in_array($user->id, $this->settings->adminUsers(), true)
                || ($isRead && in_array($user->id, $this->settings->readAccessUsers(), true));
            if (!$allowed) {
                $this->logger->warning("User {$user->id} tried to access the entry of person {$targetId} without permission.");
                throw new ProblemException(ProblemType::Forbidden, "You aren't allowed to access the entry of person {$targetId}.");
            }
        }

        return $user;
    }

    /**
     * @param array<string, string> $body
     */
    private function checkPrimaryPassword(AuthenticatedPerson $user, array $body): void
    {
        if (!$this->settings->requirePasswordForPasswordChange()) {
            return;
        }

        $primary = $body[AppConfig::REQUEST_PRIMARY_PWD_FIELD] ?? '';
        if ($primary === '') {
            $this->logger->info("User {$user->id} tried to change an entry without the required primary password.");
            throw new ProblemException(ProblemType::PrimaryPasswordRequired, 'This change needs your ChurchTools password in ' . AppConfig::REQUEST_PRIMARY_PWD_FIELD . '.');
        }

        // The username comes from the authenticated person, never from the request (spec 4.6).
        if (!$this->authVerifier->verifyUserPassword($user->username, $primary)) {
            throw new ProblemException(ProblemType::InvalidPrimaryPassword, 'The ChurchTools password is wrong.');
        }
    }

    /**
     * @param array<string, mixed> $data
     */
    private function json(ResponseInterface $response, int $status, array $data): ResponseInterface
    {
        $response->getBody()->write(json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES));

        return $response->withHeader('Content-Type', 'application/json')->withStatus($status);
    }
}
