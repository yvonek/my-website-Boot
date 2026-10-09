import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const root = resolve(import.meta.dirname, '../..');
const tempDirectory = mkdtempSync(join(tmpdir(), 'rwanda-platform-settings-'));
const databasePath = join(tempDirectory, 'platform.sqlite');
const port = 3132;
const baseUrl = `http://127.0.0.1:${port}`;
const adminToken = 'platform-settings-test-admin';
const productImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZk0AAAAASUVORK5CYII=';
let server;
let adminCookie;

async function request(path, options = {}, cookie) {
  const headers = { ...(options.headers ?? {}) };
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const body = await response.json();
  return { response, body, cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] };
}

async function register(fullName, phoneNumber, referralCode) {
  return request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fullName, phoneNumber, password: '123456', ...(referralCode ? { referralCode } : {}) }),
  });
}

function setBalance(userId, amount) {
  const db = new DatabaseSync(databasePath);
  try { db.prepare('UPDATE wallet_accounts SET available_balance = ? WHERE user_id = ?').run(amount, userId); }
  finally { db.close(); }
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
  assert.equal(healthy, true, 'platform settings test API should start');

  const admin = await register('Platform Admin', '0781234001');
  assert.equal(admin.response.status, 201);
  const promoted = await request('/api/admin/members/role', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-admin-token': adminToken },
    body: JSON.stringify({ phoneNumber: '0781234001', role: 'ADMIN' }),
  });
  assert.equal(promoted.response.status, 200);
  const login = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phoneNumber: '0781234001', password: '123456' }),
  });
  assert.equal(login.response.status, 200);
  adminCookie = login.cookie;
});

