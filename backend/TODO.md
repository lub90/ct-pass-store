TODO:


- Add installation instructions referencing openapi-generator and compose (in general, and add version to generated churchtools-api -> "version": "0.1.0",)

- Do end2end testing to ensure, that backend works properly
- Rename ServiceSettings to ChurchtoolsServiceSettings
- Consistent Writing of ChurchtTools vs. Churchtools
- Implement Cross Origin availability

- What happens with MFA activated -> Do we accept even if only password is provided?
- Write tests for everything
- Move timeout for the different parts communicating with the Churchtools API to a consistent file
- Add comments to each class

- What about paging?

- Test HTTPS with .htaccess and add it to the installation instructions!

- Enable true MFA for the ChurchtoolsAuthVerifier
- 40* returns different json formatted message between AuthMiddleware and PasswordController -> Make the same
- Make logger log all exceptions and warnings from php! (use setDefaultErrorHandler from Slim)
- Logging with Monolog has these strange [] [] at the end of each log
- Implement a cron job file, that should be called to clean up the database, and remove non-existent users from the key value store