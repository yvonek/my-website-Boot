import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '../..');
const tempDirectory = mkdtempSync(join(tmpdir(), 'rwanda-auth-'));
const databasePath = join(tempDirectory, 'auth.sqlite');
const port = 3109;
const baseUrl = `http://127.0.0.1:${port}`;
let server;
let referrerCookie;
let referrerCode;
let referrerUserId;

async function request(path, options = {}, cookie) {
  const headers = { ...(options.headers ?? {}) };
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const body = await response.json();
  const setCookie = response.headers.get('set-cookie') ?? '';
  return { response, body, setCookie };
}

before(async () => {
  const env = { ...process.env, DATABASE_PATH: databasePath, API_PORT: String(port), ADMIN_API_TOKEN: 'auth-test-admin' };
  execFileSync(process.execPath, ['backend/migrate.mjs'], { cwd: root, env, stdio: 'pipe' });
  server = spawn(process.execPath, ['backend/server.mjs'], { cwd: root, env, stdio: 'ignore' });
  let healthy = false;
  for (let attempt = 0; attempt < 40 && !healthy; attempt += 1) {
    try { healthy = (await fetch(`${baseUrl}/api/health`)).ok; } catch { await new Promise((resolveWait) => setTimeout(resolveWait, 100)); }
  }
  assert.equal(healthy, true, 'test API should start');
});

