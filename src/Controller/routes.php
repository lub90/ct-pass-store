<?php

declare(strict_types=1);

use Slim\App;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

return function (App $app): void {

    // Dummy GET endpoint
    $app->get('/get/{id}', function (Request $request, Response $response, array $args): Response {
        $response->getBody()->write(json_encode([
            'data' => 'dummy-password-value',
            'id' => $args['id'],
            'owner' => 'dummy-user-id'
        ]));
        return $response->withHeader('Content-Type', 'application/json');
    });

    // Dummy PUT endpoint
    $app->put('/put/{id}', function (Request $request, Response $response, array $args): Response {
        // Just return 204 No Content for now
        return $response->withStatus(204);
    });
};
