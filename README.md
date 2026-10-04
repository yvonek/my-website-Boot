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
