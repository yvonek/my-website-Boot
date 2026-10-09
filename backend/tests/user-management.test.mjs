import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const root = resolve(import.meta.dirname, '../..');
const tempDirectory = mkdtempSync(join(tmpdir(), 'rwanda-users-'));
const databasePath = join(tempDirectory, 'users.sqlite');
const port = 3111;
const baseUrl = `http://127.0.0.1:${port}`;
const adminToken = 'user-management-test-bootstrap';
let server;
let adminCookie;
let targetCookie;
let otherCookie;
let targetId;
let otherId;
let adminId;

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
  return { user: result.body.user, cookie: result.cookie };
}

function database(callback) {
  const db = new DatabaseSync(databasePath);
  try { return callback(db); } finally { db.close(); }
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
  const admin = await register('Access Admin', '0781234101');
  adminId = admin.user.id;
  const bootstrap = await request('/api/admin/members/role', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-admin-token': adminToken }, body: JSON.stringify({ phoneNumber: '0781234101', role: 'ADMIN' }) });
  assert.equal(bootstrap.response.status, 200);
  const login = await request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phoneNumber: '0781234101', password: '123456' }) });
  adminCookie = login.cookie;
  const target = await register('Managed Member', '0781234102');
  const other = await register('Other Member', '0781234103');
  targetId = target.user.id;
  otherId = other.user.id;
  targetCookie = target.cookie;
  otherCookie = other.cookie;
});

after(async () => {
  if (server && server.exitCode === null) { server.kill(); await new Promise((resolveExit) => server.once('exit', resolveExit)); }
  try { rmSync(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { }
});

test('requires an Admin session and enforces account and feature access controls', async () => {
  assert.equal((await request('/api/admin/users', {}, targetCookie)).response.status, 401);
  assert.equal((await request('/api/admin/users', { headers: { 'x-admin-token': adminToken } })).response.status, 401);
  const listing = await request('/api/admin/users?search=Managed&status=ACTIVE&limit=10&offset=0', {}, adminCookie);
  assert.equal(listing.response.status, 200);
  assert.equal(listing.body.total, 1);
  assert.equal(listing.body.users[0].id, targetId);
  assert.equal(listing.body.users[0].availableBalance, 0);
  assert.equal(listing.body.users[0].totalDeposit, 0);
  assert.equal(listing.body.users[0].totalWithdrawal, 0);
  assert.equal(listing.body.users[0].productsPurchased, 0);
  assert.equal(typeof listing.body.users[0].isLive, 'number');

  const details = await request(`/api/admin/users/${targetId}`, {}, adminCookie);
  assert.equal(details.response.status, 200);
  assert.equal(details.body.user.accountStatus, 'ACTIVE');
  assert.equal((await request(`/api/admin/users/${adminId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ permissions: { dashboard: false } }) }, adminCookie)).response.status, 403);
  const invalidUpdate = await request(`/api/admin/users/${targetId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fullName: 'Should Not Save', accountStatus: 'INVALID' }) }, adminCookie);
  assert.equal(invalidUpdate.response.status, 400);
  assert.equal((await request(`/api/admin/users/${targetId}`, {}, adminCookie)).body.user.fullName, 'Managed Member');
  const promoted = await request(`/api/admin/users/${targetId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'ADMIN' }) }, adminCookie);
  assert.equal(promoted.response.status, 200);
  assert.equal(promoted.body.user.role, 'ADMIN');
  assert.equal((await request(`/api/admin/users/${adminId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'USER' }) }, adminCookie)).response.status, 403);
  const demoted = await request(`/api/admin/users/${targetId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'USER' }) }, adminCookie);
  assert.equal(demoted.response.status, 200);
  assert.equal(demoted.body.user.role, 'USER');
  assert.equal((await request('/api/user/account-state', {}, targetCookie)).response.status, 401);
  const targetLogin = await request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phoneNumber: '0781234102', password: '123456' }) });
  assert.equal(targetLogin.response.status, 200);
  targetCookie = targetLogin.cookie;

  const changed = await request(`/api/admin/users/${targetId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ allowDeposits: false, allowWithdrawals: false, permissions: { products: false, dashboard: false, telegram: false } }) }, adminCookie);
  assert.equal(changed.response.status, 200);
  assert.equal((await request('/api/deposit-methods', {}, targetCookie)).response.status, 403);
  assert.equal((await request('/api/wallet/withdraw/account', {}, targetCookie)).response.status, 403);
  assert.equal((await request('/api/wallet/products', {}, targetCookie)).response.status, 403);
  const dashboard = await request('/api/dashboard', {}, targetCookie);
  assert.equal(dashboard.response.status, 200);
  assert.deepEqual(dashboard.body.metrics, []);
  assert.deepEqual(dashboard.body.plans, []);
  assert.equal((await request('/api/wallet/balance', {}, targetCookie)).response.status, 200);

  const frozen = await request(`/api/admin/users/${targetId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountStatus: 'FROZEN' }) }, adminCookie);
  assert.equal(frozen.response.status, 200);
  assert.equal((await request('/api/user/account-state', {}, targetCookie)).response.status, 200);
  assert.equal((await request('/api/wallet/balance', {}, targetCookie)).response.status, 403);
  assert.equal((await request('/api/admin/users?status=FROZEN', {}, adminCookie)).body.total, 1);

  await request(`/api/admin/users/${targetId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountStatus: 'ACTIVE', allowDeposits: true, allowWithdrawals: true, permissions: { products: true, dashboard: true, telegram: true } }) }, adminCookie);
  const audit = await request('/api/admin/audit-log', {}, adminCookie);
  assert.ok(audit.body.entries.some((entry) => entry.targetUserId === targetId && entry.action === 'USER_STATUS_FROZEN'));
});

