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

The Vercel frontend forwards `/api/*` requests through `api/[...path].js` to a separately hosted API. `render.yaml` defines the Node API service and its persistent SQLite disk; the service uses Render's `PORT` and runs migrations before starting.

1. In Render, create a Blueprint from this repository and deploy the `rwanda-wealth-api` service. The `starter` service and persistent disk are paid Render resources.
2. Copy the service URL, then add `BACKEND_API_URL` in the Vercel project's Environment Variables. Use the API origin only, for example `https://rwanda-wealth-api.onrender.com`, with no `/api` suffix.
3. Redeploy the Vercel project. Check `https://<service-url>/api/health` before testing login.

The SQLite file is stored at `/var/data/dashboard.sqlite` on Render's persistent disk. Do not deploy the API without persistent storage: serverless local filesystems can lose or split account data between instances.
