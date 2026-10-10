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

Vercel rewrites `/api/*` directly to the Neon Function declared in `neon.ts`; no `BACKEND_API_URL` variable is needed. The Function uses the linked branch's PostgreSQL database and preserves the app's phone/password and session contract.

1. Deploy `neon.ts` to the intended Neon branch with `neon deploy --branch <branch> --no-env-pull`.
2. Set the `/api/*` rewrite in `vercel.json` to that branch's `accountapi` invocation URL.
3. Redeploy Vercel. Check `https://<vercel-domain>/api/health`, then test country loading, sign-up, sign-in, and session restore.

The existing SQLite records should be imported once with `backend/migrate-sqlite-to-neon.mjs`; first rehearse and compare row counts and financial totals on an isolated branch. Never run the one-time importer against an already populated production schema.
