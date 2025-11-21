<?php

declare(strict_types=1);

namespace CtPassStore\Controller;

use Psr\Http\Message\ServerRequestInterface as Request;
use Psr\Http\Message\ResponseInterface as Response;

use CtPassStore\Service\ServiceSettings;
use CtPassStore\Service\ChurchToolsStore;
use CtPassStore\Service\EncryptionService;
use CtPassStore\Service\PasswordValidator;
use CtPassStore\Service\BaseService;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Log\LoggerInterface;
use CtPassStore\Service\ChurchtoolsAuthVerifier;
use CtPassStore\Exception\HttpResponseException;
use CtPassStore\Config\AppConfig;

class PasswordController extends BaseService
{
    private ServiceSettings $settings;
    private ChurchToolsStore $store;
    private EncryptionService $encryption;
    private PasswordValidator $validator;
    private ChurchtoolsAuthVerifier $authVerifier;

    public function __construct(
        ServiceSettings $settings,
        ChurchToolsStore $store,
        EncryptionService $encryption,
        PasswordValidator $validator,
        ChurchtoolsAuthVerifier $authVerifier,
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

        try {
            $this->authorizeAndValidate($request, $targetId, false, true);
        } catch (HttpResponseException $errorResponse) {
            return $errorResponse->getResponse();
        }

        $encryptedSecondaryPwd = $this->store->getPwd($targetId);

        if ($encryptedSecondaryPwd === null) {
            return $this->error(404, 'Not Found','No password entry found for this user.');
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
        $userId = (int) $user[AppConfig::CT_USER_ID_FIELD];

        try {
            $data = $this->authorizeAndValidate($request, $targetId, true, false);
            $body = $data['body'];
        } catch (HttpResponseException $errorResponse) {
            return $errorResponse->getResponse();
        }
        
        $pwd = $body[AppConfig::REQUEST_SECONDARY_PWD_FIELD] ?? null;

        if ($pwd !== null) {
            if (!$this->settings->allowCustomPasswords()) {
                $this->logger->warning("User {$userId} tried to set a custom password, but it is not allowed to do so!");
                return $this->error(400, 'Invalid parameters','Custom passwords are not allowed!');
            }
        } else {
            $pwd = $this->validator->generateRandom($this->settings->pwdLength());
        }

        if (!$this->validator->isValid($pwd, $this->settings->pwdLength())) {
            $this->logger->info("User {$userId} tried to set a password with insufficient complexity!");
            return $this->error(400, "Invalid parameters","Password must contain at least one letter, digit, and symbol, and be at least {$this->settings->pwdLength()}!");
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

        try {
            $this->authorizeAndValidate($request, $targetId, true, false);
        } catch (HttpResponseException $errorResponse) {
            return $errorResponse->getResponse();
        }

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
        $userId = (int) $user[AppConfig::CT_USER_ID_FIELD];
        $cmsUserId = (string) $user[AppConfig::CT_USER_NAME_FIELD];

        if ($userId !== $targetId) {
            $hasSpecialAccess = in_array($userId, $this->settings->adminUsers(), true) || ($checkReadAccess && in_array($userId, $this->settings->readAccessUsers(), true));
            if (!$hasSpecialAccess) {
                $this->logger->warning("User {$userId} tried to read/update password for user {$targetId} but is not allowed to so!");
                throw new HttpResponseException(
                    $this->error(403, 'Forbidden', 'Not authorized to read/modify this entry!')
                );
            }
        }

        $rawBody = $request->getBody()->getContents();
        $body = json_decode($rawBody, true);
        
        if (json_last_error() !== JSON_ERROR_NONE) {
            $this->logger->warning("User {$userId} tried to send an invalid body, that cannot be converted to json!");
                throw new HttpResponseException(
                    $this->error(400, 'Bad Request', 'Body is not json!')
                );
        }

        if ($requirePasswordCheck && $this->settings->requirePasswordForPasswordChange()) {
            $primaryPwd = (string) ($body[AppConfig::REQUEST_PRIMARY_PWD_FIELD] ?? '');
            if ($primaryPwd === '') {
                $this->logger->info("User {$userId} tried to update a password without providing a primary password!");
                throw new HttpResponseException(
                    $this->error(400, 'Invalid parameters', "Missing " . AppConfig::REQUEST_PRIMARY_PWD_FIELD . " for password change!")
                );
            }

            if (!$this->authVerifier->verifyUserPassword($cmsUserId, $primaryPwd)) {
                //authVerifier does his own logging during checks
                throw new HttpResponseException(
                    $this->error(401, 'Invalid parameters', 'Invalid primary password')
                );
            }
        }

        return [
            'userId' => $userId,
            'cmsUserId' => $cmsUserId,
            'body' => $body,
        ];
    }


    private function error(int $status, string $error, string $message): ResponseInterface
    {
        $response = new \Slim\Psr7\Response($status);
        $response->getBody()->write(json_encode(['error' => $error, 'message' => $message]));
        return $response->withHeader('Content-Type', 'application/json');
    }

    private function json(int $status): ResponseInterface
    {
        return (new \Slim\Psr7\Response($status))->withHeader('Content-Type', 'application/json');
    }
}