after(async () => {
  if (server && server.exitCode === null) { server.kill(); await new Promise((resolveExit) => server.once('exit', resolveExit)); }
  try { rmSync(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { }
});

test('central settings award one global welcome bonus and snapshot configured withdrawal fees', async () => {
  assert.equal((await request('/api/admin/platform-settings')).response.status, 401);
  const initial = await request('/api/admin/platform-settings', {}, adminCookie);
  assert.equal(initial.response.status, 200);
  assert.equal(initial.body.welcomeBonusEnabled, true);
  assert.equal(initial.body.welcomeBonusAmount, 7500);

  const settings = {
    withdrawalFeeEnabled: true,
    withdrawalFeeType: 'PERCENTAGE',
    withdrawalFeeValue: 5,
    welcomeBonusEnabled: true,
    welcomeBonusAmount: 5000,
  };
  const saved = await request('/api/admin/platform-settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(settings) }, adminCookie);
  assert.equal(saved.response.status, 200);
  assert.deepEqual(saved.body, settings);
  const invalid = await request('/api/admin/platform-settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...settings, withdrawalFeeValue: 101 }) }, adminCookie);
  assert.equal(invalid.response.status, 400);

  const productInput = {
    name: 'Starter CCTV', description: 'Platform settings integration product.', imageData: productImage,
    price: 10000, dailyIncome: 500, durationDays: 40, purchaseBonus: 1000, totalSlots: 500, status: 'Active', position: 1,
  };
  const created = await request('/api/admin/plans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(productInput) }, adminCookie);
  assert.equal(created.response.status, 201);

  const user = await register('Bonus Account', '0781234002');
  assert.equal(user.response.status, 201);
  assert.equal(user.body.user.welcomeBonusAmount, 5000);
  assert.ok(user.body.user.welcomeBonusAwardedAt);
  assert.equal(user.body.user.welcomeBonusStatus, 'LOCKED');
  const startingBalance = await request('/api/wallet/balance', {}, user.cookie);
  assert.equal(startingBalance.body.availableBalance, 0);
  assert.equal(startingBalance.body.lockedWelcomeBonus, 5000);
  const legacyUser = await register('Legacy Bonus Account', '0781234007');
  const legacyDb = new DatabaseSync(databasePath);
  try {
    legacyDb.prepare('UPDATE users SET welcome_bonus_unlocked_at = welcome_bonus_awarded_at WHERE id = ?').run(legacyUser.body.user.id);
    legacyDb.prepare('UPDATE wallet_accounts SET available_balance = ? WHERE user_id = ?').run(5000, legacyUser.body.user.id);
  } finally { legacyDb.close(); }
  const legacyBalance = await request('/api/wallet/balance', {}, legacyUser.cookie);
  assert.equal(legacyBalance.body.availableBalance, 0);
  assert.equal(legacyBalance.body.lockedWelcomeBonus, 5000);
  assert.equal(legacyBalance.body.welcomeBonusStatus, 'LOCKED');
  const bound = await request('/api/wallet/withdraw/account', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountHolderName: 'Bonus Account', phoneNumber: '0781234002', paymentMethod: 'MTN_MOMO' }),
  }, user.cookie);
  assert.equal(bound.response.status, 200);
  const lockedWithdrawal = await request('/api/wallet/withdraw/preview', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount: 1 }),
  }, user.cookie);
  assert.equal(lockedWithdrawal.response.status, 400);
  const dashboard = await request('/api/dashboard', {}, user.cookie);
  assert.equal(dashboard.body.plans.length, 1);
  assert.equal(dashboard.body.plans[0].name, 'Starter CCTV');
  assert.equal(dashboard.body.plans[0].price, 10000);
  assert.equal(dashboard.body.plans[0].dailyIncome, 500);
  assert.equal(dashboard.body.plans[0].durationDays, 40);
  assert.equal(dashboard.body.plans[0].totalIncome, 20000);
  assert.equal(dashboard.body.plans[0].purchaseBonus, 0);
  assert.equal('welcomeBonus' in dashboard.body.plans[0], false);

  const unavailable = await request(`/api/admin/plans/${encodeURIComponent(productInput.name)}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...productInput, status: 'Ending soon' }),
  }, adminCookie);
  assert.equal(unavailable.response.status, 200);
  assert.deepEqual((await request('/api/dashboard', {}, user.cookie)).body.plans, []);
  await request(`/api/admin/plans/${encodeURIComponent(productInput.name)}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(productInput),
  }, adminCookie);

  setBalance(user.body.user.id, 50000);
  const purchase = await request('/api/purchases', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId: productInput.name, purchaseBonus: 99999, idempotencyKey: 'platform-starter-cctv-purchase' }),
  }, user.cookie);
  assert.equal(purchase.response.status, 201);
  assert.equal(purchase.body.product.soldSlots, 1);
  assert.equal(purchase.body.product.totalSlots, 500);
  assert.equal(purchase.body.product.remainingSlots, 499);
  assert.equal(purchase.body.purchase.qualifying_amount, 10000);
  assert.equal(purchase.body.balance.availableBalance, 45000);
  assert.equal(purchase.body.balance.lockedWelcomeBonus, 0);
  assert.equal(purchase.body.balance.welcomeBonusStatus, 'UNLOCKED');
  const afterUnlock = await request('/api/wallet/balance', {}, user.cookie);
  assert.equal(afterUnlock.body.availableBalance, 45000);
  assert.equal(afterUnlock.body.lockedWelcomeBonus, 0);

  setBalance(user.body.user.id, 100000);
  const preview = await request('/api/wallet/withdraw/preview', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amount: 10000, withdrawalFee: 0, amountReceived: 99999 }),
  }, user.cookie);
  assert.equal(preview.response.status, 200);
  assert.equal(preview.body.withdrawalAmount, 10000);
  assert.equal(preview.body.withdrawalFee, 500);
  assert.equal(preview.body.amountReceived, 9500);

  const first = await request('/api/wallet/withdraw', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amount: 10000, withdrawalFee: 0, amountReceived: 99999 }),
  }, user.cookie);
  assert.equal(first.response.status, 201);
  assert.equal(first.body.transaction.amount, 10000);
  assert.equal(first.body.transaction.withdrawalFee, 500);
  assert.equal(first.body.transaction.amountReceived, 9500);
  const afterFirst = await request('/api/wallet/balance', {}, user.cookie);
  assert.equal(afterFirst.body.availableBalance, 90000);
  assert.equal(afterFirst.body.reservedBalance, 10000);

  const changedSettings = { ...settings, withdrawalFeeValue: 3 };
  assert.equal((await request('/api/admin/platform-settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(changedSettings) }, adminCookie)).response.status, 200);
  const secondPreview = await request('/api/wallet/withdraw/preview', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount: 10000 }),
  }, user.cookie);
  assert.equal(secondPreview.body.withdrawalFee, 300);
  assert.equal(secondPreview.body.amountReceived, 9700);
  const second = await request('/api/wallet/withdraw', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount: 10000 }),
  }, user.cookie);
  assert.equal(second.response.status, 201);
  assert.equal(second.body.transaction.withdrawalFee, 300);
  assert.equal(second.body.transaction.amountReceived, 9700);

  const rejected = await request(`/api/admin/transactions/${first.body.transaction.id}/reject`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'Test rejection' }),
  }, adminCookie);
  assert.equal(rejected.response.status, 200);
  assert.equal(rejected.body.transaction.status, 'REJECTED');
  assert.equal(rejected.body.transaction.withdrawalFee, 500);
  assert.equal(rejected.body.transaction.amountReceived, 9500);
  const approved = await request(`/api/admin/transactions/${second.body.transaction.id}/approve`, { method: 'POST' }, adminCookie);
  assert.equal(approved.body.transaction.status, 'AWAITING_PAYOUT');
  assert.equal(approved.body.transaction.withdrawalFee, 300);

  const fixedSettings = { ...changedSettings, withdrawalFeeType: 'FIXED', withdrawalFeeValue: 250 };
  assert.equal((await request('/api/admin/platform-settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fixedSettings) }, adminCookie)).response.status, 200);
  const fixedPreview = await request('/api/wallet/withdraw/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount: 10000 }) }, user.cookie);
  assert.equal(fixedPreview.body.withdrawalFee, 250);
  const disabledSettings = { ...fixedSettings, withdrawalFeeEnabled: false };
  assert.equal((await request('/api/admin/platform-settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(disabledSettings) }, adminCookie)).response.status, 200);
  const noFeePreview = await request('/api/wallet/withdraw/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount: 10000 }) }, user.cookie);
  assert.equal(noFeePreview.body.withdrawalFee, 0);
  assert.equal(noFeePreview.body.amountReceived, 10000);

  const login = await request('/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phoneNumber: '0781234002', password: '123456' }),
  });
  assert.equal(login.response.status, 200);
  assert.equal((await request('/api/wallet/balance', {}, login.cookie)).body.availableBalance, 90000);
  const duplicate = await register('Bonus Account Duplicate', '0781234002');
  assert.equal(duplicate.response.status, 409);
});

test('confirmed product purchase credits referral levels once and idempotent retries do not charge twice', async () => {
  const adminHeaders = { 'content-type': 'application/json' };
  const feeDisabled = { withdrawalFeeEnabled: false, withdrawalFeeType: 'PERCENTAGE', withdrawalFeeValue: 5, welcomeBonusEnabled: true, welcomeBonusAmount: 5000 };
  assert.equal((await request('/api/admin/platform-settings', { method: 'PUT', headers: adminHeaders, body: JSON.stringify(feeDisabled) }, adminCookie)).response.status, 200);
  for (const [level, percentage] of [[1, 5], [2, 2], [3, 1]]) {
    const saved = await request('/api/admin/referral-settings', { method: 'POST', headers: adminHeaders, body: JSON.stringify({ level, percentage }) }, adminCookie);
    assert.equal(saved.response.status, 200);
  }
  const root = await register('Level Three Referrer', '0781234003');
  const middle = await register('Level Two Referrer', '0781234004', root.body.user.referralCode);
  const direct = await register('Direct Referrer', '0781234005', middle.body.user.referralCode);
  const buyer = await register('Commission Buyer', '0781234006', direct.body.user.referralCode);
  const product = {
    name: 'Commission CCTV', description: 'Referral commission idempotency test.', imageData: productImage,
    price: 10000, dailyIncome: 500, durationDays: 40, purchaseBonus: 1000, totalSlots: 10, status: 'Active', position: 2,
  };
  const created = await request('/api/admin/plans', { method: 'POST', headers: adminHeaders, body: JSON.stringify(product) }, adminCookie);
  assert.equal(created.response.status, 201);
  setBalance(buyer.body.user.id, 20000);

  const idempotencyKey = 'three-level-cctv-purchase-1';
  const body = JSON.stringify({ productId: product.name, idempotencyKey });
  const purchase = await request('/api/purchases', { method: 'POST', headers: adminHeaders, body }, buyer.cookie);
  assert.equal(purchase.response.status, 201);
  assert.equal(purchase.body.balance.availableBalance, 15000);
  const replay = await request('/api/purchases', { method: 'POST', headers: adminHeaders, body }, buyer.cookie);
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.idempotentReplay, true);
  assert.equal(replay.body.purchase.id, purchase.body.purchase.id);
  assert.equal((await request('/api/wallet/balance', {}, buyer.cookie)).body.availableBalance, 15000);

  const db = new DatabaseSync(databasePath);
  try {
    const commissions = db.prepare('SELECT beneficiary_user_id AS beneficiaryUserId, referral_level AS referralLevel, percentage, qualifying_amount AS qualifyingAmount, commission_amount AS commissionAmount, status FROM commission_ledger WHERE purchase_id = ? ORDER BY referral_level').all(purchase.body.purchase.id).map((row) => ({ ...row }));
    assert.deepEqual(commissions, [
      { beneficiaryUserId: direct.body.user.id, referralLevel: 1, percentage: 5, qualifyingAmount: 10000, commissionAmount: 500, status: 'APPROVED' },
      { beneficiaryUserId: middle.body.user.id, referralLevel: 2, percentage: 2, qualifyingAmount: 10000, commissionAmount: 200, status: 'APPROVED' },
      { beneficiaryUserId: root.body.user.id, referralLevel: 3, percentage: 1, qualifyingAmount: 10000, commissionAmount: 100, status: 'APPROVED' },
    ]);
    assert.equal(db.prepare('SELECT count(*) AS count FROM product_purchases WHERE user_id = ? AND idempotency_key = ?').get(buyer.body.user.id, idempotencyKey).count, 1);
    assert.equal(db.prepare('SELECT available_balance FROM wallet_accounts WHERE user_id = ?').get(direct.body.user.id).available_balance, 500);
    assert.equal(db.prepare('SELECT available_balance FROM wallet_accounts WHERE user_id = ?').get(middle.body.user.id).available_balance, 200);
    assert.equal(db.prepare('SELECT available_balance FROM wallet_accounts WHERE user_id = ?').get(root.body.user.id).available_balance, 100);
  } finally { db.close(); }

    const team = await request('/api/team', {}, direct.cookie);
    assert.equal(team.body.activeReferrals, 1);
    assert.equal(team.body.pendingCommission, 0);
    assert.equal(team.body.availableCommission, 500);
    assert.equal(team.body.earnings, 500);
    assert.equal(team.body.levels.find((member) => member.userId === buyer.body.user.id).activeReferral, true);

  const referralList = await request('/api/admin/promoters', {}, adminCookie);
  assert.equal(referralList.response.status, 200);
  assert.equal(referralList.body.promoters.find((item) => item.userId === direct.body.user.id).activeMembers, 1);
    const promoterDetail = await request(`/api/admin/promoters/${direct.body.user.id}`, {}, adminCookie);
    assert.equal(promoterDetail.body.commissions.length, 1);
    assert.equal(promoterDetail.body.commissions[0].commissionAmount, 500);
    const overview = await request('/api/admin/overview', {}, adminCookie);
    assert.equal(overview.body.summary.totalReferralCommissions, 800);

    const bound = await request('/api/wallet/withdraw/account', { method: 'PUT', headers: adminHeaders, body: JSON.stringify({ accountHolderName: 'Direct Referrer', phoneNumber: '0781234005', paymentMethod: 'MTN_MOMO' }) }, direct.cookie);
    assert.equal(bound.response.status, 200);
    const commissionWithdrawal = await request('/api/wallet/withdraw', { method: 'POST', headers: adminHeaders, body: JSON.stringify({ amount: 250 }) }, direct.cookie);
    assert.equal(commissionWithdrawal.response.status, 201);
    assert.equal(commissionWithdrawal.body.transaction.commissionAmount, 250);
    const whilePending = await request('/api/team', {}, direct.cookie);
    assert.equal(whilePending.body.availableCommission, 250);
    const rejectedWithdrawal = await request(`/api/admin/transactions/${commissionWithdrawal.body.transaction.id}/reject`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ reason: 'Restore commission allocation' }) }, adminCookie);
    assert.equal(rejectedWithdrawal.response.status, 200);
    const afterReject = await request('/api/team', {}, direct.cookie);
    assert.equal(afterReject.body.availableCommission, 500);
});
