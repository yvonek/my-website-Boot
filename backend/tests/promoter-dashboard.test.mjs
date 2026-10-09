import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const root = resolve(import.meta.dirname, '../..');
const tempDirectory = mkdtempSync(join(tmpdir(), 'rwanda-promoters-'));
const databasePath = join(tempDirectory, 'promoters.sqlite');
const port = 3128;
const baseUrl = `http://127.0.0.1:${port}`;
const adminToken = 'promoter-dashboard-test-admin';
let server;
let adminCookie;
let promoter;
let direct;
let inactiveDirect;
let secondLevel;

async function request(path, options = {}, cookie) {
  const headers = { ...(options.headers ?? {}) };
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const body = await response.json();
  return { response, body, cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] };
}

async function register(fullName, phoneNumber, referralCode) {
  const result = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fullName, phoneNumber, password: '123456', ...(referralCode ? { referralCode } : {}) }),
  });
  assert.equal(result.response.status, 201);
  return { ...result.body.user, cookie: result.cookie };
}

function seedFinancialRows(user, prefix) {
  const database = new DatabaseSync(databasePath);
  const insert = database.prepare('INSERT INTO wallet_transactions (id, user_id, type, amount, phone_number, payment_method, status, provider, internal_reference) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  try {
    insert.run(`${prefix}-dep-ok`, user.id, 'DEPOSIT', 50000, user.phoneNumber, 'MTN_MOMO', 'SUCCESS', 'ADMIN_REVIEW', `${prefix}-dep-ok-ref`);
    insert.run(`${prefix}-dep-pending`, user.id, 'DEPOSIT', 70000, user.phoneNumber, 'MTN_MOMO', 'PENDING', 'ADMIN_REVIEW', `${prefix}-dep-pending-ref`);
    insert.run(`${prefix}-dep-rejected`, user.id, 'DEPOSIT', 80000, user.phoneNumber, 'MTN_MOMO', 'REJECTED', 'ADMIN_REVIEW', `${prefix}-dep-rejected-ref`);
    insert.run(`${prefix}-wdr-ok`, user.id, 'WITHDRAWAL', 20000, user.phoneNumber, 'MTN_MOMO', 'AWAITING_PAYOUT', 'ADMIN_REVIEW', `${prefix}-wdr-ok-ref`);
    insert.run(`${prefix}-wdr-pending`, user.id, 'WITHDRAWAL', 30000, user.phoneNumber, 'MTN_MOMO', 'PENDING', 'ADMIN_REVIEW', `${prefix}-wdr-pending-ref`);
    insert.run(`${prefix}-wdr-rejected`, user.id, 'WITHDRAWAL', 40000, user.phoneNumber, 'MTN_MOMO', 'REJECTED', 'ADMIN_REVIEW', `${prefix}-wdr-rejected-ref`);
    database.prepare('UPDATE wallet_accounts SET available_balance = 12345 WHERE user_id = ?').run(user.id);
  } finally { database.close(); }
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

  promoter = await register('Promoter User', '0781234201');
  direct = await register('Active Direct', '0781234202', promoter.referralCode);
  inactiveDirect = await register('Inactive Direct', '0781234203', promoter.referralCode);
  secondLevel = await register('Second Level', '0781234204', direct.referralCode);
  const admin = await register('Dashboard Admin', '0781234205');
  const promoted = await request('/api/admin/members/role', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-admin-token': adminToken }, body: JSON.stringify({ phoneNumber: admin.phoneNumber, role: 'ADMIN' }) });
  assert.equal(promoted.response.status, 200);
  const loggedIn = await request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phoneNumber: admin.phoneNumber, password: '123456' }) });
  assert.equal(loggedIn.response.status, 200);
  adminCookie = loggedIn.cookie;

  const database = new DatabaseSync(databasePath);
  try {
    database.prepare('INSERT INTO product_purchases (id, user_id, product_name, qualifying_amount, status, reference) VALUES (?, ?, ?, ?, ?, ?)').run('promoter-purchase-1', direct.id, 'Existing product', 50000, 'COMPLETED', 'PROMOTER-PURCHASE-1');
  } finally { database.close(); }
  seedFinancialRows(direct, 'direct');
  seedFinancialRows(secondLevel, 'second');
});

