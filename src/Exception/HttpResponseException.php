<?php

namespace CtPassStore\Exception;

use Psr\Http\Message\ResponseInterface;
use RuntimeException;

class HttpResponseException extends RuntimeException
{
    private ResponseInterface $response;

    public function __construct(ResponseInterface $response)
    {
        parent::__construct('Intercepted HTTP response');
        $this->response = $response;
    }

    public function getResponse(): ResponseInterface
    {
        return $this->response;
    }
}