test('Admin balance adjustments require a reason, cannot overdraw, and are audited', async () => {
  const adjust = (amount, reason = 'Test balance correction', cookie = adminCookie) => request(`/api/admin/users/${targetId}/balance`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount, reason }),
  }, cookie);

  assert.equal((await adjust(10000, 'Initial test credit', targetCookie)).response.status, 401);
  const credit = await adjust(10000, 'Initial test credit');
  assert.equal(credit.response.status, 200);
  assert.equal(credit.body.balance.availableBalance, 10000);
  const debit = await adjust(-2500, 'Correct test credit');
  assert.equal(debit.response.status, 200);
  assert.equal(debit.body.balance.availableBalance, 7500);
  assert.equal((await adjust(-8000)).response.status, 400);
  assert.equal((await adjust(1, '')).response.status, 400);

  const details = await request(`/api/admin/users/${targetId}`, {}, adminCookie);
  assert.equal(details.body.user.availableBalance, 7500);
  assert.ok(details.body.audit.some((entry) => entry.action === 'WALLET_BALANCE_ADJUSTED' && entry.metadata?.includes('Correct test credit')));
});

test('Admin configures Telegram group popup and support email for users', async () => {
  const settings = { telegramUrl: 'https://t.me/example_group', telegramPopupMessage: 'Join for short updates.', supportEmail: 'support@example.com', liveChatEnabled: true };
  const saved = await request('/api/admin/support/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(settings) }, adminCookie);
  assert.equal(saved.response.status, 200);
  assert.deepEqual(saved.body, settings);
  const publicSettings = await request('/api/support/settings', {}, targetCookie);
  assert.equal(publicSettings.response.status, 200);
  assert.equal(publicSettings.body.telegramUrl, settings.telegramUrl);
  assert.equal(publicSettings.body.telegramPopupMessage, settings.telegramPopupMessage);
  assert.equal(publicSettings.body.supportEmail, settings.supportEmail);
  const invalid = await request('/api/admin/support/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...settings, telegramUrl: 'http://t.me/example_group' }) }, adminCookie);
  assert.equal(invalid.response.status, 400);
});

test('keeps private messages isolated and records per-user broadcast read state', async () => {
  const privateResponse = await request('/api/admin/messages/private', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: targetId, title: 'Account update', body: 'Your account was reviewed.', notificationType: 'INFO' }) }, adminCookie);
  assert.equal(privateResponse.response.status, 201);
  const privateId = privateResponse.body.message.id;
  const targetInbox = await request('/api/user/messages', {}, targetCookie);
  assert.equal(targetInbox.body.unreadCount, 1);
  assert.equal(targetInbox.body.messages[0].id, privateId);
  assert.equal((await request('/api/user/messages', {}, otherCookie)).body.messages.some((message) => message.id === privateId), false);

  const broadcast = await request('/api/admin/messages/broadcast', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Maintenance', body: 'Service will be updated tonight.', notificationType: 'WARNING' }) }, adminCookie);
  assert.equal(broadcast.response.status, 201);
  const broadcastId = broadcast.body.broadcast.id;
  assert.equal((await request('/api/user/messages', {}, targetCookie)).body.messages.some((message) => message.id === broadcastId), true);
  assert.equal((await request('/api/user/messages', {}, otherCookie)).body.messages.some((message) => message.id === broadcastId), true);
  assert.equal((await request(`/api/user/messages/${privateId}/read`, { method: 'PATCH' }, otherCookie)).response.status, 404);
  assert.equal((await request(`/api/user/messages/${privateId}/read`, { method: 'PATCH' }, targetCookie)).response.status, 200);
  assert.equal((await request('/api/user/messages', {}, targetCookie)).body.unreadCount, 1);
  assert.equal((await request(`/api/user/messages/${broadcastId}/read`, { method: 'PATCH' }, targetCookie)).response.status, 200);
  assert.equal((await request('/api/user/messages', {}, targetCookie)).body.unreadCount, 0);
});

