import { DatabaseSync } from 'node:sqlite';

const databasePath = process.env.DATABASE_PATH ?? 'data/dashboard.sqlite';
const database = new DatabaseSync(databasePath, { readOnly: true });

try {
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  for (const { name } of tables) {
    const quotedName = `"${name.replaceAll('"', '""')}"`;
    const { count } = database.prepare(`SELECT count(*) AS count FROM ${quotedName}`).get();
    console.log(`${name}: ${count}`);
  }
  const financialSummary = {
    users: database.prepare('SELECT count(*) AS count FROM users').get().count,
    transactions: database.prepare('SELECT type, status, count(*) AS count, coalesce(sum(amount), 0) AS amount FROM wallet_transactions GROUP BY type, status ORDER BY type, status').all(),
    availableBalanceTotal: database.prepare('SELECT coalesce(sum(available_balance), 0) AS total FROM wallet_accounts').get().total,
    reservedBalanceTotal: database.prepare('SELECT coalesce(sum(reserved_balance), 0) AS total FROM wallet_accounts').get().total,
    purchases: database.prepare('SELECT count(*) AS count, coalesce(sum(qualifying_amount), 0) AS amount FROM product_purchases').get(),
    income: database.prepare('SELECT count(*) AS count, coalesce(sum(amount), 0) AS amount FROM product_income_ledger').get(),
    commissions: database.prepare('SELECT count(*) AS count, coalesce(sum(commission_amount), 0) AS amount FROM commission_ledger').get(),
    sessions: database.prepare('SELECT count(*) AS count FROM auth_sessions').get().count,
  };
  console.log(`Financial summary: ${JSON.stringify(financialSummary)}`);
  console.log(`SQLite integrity: ${database.prepare('PRAGMA integrity_check').get().integrity_check}`);
  console.log(`Foreign-key violations: ${database.prepare('PRAGMA foreign_key_check').all().length}`);
} finally {
  database.close();
}