# API tests

Tests of the complete Slim app in-process: real HTTP requests and responses, with ChurchTools replaced by a fake
implementation of the client interface. No network access.

This layer is set up in phase 2 of `specs/backend-plan.md` (item 2.0). See `specs/backend-spec.md`, section 6.6.
