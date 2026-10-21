import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const root = resolve(import.meta.dirname, '../..');
const tempDirectory = mkdtempSync(join(tmpdir(), 'rwanda-lucky-wheel-'));
const databasePath = join(tempDirectory, 'wheel.sqlite');
const port = 3138;
const baseUrl = `http://127.0.0.1:${port}`;
const adminToken = 'lucky-wheel-test-admin';
const imageData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZk0AAAAASUVORK5CYII=';
let server;

async function request(path, options = {}, cookie) {
  const headers = { ...(options.headers ?? {}) };
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  return { response, body: await response.json(), cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] };
}

async function register(fullName, phoneNumber, referralCode) {
  const result = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fullName, phoneNumber, password: '123456', referralCode }),
  });
  assert.equal(result.response.status, 201);
  return result;
}

before(async () => {
  const env = { ...process.env, DATABASE_PATH: databasePath, API_PORT: String(port), ADMIN_API_TOKEN: adminToken };
  execFileSync(process.execPath, ['backend/migrate.mjs'], { cwd: root, env, stdio: 'pipe' });
  server = spawn(process.execPath, ['backend/server.mjs'], { cwd: root, env, stdio: 'ignore' });
  let healthy = false;
  for (let attempt = 0; attempt < 50 && !healthy; attempt += 1) {
    try { healthy = (await fetch(`${baseUrl}/api/health`)).ok; }
    catch { await new Promise((resolveWait) => setTimeout(resolveWait, 100)); }
  }
  assert.equal(healthy, true, 'test API should start');
});

after(async () => {
  if (server && server.exitCode === null) { server.kill(); await new Promise((resolveExit) => server.once('exit', resolveExit)); }
  try { rmSync(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { }
});

test('only a completed direct referral earns one server-selected prize spin', async () => {
  const adminHeaders = { 'content-type': 'application/json', 'x-admin-token': adminToken };
  const owner = await register('Wheel Sponsor', '0781234801');
  const inactive = await register('Inactive Invite', '0781234802', owner.body.user.referralCode);
  const active = await register('Active Invite', '0781234803', owner.body.user.referralCode);
  const prize = await request('/api/admin/lucky-wheel/prizes', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ name: 'Phone', description: 'Blue phone', imageData: null, valueRwf: 120000, weight: 1, enabled: true }),
  });
  assert.equal(prize.response.status, 201);

  const beforePurchase = await request('/api/lucky-wheel', {}, owner.cookie);
  assert.equal(beforePurchase.body.remainingSpins, 0);
  assert.equal(beforePurchase.body.referrals[0].completedProducts, 0);

  const denied = await request('/api/lucky-wheel/spin', { method: 'POST', headers: { 'content-type': 'application/json' } }, owner.cookie);
  assert.equal(denied.response.status, 409);

  const database = new DatabaseSync(databasePath);
  try {
    database.prepare('UPDATE wallet_accounts SET available_balance = 1000 WHERE user_id = ?').run(active.body.user.id);
  } finally { database.close(); }
  const product = await request('/api/admin/plans', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ name: 'Qualifying product', description: 'Test purchase for a Lucky Wheel referral.', imageData, price: 100, dailyIncome: 1, durationDays: 10, totalSlots: 10, status: 'Active', position: 1 }),
  });
  assert.equal(product.response.status, 201);
  const purchase = await request('/api/purchases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ productId: 'Qualifying product', idempotencyKey: 'wheel-qualified-purchase' }),
  }, active.cookie);
  assert.equal(purchase.response.status, 201);

  const firstSpin = await request('/api/lucky-wheel/spin', { method: 'POST', headers: { 'content-type': 'application/json' } }, owner.cookie);
  assert.equal(firstSpin.response.status, 200);
  assert.equal(firstSpin.body.spin.prizeId, prize.body.prize.id);
  assert.equal(firstSpin.body.remainingSpins, 0);
  const repeatedSpin = await request('/api/lucky-wheel/spin', { method: 'POST', headers: { 'content-type': 'application/json' } }, owner.cookie);
  assert.equal(repeatedSpin.response.status, 409);

  const history = await request('/api/lucky-wheel', {}, owner.cookie);
  assert.equal(history.body.spins.length, 1);
  assert.equal(history.body.spins[0].referralUserId, active.body.user.id);
  assert.equal(history.body.spins[0].referralName, 'Active Invite');
  assert.equal(inactive.response.status, 201);
});