after(async () => {
  if (server && server.exitCode === null) { server.kill(); await new Promise((resolveExit) => server.once('exit', resolveExit)); }
  try { rmSync(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { }
});

test('validates registration input and optional referral codes', async () => {
  assert.equal((await request('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) })).response.status, 400);
  assert.equal((await request('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fullName: 'Name', phoneNumber: '123', password: '123456' }) })).response.status, 400);
  assert.equal((await request('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fullName: 'Name', phoneNumber: '0781234567', password: 'bad' }) })).response.status, 400);
  assert.equal((await request('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fullName: 'Invalid Referral', phoneNumber: '0781234568', password: '123456', referralCode: 'NOPE' }) })).response.status, 400);
});

test('registers, hashes credentials, creates referral relationship and session', async () => {
  const result = await request('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fullName: 'Referrer User', phoneNumber: '0781234567', password: '123456' }) });
  assert.equal(result.response.status, 201);
  assert.ok(result.body.user.referralCode);
  assert.equal('passwordHash' in result.body.user, false);
  referrerCookie = result.setCookie.split(';')[0];
  referrerCode = result.body.user.referralCode;
  referrerUserId = result.body.user.id;
  const session = await request('/api/auth/me', {}, referrerCookie);
  assert.equal(session.body.user.id, result.body.user.id);
  assert.equal((await request('/api/wallet/balance')).response.status, 401);
  assert.equal((await request('/api/wallet/balance', {}, referrerCookie)).response.status, 200);
  const duplicate = await request('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fullName: 'Duplicate', phoneNumber: '+250781234567', password: '654321' }) });
  assert.equal(duplicate.response.status, 409);
  const referred = await request('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fullName: 'Referred User', phoneNumber: '0781234568', password: '654321', referralCode: referrerCode.toLowerCase() }) });
  assert.equal(referred.response.status, 201);
  const relationship = await import('node:sqlite').then(({ DatabaseSync }) => { const db = new DatabaseSync(databasePath); const row = db.prepare('SELECT sponsor_user_id FROM referral_relationships WHERE user_id = ?').get(referred.body.user.id); db.close(); return row; });
  assert.equal(relationship.sponsor_user_id, result.body.user.id);
});

test('logs in, rejects wrong password, and logout revokes protected session', async () => {
  const wrongPassword = await request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phoneNumber: '0781234567', password: '999999' }) });
  assert.equal(wrongPassword.response.status, 401);
  const login = await request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phoneNumber: '+250781234567', password: '123456' }) });
  assert.equal(login.response.status, 200);
  const cookie = login.setCookie.split(';')[0];
  assert.match(login.setCookie, /HttpOnly/);
  assert.equal((await request('/api/wallet/balance', {}, cookie)).response.status, 200);
  assert.equal((await request('/api/auth/logout', { method: 'POST' }, cookie)).response.status, 200);
  assert.equal((await request('/api/wallet/balance', {}, cookie)).response.status, 401);
});

test('bootstraps Admin role for a phone account and authorizes the phone/password Admin session', async () => {
  const regularMember = await request('/api/admin/overview', {}, referrerCookie);
  assert.equal(regularMember.response.status, 401);

  const bootstrapHeaders = { 'content-type': 'application/json', 'x-admin-token': 'auth-test-admin' };
  const promoted = await request('/api/admin/members/role', { method: 'PUT', headers: bootstrapHeaders, body: JSON.stringify({ phoneNumber: '0781234567', role: 'ADMIN' }) });
  assert.equal(promoted.response.status, 200);
  assert.equal(promoted.body.role, 'ADMIN');

  const login = await request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phoneNumber: '0781234567', password: '123456' }) });
  assert.equal(login.response.status, 200);
  assert.equal(login.body.user.role, 'ADMIN');
  const adminCookie = login.setCookie.split(';')[0];
  const overview = await request('/api/admin/overview', {}, adminCookie);
  assert.equal(overview.response.status, 200);
  const adminPlans = await request('/api/admin/plans', {}, adminCookie);
  assert.equal(adminPlans.response.status, 200);
});

test('requires a bound account before withdrawal and saves it per user', async () => {
  const missingAccount = await request('/api/wallet/withdraw/account', {}, referrerCookie);
  assert.equal(missingAccount.response.status, 200);
  assert.equal(missingAccount.body.account, null);

  const withoutBinding = await request('/api/wallet/withdraw/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount: 1000 }) }, referrerCookie);
  assert.equal(withoutBinding.response.status, 400);
  assert.match(withoutBinding.body.error, /Bind a withdrawal account/i);

  const bound = await request('/api/wallet/withdraw/account', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountHolderName: 'Referrer User', phoneNumber: '0781234567', paymentMethod: 'MTN_MOMO' }) }, referrerCookie);
  assert.equal(bound.response.status, 200);
  assert.equal(bound.body.account.accountHolderName, 'Referrer User');
  assert.equal(bound.body.account.paymentMethod, 'MTN_MOMO');

  const saved = await request('/api/wallet/withdraw/account', {}, referrerCookie);
  assert.equal(saved.body.account.phoneNumber, '0781234567');
});

test('wallet returns only the current users completed purchases', async () => {
  const emptyWallet = await request('/api/wallet/products', {}, referrerCookie);
  assert.equal(emptyWallet.response.status, 200);
  assert.deepEqual(emptyWallet.body.products, []);

  const database = await import('node:sqlite').then(({ DatabaseSync }) => {
    const db = new DatabaseSync(databasePath);
    db.prepare('INSERT INTO product_purchases (id, user_id, product_name, qualifying_amount, status, reference) VALUES (?, ?, ?, ?, ?, ?)').run('purchase-complete', referrerUserId, 'Owned Product', 50000, 'COMPLETED', 'TEST-COMPLETED-1');
    db.prepare('INSERT INTO product_purchases (id, user_id, product_name, qualifying_amount, status, reference) VALUES (?, ?, ?, ?, ?, ?)').run('purchase-pending', referrerUserId, 'Pending Product', 25000, 'PENDING', 'TEST-PENDING-1');
    db.close();
  });
  await database;

  const ownProducts = await request('/api/wallet/products', {}, referrerCookie);
  assert.equal(ownProducts.response.status, 200);
  assert.deepEqual(ownProducts.body.products.map((product) => product.name), ['Owned Product']);

  const otherAccount = await request('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fullName: 'Fresh Account', phoneNumber: '0781234999', password: '123456' }) });
  const otherCookie = otherAccount.setCookie.split(';')[0];
  const otherProducts = await request('/api/wallet/products', {}, otherCookie);
  assert.deepEqual(otherProducts.body.products, []);
});

test('daily check-in is admin controlled, credits balance once per UTC day, and rejects repeat claims', async () => {
  const adminHeaders = { 'content-type': 'application/json', 'x-admin-token': 'auth-test-admin' };
  const beforeSetup = await request('/api/wallet/daily-checkin', {}, referrerCookie);
  assert.equal(beforeSetup.response.status, 200);
  assert.equal(beforeSetup.body.enabled, false);
  assert.equal((await request('/api/wallet/daily-checkin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, referrerCookie)).response.status, 403);

  const unauthorized = await request('/api/admin/daily-checkin', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true, rewardAmount: 750 }) });
  assert.equal(unauthorized.response.status, 401);
  const configured = await request('/api/admin/daily-checkin', { method: 'PUT', headers: adminHeaders, body: JSON.stringify({ enabled: true, rewardAmount: 750 }) });
  assert.equal(configured.response.status, 200);
  assert.deepEqual(configured.body, { enabled: true, rewardAmount: 750 });

  const status = await request('/api/wallet/daily-checkin', {}, referrerCookie);
  assert.equal(status.body.enabled, true);
  assert.equal(status.body.claimed, false);
  const claim = await request('/api/wallet/daily-checkin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, referrerCookie);
  assert.equal(claim.response.status, 201);
  assert.equal(claim.body.rewardAmount, 750);
  const repeated = await request('/api/wallet/daily-checkin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, referrerCookie);
  assert.equal(repeated.response.status, 409);
  const balance = await request('/api/wallet/balance', {}, referrerCookie);
  assert.equal(balance.body.availableBalance, 750);
});
