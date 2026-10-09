# Account API test collection

Each endpoint has an `invoke.ps1` script in its matching folder. Start the API first, then run a script from PowerShell, for example:

```powershell
.\api-test-collections\account-api\http-health\invoke.ps1
```

The shared `invoke-api.ps1` runner reads these optional environment variables:

- `API_BASE_URL` (defaults to `http://127.0.0.1:3001`)
- `API_COOKIE` (session cookie, such as `rw_session=...`, for authenticated user/admin routes)
- `ADMIN_API_TOKEN` (bootstrap token for routes that accept `x-admin-token`)
- `API_TEST_BODY` (JSON request body for POST, PUT, and PATCH calls; defaults to `{}`)
- `API_TEST_IDEMPOTENCY_KEY` (optional stable purchase retry key for `http-purchases`; a fresh key is generated when the body does not include one)
- `API_TEST_ID`, `API_TEST_NAME`, and `API_TEST_CODE` (values substituted into matching dynamic route segments)

The scripts print the HTTP status and response body, including non-2xx responses. Registration, login, logout, and other state-changing requests affect the local SQLite database. Use a disposable development database when exercising those routes. Admin user-management routes require an Admin session cookie; the bootstrap token alone is not sufficient.
