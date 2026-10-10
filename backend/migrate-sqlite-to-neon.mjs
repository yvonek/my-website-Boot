import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync, backup } from 'node:sqlite';
import { Pool } from 'pg';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(process.env.DATABASE_PATH ?? 'data/dashboard.sqlite');
const envPath = resolve(process.argv[2] ?? process.env.NEON_MIGRATION_ENV ?? '.env.migration-rehearsal');
const backupPath = resolve(process.argv[3] ?? process.env.SQLITE_BACKUP_PATH ?? 'data/dashboard.pre-neon-migration.sqlite');
const envText = readFileSync(envPath, 'utf8');
const databaseUrl = envText.match(/^DATABASE_URL_UNPOOLED=(.*)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '');

if (!databaseUrl) throw new Error(`DATABASE_URL_UNPOOLED is missing from ${envPath}`);
if (!existsSync(sourcePath)) throw new Error(`SQLite source not found: ${sourcePath}`);
if (new URL(databaseUrl).hostname.includes('-pooler')) throw new Error('Use a direct, unpooled Neon URL for migration.');
if (existsSync(backupPath)) throw new Error(`Refusing to overwrite existing backup: ${backupPath}`);

const source = new DatabaseSync(sourcePath, { readOnly: true });
const pg = new Pool({ connectionString: databaseUrl, max: 1, application_name: 'sqlite-neon-migration' });
let transactionOpen = false;
let sourceOpen = true;

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function orderedTables(tables, foreignKeys) {
  const names = new Set(tables.map((table) => table.name));
  const remaining = new Map(tables.map((table) => [table.name, new Set()]));
  for (const { table, referencedTable } of foreignKeys) {
    if (table !== referencedTable && names.has(referencedTable)) remaining.get(table).add(referencedTable);
  }
  const ordered = [];
  while (remaining.size) {
    const ready = [...remaining].filter(([, dependencies]) => dependencies.size === 0).map(([name]) => name);
    if (!ready.length) throw new Error(`Foreign-key cycle prevents safe table ordering: ${[...remaining.keys()].join(', ')}`);
    for (const name of ready) {
      ordered.push(name);
      remaining.delete(name);
      for (const dependencies of remaining.values()) dependencies.delete(name);
    }
  }
  return ordered;
}

try {
  await backup(source, backupPath);
  source.close();
  sourceOpen = false;
  const snapshot = new DatabaseSync(backupPath, { readOnly: true });

  try {
    const tables = snapshot.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    const indexes = snapshot.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name").all();
    const triggers = snapshot.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all();
    const foreignKeys = tables.flatMap(({ name }) => snapshot.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(name)})`).all().map((key) => ({ table: name, referencedTable: key.table })));
    const tableOrder = orderedTables(tables, foreignKeys);
    const counts = new Map();

    for (const { name } of tables) {
      const row = snapshot.prepare(`SELECT count(*) AS count FROM ${quoteIdentifier(name)}`).get();
      counts.set(name, row.count);
    }

    const client = await pg.connect();
    try {
      const existing = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
      if (existing.rows.length) throw new Error(`Refusing to import over non-empty Neon public schema (${existing.rows.length} tables). Use a fresh migration branch.`);

      await client.query('BEGIN');
      transactionOpen = true;
      for (const name of tableOrder) {
        const table = tables.find((item) => item.name === name);
        const ddl = table.sql.replace(/\bDEFAULT\s+CURRENT_TIMESTAMP\b/gi, 'DEFAULT (CURRENT_TIMESTAMP::text)');
        await client.query(ddl);
      }

      for (const name of tableOrder) {
        const columns = snapshot.prepare(`PRAGMA table_info(${quoteIdentifier(name)})`).all().map((column) => column.name);
        const rows = snapshot.prepare(`SELECT * FROM ${quoteIdentifier(name)}`).all();
        if (!columns.length || !rows.length) continue;
        const quotedColumns = columns.map(quoteIdentifier).join(', ');
        const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
        const insert = `INSERT INTO ${quoteIdentifier(name)} (${quotedColumns}) VALUES (${placeholders})`;
        for (const row of rows) await client.query(insert, columns.map((column) => row[column]));
      }

      for (const index of indexes) await client.query(index.sql);
      for (const table of tableOrder) {
        const result = await client.query(`SELECT count(*)::integer AS count FROM ${quoteIdentifier(table)}`);
        if (result.rows[0].count !== counts.get(table)) throw new Error(`Row-count mismatch for ${table}`);
      }
      await client.query('CREATE TABLE app_schema_migrations (version integer PRIMARY KEY, source text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
      await client.query("INSERT INTO app_schema_migrations (version, source) VALUES (23, 'sqlite-import')");
      await client.query('COMMIT');
      transactionOpen = false;

      console.log(`Imported ${tables.length} tables; per-table row counts verified.`);
      console.log(`SQLite backup preserved at ${backupPath}`);
      console.log(`SQLite triggers require application-level PostgreSQL replacements: ${triggers.map(({ name }) => name).join(', ') || 'none'}`);
    } catch (error) {
      if (transactionOpen) await client.query('ROLLBACK');
      transactionOpen = false;
      throw error;
    } finally {
      client.release();
    }
  } finally {
    snapshot.close();
  }
} finally {
  if (sourceOpen) source.close();
  await pg.end();
}