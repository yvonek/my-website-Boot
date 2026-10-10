import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

const envPath = process.env.NEON_MIGRATION_ENV ?? '.env.neon-production';
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
  console.log(JSON.stringify({ tableCount: counts.length, tables: counts }, null, 2));
} finally {
  await pool.end();
}
