import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

const envPath = process.argv[2] ?? process.env.NEON_MIGRATION_ENV ?? '.env.migration-rehearsal';
const envText = readFileSync(envPath, 'utf8');
const databaseUrl = envText.match(/^DATABASE_URL_UNPOOLED=(.*)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
if (!databaseUrl) throw new Error(`DATABASE_URL_UNPOOLED is missing from ${envPath}`);

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
try {
  const tables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
  const counts = [];
  for (const { tablename } of tables.rows) {
    const identifier = `"${tablename.replaceAll('"', '""')}"`;
    const result = await pool.query(`SELECT count(*)::integer AS count FROM public.${identifier}`);
    counts.push({ table: tablename, count: result.rows[0].count });
  }

  const summary = await pool.query(`SELECT
    (SELECT count(*)::integer FROM public.users) AS users,
    (SELECT count(*)::integer FROM public.auth_sessions) AS sessions,
    (SELECT count(*)::integer FROM public.wallet_transactions) AS transactions,
    (SELECT coalesce(sum(available_balance), 0)::bigint::text FROM public.wallet_accounts) AS available_balance_total,
    (SELECT coalesce(sum(reserved_balance), 0)::bigint::text FROM public.wallet_accounts) AS reserved_balance_total,
    (SELECT coalesce(sum(amount), 0)::bigint::text FROM public.wallet_transactions WHERE type = 'DEPOSIT' AND status = 'SUCCESS') AS successful_deposits_total,
    (SELECT count(*)::integer FROM public.product_purchases) AS purchases,
    (SELECT coalesce(sum(qualifying_amount), 0)::bigint::text FROM public.product_purchases) AS purchase_amount_total,
    (SELECT count(*)::integer FROM public.product_income_ledger) AS income_entries,
    (SELECT coalesce(sum(amount), 0)::bigint::text FROM public.product_income_ledger) AS income_amount_total,
    (SELECT count(*)::integer FROM public.commission_ledger) AS commissions,
    (SELECT coalesce(sum(commission_amount), 0)::bigint::text FROM public.commission_ledger) AS commission_amount_total`);

  console.log(JSON.stringify({ tables: counts, summary: summary.rows[0] }, null, 2));
} finally {
  await pool.end();
}