after(async () => {
  if (server && server.exitCode === null) { server.kill(); await new Promise((resolveExit) => server.once('exit', resolveExit)); }
  try { rmSync(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { }
});

test('Admin promoter reports real direct and multi-level referrals, purchase activity, and approved financial totals', async () => {
  assert.equal((await request('/api/admin/promoters')).response.status, 401);
  assert.equal((await request('/api/admin/live-users')).response.status, 401);
  assert.equal((await request('/api/admin/summary')).response.status, 401);

  const promoterList = await request('/api/admin/promoters?limit=10&offset=0', {}, adminCookie);
  assert.equal(promoterList.response.status, 200);
  assert.equal(promoterList.body.total, 2);
  const listedPromoter = promoterList.body.promoters.find((item) => item.userId === promoter.id);
  assert.equal(listedPromoter.totalReferred, 2);
  assert.equal(listedPromoter.activeMembers, 1);

  const activeUsers = await request('/api/admin/users?active=1', {}, adminCookie);
  assert.equal(activeUsers.response.status, 200);
  assert.deepEqual(activeUsers.body.users.map((member) => member.id), [direct.id]);

  const detail = await request(`/api/admin/promoters/${promoter.id}?limit=10&offset=0`, {}, adminCookie);
  assert.equal(detail.response.status, 200);
  assert.deepEqual(detail.body.totals, { totalReferred: 2, activeMembers: 1, inactiveMembers: 1 });
  assert.deepEqual(detail.body.levels.map((item) => [item.level, item.total, item.active]), [[1, 2, 1], [2, 1, 0]]);
  const directMember = detail.body.members.find((member) => member.userId === direct.id);
  const inactiveMember = detail.body.members.find((member) => member.userId === inactiveDirect.id);
  assert.equal(directMember.activityStatus, 'ACTIVE');
  assert.equal(directMember.productsPurchased, 1);
  assert.equal(directMember.totalDeposit, 50000);
  assert.equal(directMember.totalWithdrawal, 20000);
  assert.equal(directMember.currentBalance, 12345);
  assert.equal(inactiveMember.activityStatus, 'INACTIVE');
  assert.equal(inactiveMember.productsPurchased, 0);
  assert.equal(detail.body.members.length, 3);
  assert.equal(detail.body.teamTotals.totalDeposit, 100000);
  assert.equal(detail.body.teamTotals.totalWithdrawal, 40000);
  assert.equal(detail.body.teamTotals.totalProductsPurchased, 1);

  const levelTwo = await request(`/api/admin/promoters/${promoter.id}?level=2`, {}, adminCookie);
  assert.equal(levelTwo.body.members.length, 1);
  assert.equal(levelTwo.body.members[0].userId, secondLevel.id);
  const summary = await request('/api/admin/summary', {}, adminCookie);
  assert.equal(summary.response.status, 200);
  assert.equal(summary.body.totalUsers, 5);
  assert.equal(summary.body.activeUsers, 1);
  assert.equal(summary.body.totalDeposit, 100000);
  assert.equal(summary.body.totalWithdrawal, 40000);
  assert.equal(summary.body.totalProductsSold, 1);
});

test('heartbeat reports only authenticated live sessions and current page, then expires them', async () => {
  const heartbeat = await request('/api/presence', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: '/plans' }) }, direct.cookie);
  assert.equal(heartbeat.response.status, 200);
  const live = await request('/api/admin/live-users?page=Products', {}, adminCookie);
  assert.equal(live.response.status, 200);
  assert.equal(live.body.total, 1);
  assert.equal(live.body.users[0].userId, direct.id);
  assert.equal(live.body.users[0].currentPage, 'Products');
  assert.equal(live.body.users[0].active, true);
  assert.equal(live.body.users[0].promoterName, promoter.fullName);

  const depositHeartbeat = await request('/api/presence', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: '/deposit' }) }, direct.cookie);
  assert.equal(depositHeartbeat.response.status, 200);
  const depositPage = await request('/api/admin/live-users?page=Deposit', {}, adminCookie);
  assert.equal(depositPage.body.total, 1);
  assert.equal(depositPage.body.users[0].currentPage, 'Deposit');

  const guestHeartbeat = await request('/api/presence', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: '/' }) });
  assert.equal(guestHeartbeat.response.status, 401);
  const database = new DatabaseSync(databasePath);
  try { database.prepare("UPDATE auth_sessions SET last_seen_at = ? WHERE user_id = ?").run(new Date(Date.now() - 120_000).toISOString(), direct.id); }
  finally { database.close(); }
  const expired = await request('/api/admin/live-users', {}, adminCookie);
  assert.equal(expired.body.users.some((user) => user.userId === direct.id), false);
});
