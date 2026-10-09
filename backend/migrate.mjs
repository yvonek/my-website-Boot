import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { database } from './database.mjs';

const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const migrations = readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith('.up.sql'))
  .sort();
let currentVersion = database.prepare('PRAGMA user_version').get().user_version;

for (const migration of migrations) {
  const version = Number(migration.split('_', 1)[0]);
  if (version !== currentVersion + 1) continue;

  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec(readFileSync(join(migrationsDirectory, migration), 'utf8'));
    database.exec(`PRAGMA user_version = ${version}`);
    database.exec('COMMIT');
    currentVersion = version;
    console.log(`Applied migration ${migration}`);
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

database.close();