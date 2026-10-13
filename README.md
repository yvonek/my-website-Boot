# Rwanda Wealth Account Console

## Local development

The frontend uses a local HTTP API backed by SQLite. Start the API and Vite in separate terminals:

```sh
npm run migrate
npm run api
npm run dev
```

Vite proxies `/api` requests to the API on port `3001`. The database starts with an empty schema; no sample records are created. `API_PORT` and `DATABASE_PATH` can override the API defaults.

## API routes

- `GET /api/health` checks that the API and database are available.
- `GET /api/dashboard` returns the dashboard metrics, plans, referrals, and support tools.

To roll back the latest schema migration, run `npm run migrate:rollback` while the API is stopped.

## Production deployment

On Vercel, `/api/*` is rewritten to the catch-all route in `api/[...path].js`. That route forwards requests and session cookies to the Neon `accountapi` Function. It uses `BACKEND_API_URL` when set; otherwise it falls back to the production Function URL in that route. The Function uses the linked Neon branch's PostgreSQL database. The local Vite proxy is different: it sends requests to the local SQLite API, so changes made from localhost do not appear on the deployed site.

1. Deploy `neon.ts` to the intended Neon branch with `neon deploy --branch <branch> --no-env-pull`.
2. If that branch uses a different `accountapi` invocation URL, set Vercel's `BACKEND_API_URL` to that Function's base URL. Do not include `/api` in the value. If it is unset, the checked-in fallback is used.
3. Redeploy Vercel after changing the environment variable. Do not set `DATABASE_URL` on Vercel for this architecture; Neon injects it into the Function for the linked branch.
4. Check `https://<vercel-domain>/api/health`, then test country loading, sign-up, sign-in, session restore, and an authenticated admin save followed by a regular-user read.

The existing SQLite records should be imported once with `backend/migrate-sqlite-to-neon.mjs`; first rehearse and compare row counts and financial totals on an isolated branch. Never run the one-time importer against an already populated production schema.
