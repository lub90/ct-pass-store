# API tests

Tests of the complete Slim app in-process: real HTTP requests and responses, with ChurchTools replaced by
`tests/Support/FakeChurchToolsClient`. No network access. See `specs/backend-spec.md`, section 6.6.

- `ApiTestCase` builds the app through `CtPassStore\Application::create()` with the fake, a test logger and test
  settings, and offers `request()`, `assertProblem()`, `seedEntry()`, `storedEntries()` and `decrypt()`.
- The fake records every call (`calls()`, `writeCount()`), so tests can assert that a request wrote nothing, and can
  make single calls fail (`failNext()`).
