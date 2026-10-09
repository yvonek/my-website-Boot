import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { database } from './database.mjs';

const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const currentVersion = database.prepare('PRAGMA user_version').get().user_version;
const migration = readdirSync(migrationsDirectory).find((name) =>
  name.startsWith(`${String(currentVersion).padStart(3, '0')}_`) && name.endsWith('.down.sql'),
);

if (migration) {
  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec(readFileSync(join(migrationsDirectory, migration), 'utf8'));
    database.exec(`PRAGMA user_version = ${currentVersion - 1}`);
    database.exec('COMMIT');
    console.log(`Rolled back migration ${migration}`);
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
} else if (currentVersion !== 0) {
  throw new Error(`No down migration found for schema version ${currentVersion}`);
}

database.close();