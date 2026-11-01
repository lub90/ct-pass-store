<?php

declare(strict_types=1);

namespace CtPassStore\Controller;

use CtPassStore\Config\AppConfig;
use CtPassStore\Http\Problem\ProblemException;
use CtPassStore\Http\Problem\ProblemType;
use CtPassStore\Service\BaseService;
use CtPassStore\Service\ChurchToolsAuthVerifier;
use CtPassStore\Service\ChurchToolsStore;
use CtPassStore\Service\EncryptionService;
use CtPassStore\Service\PasswordValidator;
use CtPassStore\Service\ServiceSettings;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Message\ServerRequestInterface as Request;
use Psr\Log\LoggerInterface;

class PasswordController extends BaseService
{
    private ServiceSettings $settings;
    private ChurchToolsStore $store;
    private EncryptionService $encryption;
    private PasswordValidator $validator;
    private ChurchToolsAuthVerifier $authVerifier;

    public function __construct(
        ServiceSettings $settings,
        ChurchToolsStore $store,
        EncryptionService $encryption,
        PasswordValidator $validator,
        ChurchToolsAuthVerifier $authVerifier,
        LoggerInterface $logger
    ) {
        parent::__construct($logger);

        $this->settings = $settings;
        $this->store = $store;
        $this->encryption = $encryption;
        $this->validator = $validator;
        $this->authVerifier = $authVerifier;
    }

    public function get(Request $request, Response $response, array $args): ResponseInterface
    {
        $targetId = (int) $args['id'];

        $this->authorizeAndValidate($request, $targetId, false, true);

        $encryptedSecondaryPwd = $this->store->getPwd($targetId);

        if ($encryptedSecondaryPwd === null) {
            throw new ProblemException(ProblemType::EntryNotFound, "Person {$targetId} has no secondary password.");
        }

        return $response
            ->withHeader('Content-Type', 'application/json')
            ->withStatus(200)
            ->withBody((new \Slim\Psr7\Factory\StreamFactory())->createStream(json_encode([
                AppConfig::REQUEST_SECONDARY_PWD_FIELD => $encryptedSecondaryPwd,
            ])));
    }

    public function put(Request $request, Response $response, array $args): ResponseInterface
    {
        $targetId = (int) $args['id'];
        $user = $request->getAttribute(AppConfig::USER_ATTRIBUTE);
        $userId = $user->id;

        $body = $this->authorizeAndValidate($request, $targetId, true, false)['body'];

        $pwd = $body[AppConfig::REQUEST_SECONDARY_PWD_FIELD] ?? null;

        if ($pwd !== null) {
            if (!$this->settings->allowCustomPasswords()) {
                $this->logger->warning("User {$userId} tried to set a custom password, but it is not allowed to do so!");
                throw new ProblemException(ProblemType::CustomPasswordNotAllowed, 'Custom passwords are disabled; omit secondaryPwd to get a generated password.');
            }
        } else {
            $pwd = $this->validator->generateRandom($this->settings->pwdLength());
        }

        if (!$this->validator->isValid($pwd, $this->settings->pwdLength())) {
            $this->logger->info("User {$userId} tried to set a password with insufficient complexity!");
            throw new ProblemException(ProblemType::PasswordInvalid, "The password must have at least {$this->settings->pwdLength()} characters, contain a letter, a digit and one of ! @ \$ % & * - _ + = ? . and no other characters.");
        }

        $ciphertext = $this->encryption->encrypt($pwd);
        $this->store->putPwd($targetId, $ciphertext);

        if ($body[AppConfig::REQUEST_SECONDARY_PWD_FIELD] ?? null) {
            // Custom password was provided and stored
            return $response->withStatus(204);
        }

        // Password was generated — return it in JSON
        $response->getBody()->write(json_encode([
            AppConfig::REQUEST_SECONDARY_PWD_FIELD => $pwd,
        ]));
        return $response
            ->withHeader('Content-Type', 'application/json')
            ->withStatus(200);
    }

    public function delete(Request $request, Response $response, array $args): ResponseInterface
    {
        $targetId = (int) $args['id'];

        $this->authorizeAndValidate($request, $targetId, true, false);

        $this->store->deletePwd($targetId);
        return $response->withStatus(204);
    }

    private function authorizeAndValidate(
        ServerRequestInterface $request,
        int $targetId,
        bool $requirePasswordCheck,
        bool $checkReadAccess
    ): array {
        $user = $request->getAttribute(AppConfig::USER_ATTRIBUTE);
        $userId = $user->id;
        $cmsUserId = $user->username;

        if ($userId !== $targetId) {
            $hasSpecialAccess = in_array($userId, $this->settings->adminUsers(), true) || ($checkReadAccess && in_array($userId, $this->settings->readAccessUsers(), true));
            if (!$hasSpecialAccess) {
                $this->logger->warning("User {$userId} tried to read/update password for user {$targetId} but is not allowed to so!");
                throw new ProblemException(ProblemType::Forbidden, "You aren't allowed to access the entry of person {$targetId}.");
            }
        }

        $rawBody = (string) $request->getBody();
        $body = [];
        if ($rawBody !== '') {
            try {
                $body = json_decode($rawBody, true, 32, JSON_THROW_ON_ERROR);
            } catch (\JsonException) {
                $body = null;
            }
            if (!is_array($body) || ($body !== [] && array_is_list($body))) {
                $this->logger->warning("User {$userId} sent a body that isn't a JSON object.");
                throw new ProblemException(ProblemType::InvalidBody, 'The request body must be empty or a JSON object.');
            }
        }

        if ($requirePasswordCheck && $this->settings->requirePasswordForPasswordChange()) {
            $primaryPwd = (string) ($body[AppConfig::REQUEST_PRIMARY_PWD_FIELD] ?? '');
            if ($primaryPwd === '') {
                $this->logger->info("User {$userId} tried to update a password without providing a primary password!");
                throw new ProblemException(ProblemType::PrimaryPasswordRequired, 'This change needs your ChurchTools password in ' . AppConfig::REQUEST_PRIMARY_PWD_FIELD . '.');
            }

            if (!$this->authVerifier->verifyUserPassword($cmsUserId, $primaryPwd)) {
                // The verifier logs the failed check itself.
                throw new ProblemException(ProblemType::InvalidPrimaryPassword, 'The ChurchTools password is wrong.');
            }
        }

        return [
            'userId' => $userId,
            'cmsUserId' => $cmsUserId,
            'body' => $body,
        ];
    }
}