test('redacts Telegram settings by permission and resets passwords without retaining the plaintext', async () => {
  await request('/api/admin/support/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ telegramUrl: 'https://t.me/example_support', supportEmail: '', liveChatEnabled: false }) }, adminCookie);
  await request(`/api/admin/users/${targetId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ permissions: { telegram: false } }) }, adminCookie);
  const support = await request('/api/support/settings', {}, targetCookie);
  assert.equal(support.body.telegramUrl, '');
  await request(`/api/admin/users/${targetId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ permissions: { telegram: true } }) }, adminCookie);

  const reset = await request(`/api/admin/users/${targetId}/reset-password`, { method: 'POST' }, adminCookie);
  assert.equal(reset.response.status, 200);
  assert.match(reset.body.temporaryPassword, /^\d{6}$/);
  assert.equal((await request('/api/user/messages', {}, targetCookie)).response.status, 401);
  assert.equal((await request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phoneNumber: '0781234102', password: '123456' }) })).response.status, 401);
  const newLogin = await request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phoneNumber: '0781234102', password: reset.body.temporaryPassword }) });
  assert.equal(newLogin.response.status, 200);
  targetCookie = newLogin.cookie;
  const stored = database((db) => db.prepare('SELECT password_hash AS passwordHash FROM users WHERE id = ?').get(targetId));
  assert.equal(stored.passwordHash.includes(reset.body.temporaryPassword), false);
  const resetAudit = database((db) => db.prepare("SELECT new_value AS newValue, metadata FROM admin_audit_log WHERE target_user_id = ? AND action = 'PASSWORD_RESET' ORDER BY created_at DESC LIMIT 1").get(targetId));
  assert.ok(resetAudit);
  assert.equal(`${resetAudit.newValue ?? ''}${resetAudit.metadata ?? ''}`.includes(reset.body.temporaryPassword), false);
});

