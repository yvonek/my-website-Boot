import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '../..');
const tempDirectory = mkdtempSync(join(tmpdir(), 'rwanda-gift-codes-'));
const databasePath = join(tempDirectory, 'gift-codes.sqlite');
const port = 3129;
const baseUrl = `http://127.0.0.1:${port}`;
const adminToken = 'gift-codes-test-bootstrap';
let server;
let adminCookie;
let userCookie;
let otherUserCookie;
let thirdUserCookie;

async function request(path, options = {}, cookie) {
  const headers = { ...(options.headers ?? {}) };
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const body = await response.json();
  return { response, body, cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] };
}

async function register(fullName, phoneNumber) {
  const result = await request('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fullName, phoneNumber, password: '123456' }) });
  assert.equal(result.response.status, 201);
  return result.cookie;
}

before(async () => {
  const env = { ...process.env, DATABASE_PATH: databasePath, API_PORT: String(port), ADMIN_API_TOKEN: adminToken };
  execFileSync(process.execPath, ['backend/migrate.mjs'], { cwd: root, env, stdio: 'pipe' });
  server = spawn(process.execPath, ['backend/server.mjs'], { cwd: root, env, stdio: 'ignore' });
  let healthy = false;
  for (let attempt = 0; attempt < 40 && !healthy; attempt += 1) {
    try { healthy = (await fetch(`${baseUrl}/api/health`)).ok; } catch { await new Promise((resolveWait) => setTimeout(resolveWait, 100)); }
  }
  assert.equal(healthy, true, 'test API should start');
  await register('Gift Code Admin', '0781234201');
  await request('/api/admin/members/role', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-admin-token': adminToken }, body: JSON.stringify({ phoneNumber: '0781234201', role: 'ADMIN' }) });
  adminCookie = (await request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phoneNumber: '0781234201', password: '123456' }) })).cookie;
  userCookie = await register('Gift Code Member', '0781234202');
  otherUserCookie = await register('Gift Code Member Two', '0781234203');
  thirdUserCookie = await register('Gift Code Member Three', '0781234204');
});

after(async () => {
  if (server && server.exitCode === null) { server.kill(); await new Promise((resolveExit) => server.once('exit', resolveExit)); }
  try { rmSync(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { }
});

test('admin issues ordered gift-code tiers and each redemption receives the correct reward once', async () => {
  assert.equal((await request('/api/admin/gift-codes', {}, userCookie)).response.status, 401);
  const tiers = [{ users: 1, rewardAmount: 5000 }, { users: 1, rewardAmount: 1500 }];
  const issued = await request('/api/admin/gift-codes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'WELCOME-5000', amount: 5000, maxUses: 2, tiers }) }, adminCookie);
  assert.equal(issued.response.status, 201);
  assert.equal(issued.body.code.code, 'WELCOME-5000');
  assert.deepEqual(issued.body.code.tiers, tiers);

  const redeemed = await request('/api/wallet/gift-codes/redeem', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'welcome-5000' }) }, userCookie);
  assert.equal(redeemed.response.status, 200);
  assert.equal(redeemed.body.amount, 5000);
  assert.equal(redeemed.body.balance.availableBalance, 5000);

  const repeated = await request('/api/wallet/gift-codes/redeem', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'WELCOME-5000' }) }, userCookie);
  assert.equal(repeated.response.status, 409);
  const secondReward = await request('/api/wallet/gift-codes/redeem', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'WELCOME-5000' }) }, otherUserCookie);
  assert.equal(secondReward.response.status, 200);
  assert.equal(secondReward.body.amount, 1500);
  assert.equal(secondReward.body.balance.availableBalance, 1500);
  const exhausted = await request('/api/wallet/gift-codes/redeem', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'WELCOME-5000' }) }, thirdUserCookie);
  assert.equal(exhausted.response.status, 409);
  assert.equal(exhausted.body.error, 'This gift code has reached its redemption limit.');
});