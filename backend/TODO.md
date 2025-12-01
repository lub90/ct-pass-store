TODO:

Tests:

- Add tests where valid passwords were put, but custom password is not allowed
- Add tests where invalid passwords are given (unallowed chars, too short, not enough entropy)
- Add tests for requirePasswordForPasswordChange = true
- Add tests for DELETE

- Currently, wrong method for an endpoint throws an internal server error, but check response towards client...
- Implement Cross Origin availability
- Optimize calls to backend to be more efficient by putting ExtensionDataContainer into its own container
- Implement and test 2FA with requirePasswordForPasswordChange = true
- Add installation instructions referencing openapi-generator and compose (in general, and add version to generated churchtools-api -> "version": "0.1.0",)
- Add to test that the log file is not readible from the outside!
- Implement AbstractTestPrototpype so that we check for every category, that we don't have side effects
- Implement tests and behavior so that wrong http method on existing endpoint returns 405 Method Not Allowed - with no side effect at all
- Implement test for unknown endpoints or missing queried ids in the entries endpoint - with no side effect at all

- Rename ServiceSettings to ChurchtoolsServiceSettings
- Consistent Writing of ChurchtTools vs. Churchtools

- What happens with MFA activated -> Do we accept even if only password is provided?

- Move timeout for the different parts communicating with the Churchtools API to a consistent file
- Add comments to each class

- Write unit tests for everything
- What about paging?

- Test HTTPS with .htaccess and add it to the installation instructions!

- Enable true MFA for the ChurchtoolsAuthVerifier
- 40* returns different json formatted message between AuthMiddleware and PasswordController -> Make the same
- Make logger log all exceptions and warnings from php! (use setDefaultErrorHandler from Slim)
- Logging with Monolog has these strange [] [] at the end of each log
- Implement a cron job file, that should be called to clean up the database, and remove non-existent users from the key value store