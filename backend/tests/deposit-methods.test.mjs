import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const root = resolve(import.meta.dirname, '../..');
const tempDirectory = mkdtempSync(join(tmpdir(), 'rwanda-deposit-methods-'));
const databasePath = join(tempDirectory, 'deposit-methods.sqlite');
const port = 3110;
const baseUrl = `http://127.0.0.1:${port}`;
let server;
let adminToken = 'deposit-methods-test-admin';
let userCookie;
let userId;

async function request(path, options = {}, cookie) {
  const headers = { ...(options.headers ?? {}) };
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const body = await response.json();
  return { response, body, setCookie: response.headers.get('set-cookie') ?? '' };
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
  const registered = await request('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fullName: 'Deposit Test User', phoneNumber: '0789000011', password: '123456' }) });
  assert.equal(registered.response.status, 201);
  userCookie = registered.setCookie.split(';')[0];
  userId = registered.body.user.id;
});

after(async () => {
  if (server && server.exitCode === null) { server.kill(); await new Promise((resolveExit) => server.once('exit', resolveExit)); }
  try { rmSync(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { }
});

test('migration creates independent configurable deposit settings and transaction snapshots', () => {
  const database = new DatabaseSync(databasePath);
  const methodColumns = database.prepare('PRAGMA table_info(deposit_methods)').all().map((column) => column.name);
  const transactionColumns = database.prepare('PRAGMA table_info(wallet_transactions)').all().map((column) => column.name);
  assert.ok(methodColumns.includes('account_name'));
  assert.ok(methodColumns.includes('account_number'));
  assert.ok(methodColumns.includes('minimum_amount'));
  assert.ok(methodColumns.includes('maximum_amount'));
  assert.ok(methodColumns.includes('logo_data'));
  assert.ok(methodColumns.includes('ussd_template'));
  assert.ok(transactionColumns.includes('deposit_method_id'));
  assert.ok(transactionColumns.includes('deposit_method_name'));
  assert.ok(transactionColumns.includes('screenshot_data'));
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
  database.close();
});

test('admin manages up to four separate deposit methods and only active methods are public', async () => {
  const forbidden = await request('/api/admin/deposit-methods');
  assert.equal(forbidden.response.status, 401);
  const headers = { 'content-type': 'application/json', 'x-admin-token': adminToken };
  const initial = await request('/api/admin/deposit-methods', { headers });
  assert.equal(initial.response.status, 200);
  assert.equal(initial.body.methods.length, 2);
  const legacyAdminMethods = await request('/api/admin/payment-methods', { headers });
  assert.equal(legacyAdminMethods.response.status, 200);
  assert.equal('deposits' in legacyAdminMethods.body, false);
  assert.ok(Array.isArray(legacyAdminMethods.body.withdrawals));
  const mixedDepositUpdate = await request('/api/admin/payment-methods', { method: 'POST', headers, body: JSON.stringify({ type: 'deposit', code: 'MTN_MOMO', enabled: true }) });
  assert.equal(mixedDepositUpdate.response.status, 400);
  assert.deepEqual((await request('/api/deposit-methods', {}, userCookie)).body.methods, []);

  const create = async (name) => request('/api/admin/deposit-methods', { method: 'POST', headers, body: JSON.stringify({ name, accountName: `${name} Merchant`, accountNumber: '0792062322', instructions: 'Use the deposit reference.', ussdTemplate: name === 'MTN Mobile Money' ? '*182*1*1*{number}*{amount}#' : '', minimumAmount: 1000, maximumAmount: 100000, enabled: true }) });
  const first = await create('MTN Mobile Money');
  assert.equal(first.response.status, 201);
  const methodId = first.body.method.id;
  assert.equal(first.body.method.ussdTemplate, '*182*1*1*{number}*{amount}#');
  const literalNumberTemplate = await request(`/api/admin/deposit-methods/${methodId}`, { method: 'PUT', headers, body: JSON.stringify({ ...first.body.method, ussdTemplate: '*182*1*1*0792062322#' }) });
  assert.equal(literalNumberTemplate.response.status, 200);
  assert.equal(literalNumberTemplate.body.method.ussdTemplate, '*182*1*1*{number}#');
  const literalNumberAndAmountTemplate = await request(`/api/admin/deposit-methods/${methodId}`, { method: 'PUT', headers, body: JSON.stringify({ ...first.body.method, ussdTemplate: '*182*1*1*0792062322*1000#' }) });
  assert.equal(literalNumberAndAmountTemplate.response.status, 200);
  assert.equal(literalNumberAndAmountTemplate.body.method.ussdTemplate, '*182*1*1*{number}*{amount}#');
  const visible = await request('/api/deposit-methods', {}, userCookie);
  assert.equal(visible.response.status, 200);
  assert.equal(visible.body.methods.length, 1);
  assert.equal(visible.body.methods[0].id, methodId);

  const disabled = await request(`/api/admin/deposit-methods/${methodId}`, { method: 'PUT', headers, body: JSON.stringify({ ...first.body.method, enabled: false }) });
  assert.equal(disabled.response.status, 200);
  assert.equal((await request('/api/deposit-methods', {}, userCookie)).body.methods.length, 0);
  const reenabled = await request(`/api/admin/deposit-methods/${methodId}`, { method: 'PUT', headers, body: JSON.stringify({ ...first.body.method, enabled: true }) });
  assert.equal(reenabled.response.status, 200);

  assert.equal((await create('Airtel Money')).response.status, 201);
  assert.equal((await create('Bank Account')).response.status, 409);
  assert.equal((await request('/api/wallet/withdraw/methods', {}, userCookie)).body.methods.length, 2);
});

test('deposit validates selected method, limits and proof, snapshots payment details, and remains reviewable', async () => {
  const headers = { 'content-type': 'application/json', 'x-admin-token': adminToken };
  const methods = await request('/api/admin/deposit-methods', { headers });
  const method = methods.body.methods.find((item) => item.name === 'MTN Mobile Money');
  const screenshotData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZk0AAAAASUVORK5CYII=';
  const deposit = { amount: 5000, phoneNumber: '0789000011', senderName: 'Deposit Payer', depositMethodId: method.id, screenshotData };

  assert.equal((await request('/api/deposits', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...deposit, depositMethodId: '' }) }, userCookie)).response.status, 400);
  assert.equal((await request('/api/deposits', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...deposit, amount: 999 }) }, userCookie)).response.status, 400);
  assert.equal((await request('/api/deposits', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...deposit, screenshotData: '' }) }, userCookie)).response.status, 400);

  const submitted = await request('/api/deposits', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(deposit) }, userCookie);
  assert.equal(submitted.response.status, 201);
  assert.equal(submitted.body.transaction.userId, userId);
  assert.equal(submitted.body.transaction.status, 'PENDING');
  assert.equal(submitted.body.transaction.depositMethodId, method.id);
  assert.equal(submitted.body.transaction.depositMethodName, 'MTN Mobile Money');
  assert.equal(submitted.body.transaction.senderName, 'Deposit Payer');
  assert.equal('screenshotData' in submitted.body.transaction, false);
  const deletedMethod = await request(`/api/admin/deposit-methods/${method.id}`, { method: 'DELETE', headers: { 'x-admin-token': adminToken } });
  assert.equal(deletedMethod.response.status, 200);

  const adminTransactions = await request('/api/admin/transactions', { headers: { 'x-admin-token': adminToken } });
  const reviewed = adminTransactions.body.transactions.find((transaction) => transaction.id === submitted.body.transaction.id);
  assert.equal(reviewed.userName, 'Deposit Test User');
  assert.equal(reviewed.paymentMethod, 'MTN Mobile Money');
  assert.equal(reviewed.phoneNumber, '0789000011');
  assert.equal('screenshotData' in reviewed, false);
  const proof = await request(`/api/admin/transactions/${reviewed.id}/proof`, { headers: { 'x-admin-token': adminToken } });
  assert.equal(proof.response.status, 200);
  assert.equal(proof.body.screenshotData, screenshotData);

  const approval = await request(`/api/admin/transactions/${reviewed.id}/approve`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': adminToken }, body: JSON.stringify({}) });
  assert.equal(approval.response.status, 200);
  assert.equal(approval.body.transaction.status, 'SUCCESS');
  const balance = await request('/api/wallet/balance', {}, userCookie);
  assert.equal(balance.body.availableBalance, 5000);
});