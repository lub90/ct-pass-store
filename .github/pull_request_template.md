## What and why

<!-- What does this change, and why? Link the plan item (specs/backend-plan.md) or issue. -->

## Tests

<!-- Which catalog cases (specs/backend-test-catalog.md) does this cover? New cases go into the catalog first. -->

- [ ] `composer check` passes in `backend/` (code style, PHPStan, unit and API tests)
- [ ] Contract tests run against the test instance, if ChurchTools behavior is involved (`composer test:e2e`)

## Security checklist

- [ ] No secret, token, password or ciphertext is compared with `==` or `===`; secrets use `hash_equals()`
- [ ] No secret, token, password, authorization code or ciphertext is logged or put into a problem `detail`
- [ ] New problem types are added to `ProblemType` and documented in `backend/docs/problems.md`
- [ ] User input reaches ChurchTools URLs, file names and log lines only validated or escaped
- [ ] The spec (`specs/backend-spec.md`) still describes the behavior
