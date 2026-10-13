# Integration Plan

## Backend
- Local Node.js HTTP API: `node backend/server.mjs` (`npm run api`), default port `3001`.
- Database: SQLite via Node.js built-in `node:sqlite`; default file `data/dashboard.sqlite`.
- Health endpoint: `GET /api/health`.
- Dashboard endpoint: `GET /api/dashboard`.

## Frontend
- Folder: project root
- Build: `npm run build`
- Dev: `npm run dev`
- API seam: `src/api/index.ts` exports `liveClient` from `src/api/client.ts`.
- Removed mock files: `src/api/mockClient.ts` and `src/data/demoData.ts`.

## API routes
- GET `/api/health` - database-backed health check
- GET `/api/dashboard` - metrics, plans, referrals, and support tools
- Vite proxies `/api` to `http://127.0.0.1:3001`.

## Database
- SQLite schema migration: `backend/migrations/001_dashboard.up.sql` and matching down migration.
- Apply with `npm run migrate`; roll back with `npm run migrate:rollback`.
- No seed data is created.

## Shared types
- `src/api/types.ts`; no separate package or import alias.

## Services
- Local Node.js API and SQLite database; no Azure service is required for local integration.

## Integration results
- Migration applied successfully; schema contains dashboard metrics, plans, referrals, and support tools tables, with no rows inserted.
- `GET /api/health` and `GET /api/dashboard` returned HTTP 200.
- Browser request through Vite proxy to `/api/dashboard` returned HTTP 200 with empty collections.
- Frontend API seam now uses the live API; fixture client and local demo data files were removed.
- Full frontend page/build/test verification is blocked because the current `node_modules` is incomplete (missing `@fluentui/react-icons`, `jsdom`, and package entry files). npm install stalled while accessing dependencies.
- Integration status: blocked pending successful dependency installation and frontend verification.