test('permanent deletion removes the account and its financial history and updates totals', async () => {
  database((db) => {
    db.prepare('INSERT INTO wallet_transactions (id, user_id, type, amount, phone_number, payment_method, status, provider, internal_reference) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('deleted-transaction', targetId, 'DEPOSIT', 12000, '0781234102', 'MTN_MOMO', 'SUCCESS', 'MTN_MOMO', 'DELETE-1');
    db.prepare('INSERT INTO wallet_audit_logs (id, transaction_id, actor_id, action) VALUES (?, ?, ?, ?)').run('deleted-wallet-audit', 'deleted-transaction', adminId, 'APPROVED');
    db.prepare('INSERT INTO plans (name, deposited, income_per_day, term, status, note, position, description, price, daily_income, duration_days, total_slots, sold_slots) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('Delete Product', '10000', '100', '10 days', 'Active', 'Test product', 99, 'Test product', 10000, 100, 10, 1, 1);
    db.prepare('INSERT INTO product_purchases (id, user_id, product_name, qualifying_amount, status, reference, product_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run('deleted-product-purchase', targetId, 'Delete Product', 10000, 'COMPLETED', 'DELETE-PURCHASE-1', 'Delete Product');
    db.prepare('INSERT INTO support_conversations (id, user_id) VALUES (?, ?)').run('deleted-support-conversation', targetId);
    db.prepare('INSERT INTO support_messages (id, conversation_id, author_id, body) VALUES (?, ?, ?, ?)').run('deleted-support-message', 'deleted-support-conversation', targetId, 'Remove this support activity.');
    db.prepare('INSERT INTO user_messages (id, sender_user_id, recipient_user_id, kind, body) VALUES (?, ?, ?, ?, ?)').run('deleted-inbox-message', adminId, targetId, 'PRIVATE', 'Remove this inbox message.');
    db.prepare('INSERT INTO user_message_reads (message_id, user_id) VALUES (?, ?)').run('deleted-inbox-message', targetId);
  });
  const removed = await request(`/api/admin/users/${targetId}`, { method: 'DELETE' }, adminCookie);
  assert.equal(removed.response.status, 200);
  assert.equal(removed.body.permanentlyDeleted, true);
  assert.equal((await request('/api/wallet/balance', {}, targetCookie)).response.status, 401);
  const removedData = database((db) => ({
    account: db.prepare('SELECT id FROM users WHERE id = ?').get(targetId),
    wallet: db.prepare('SELECT user_id FROM wallet_accounts WHERE user_id = ?').get(targetId),
    transaction: db.prepare('SELECT id FROM wallet_transactions WHERE id = ?').get('deleted-transaction'),
    walletAudit: db.prepare('SELECT id FROM wallet_audit_logs WHERE id = ?').get('deleted-wallet-audit'),
    purchase: db.prepare('SELECT id FROM product_purchases WHERE id = ?').get('deleted-product-purchase'),
    soldSlots: db.prepare('SELECT sold_slots AS soldSlots FROM plans WHERE name = ?').get('Delete Product')?.soldSlots,
    supportConversation: db.prepare('SELECT id FROM support_conversations WHERE id = ?').get('deleted-support-conversation'),
    supportMessage: db.prepare('SELECT id FROM support_messages WHERE id = ?').get('deleted-support-message'),
    inboxMessage: db.prepare('SELECT id FROM user_messages WHERE id = ?').get('deleted-inbox-message'),
    messageRead: db.prepare('SELECT message_id FROM user_message_reads WHERE message_id = ?').get('deleted-inbox-message'),
    access: db.prepare('SELECT account_status AS accountStatus, deleted_at AS deletedAt FROM user_access_controls WHERE user_id = ?').get(targetId),
  }));
  assert.equal(removedData.account, undefined);
  assert.equal(removedData.wallet, undefined);
  assert.equal(removedData.transaction, undefined);
  assert.equal(removedData.walletAudit, undefined);
  assert.equal(removedData.purchase, undefined);
  assert.equal(removedData.soldSlots, 0);
  assert.equal(removedData.supportConversation, undefined);
  assert.equal(removedData.supportMessage, undefined);
  assert.equal(removedData.inboxMessage, undefined);
  assert.equal(removedData.messageRead, undefined);
  assert.equal(removedData.access, undefined);
  const users = await request('/api/admin/users?limit=100', {}, adminCookie);
  assert.equal(users.body.total, 2);
});

test('Delete All is Admin-only, permanently removes non-Admin accounts and preserves Admin accounts', async () => {
  database((db) => db.prepare('INSERT INTO wallet_transactions (id, user_id, type, amount, phone_number, payment_method, status, provider, internal_reference) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('bulk-preserved-transaction', otherId, 'DEPOSIT', 9000, '0781234103', 'MTN_MOMO', 'SUCCESS', 'MTN_MOMO', 'BULK-PRESERVE-1'));
  assert.equal((await request('/api/admin/users', { method: 'DELETE' }, targetCookie)).response.status, 401);
  const result = await request('/api/admin/users', { method: 'DELETE' }, adminCookie);
  assert.equal(result.response.status, 200);
  assert.equal(result.body.deleted, 1);
  assert.equal(result.body.permanentlyDeleted, true);
  assert.equal((await request('/api/wallet/balance', {}, otherCookie)).response.status, 401);
  const remaining = database((db) => ({
    admins: db.prepare("SELECT count(*) AS count FROM users WHERE role = 'ADMIN'").get().count,
    transaction: db.prepare('SELECT id FROM wallet_transactions WHERE id = ?').get('bulk-preserved-transaction'),
    user: db.prepare('SELECT id FROM users WHERE id = ?').get(otherId),
  }));
  assert.equal(remaining.admins, 1);
  assert.equal(remaining.transaction, undefined);
  assert.equal(remaining.user, undefined);
  assert.equal((await request('/api/admin/users?limit=100', {}, adminCookie)).body.total, 1);
});