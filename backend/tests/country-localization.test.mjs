import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const root = resolve(import.meta.dirname, '../..');
const tempDirectory = mkdtempSync(join(tmpdir(), 'rwanda-country-localization-'));
const databasePath = join(tempDirectory, 'country.sqlite');
const port = 3144;
const baseUrl = `http://127.0.0.1:${port}`;
const adminToken = 'country-localization-test-admin';
const imageData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZk0AAAAASUVORK5CYII=';
let server;
let adminCookie;

async function request(path, options = {}, cookie) {
  const headers = { ...(options.headers ?? {}) };
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  return { response, body: await response.json(), cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] };
}

async function register(fullName, phoneNumber, referralCode, countryCode) {
  return request('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fullName, phoneNumber, password: '123456', ...(referralCode ? { referralCode } : {}), ...(countryCode ? { countryCode } : {}) }) });
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
  assert.equal(healthy, true, 'country localization API should start');

  const admin = await register('Localization Admin', '0781234501');
  assert.equal(admin.response.status, 201);
  const promoted = await request('/api/admin/members/role', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-admin-token': adminToken }, body: JSON.stringify({ phoneNumber: '0781234501', role: 'ADMIN' }) });
  assert.equal(promoted.response.status, 200);
  const login = await request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phoneNumber: '0781234501', password: '123456' }) });
  adminCookie = login.cookie;
});

after(async () => {
  if (server && server.exitCode === null) { server.kill(); await new Promise((resolveExit) => server.once('exit', resolveExit)); }
  try { rmSync(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { }
});

test('RW, BI and UG users get local display values while canonical RWF accounting and country payments stay isolated', async () => {
  const adminHeaders = { 'content-type': 'application/json' };
  const countryList = await request('/api/admin/countries', {}, adminCookie);
  assert.deepEqual(countryList.body.countries.map((country) => country.countryCode), ['RW', 'BI', 'UG']);
  assert.equal(countryList.body.countries.find((country) => country.countryCode === 'RW').unitsPerRwf, 1);
  assert.equal(countryList.body.countries.find((country) => country.countryCode === 'BI').unitsPerRwf, 2.03);
  assert.equal(countryList.body.countries.find((country) => country.countryCode === 'UG').unitsPerRwf, 2.69);
  assert.deepEqual((await request('/api/public/countries?mode=register')).body.countries.map((country) => country.countryCode), ['RW']);
  const loginCountriesBeforeEnable = await request('/api/public/countries?mode=login');
  assert.equal(loginCountriesBeforeEnable.response.status, 200, JSON.stringify(loginCountriesBeforeEnable.body));
  assert.deepEqual(loginCountriesBeforeEnable.body.countries.map((country) => country.countryCode), ['RW']);

  const disabledBi = await register('Disabled Burundi', '067111111', undefined, 'BI');
  assert.equal(disabledBi.response.status, 403);
  assert.equal(disabledBi.body.code, 'COUNTRY_DISABLED');

  for (const setting of [
    { countryCode: 'BI', enabled: true, unitsPerRwf: 3, withdrawalMethods: ['AIRTEL_MONEY'] },
    { countryCode: 'UG', enabled: true, unitsPerRwf: 2, withdrawalMethods: ['MTN_MOMO'] },
  ]) {
    const zeroRate = await request(`/api/admin/countries/${setting.countryCode}`, { method: 'PUT', headers: adminHeaders, body: JSON.stringify({ ...setting, unitsPerRwf: 0 }) }, adminCookie);
    assert.equal(zeroRate.response.status, 400);
    const updated = await request(`/api/admin/countries/${setting.countryCode}`, { method: 'PUT', headers: adminHeaders, body: JSON.stringify(setting) }, adminCookie);
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.unitsPerRwf, setting.unitsPerRwf);
  }
  assert.deepEqual((await request('/api/public/countries?mode=register')).body.countries.map((country) => country.countryCode), ['RW', 'BI', 'UG']);

  const rwUser = await register('Rwanda User', '0781234502');
  const biReferrer = await register('Burundi Referrer', '067111112', undefined, 'BI');
  const detectedBi = await register('Detected Burundi', '+25767111113');
  const ugBuyer = await register('Uganda Buyer', '0771111123', biReferrer.body.user.referralCode, 'UG');
  assert.equal(rwUser.response.status, 201);
  assert.equal(rwUser.body.user.countryCode, 'RW');
  assert.equal(rwUser.body.user.currencyCode, 'RWF');
  assert.equal(rwUser.body.user.displayWelcomeBonusAmount, 7500);
  assert.equal(biReferrer.body.user.countryCode, 'BI');
  assert.equal(biReferrer.body.user.currencyCode, 'BIF');
  assert.equal(biReferrer.body.user.displayWelcomeBonusAmount, 22500);
  assert.equal(detectedBi.response.status, 201);
  assert.equal(detectedBi.body.user.countryCode, 'BI');
  assert.equal(detectedBi.body.user.currencyCode, 'BIF');
  assert.equal(ugBuyer.body.user.countryCode, 'UG');
  assert.equal(ugBuyer.body.user.currencyCode, 'UGX');
  assert.equal(ugBuyer.body.user.displayWelcomeBonusAmount, 15000);
  assert.equal(ugBuyer.body.user.welcomeBonusStatus, 'LOCKED');
  const ugLogin = await request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phoneNumber: '0771111123', countryCode: 'UG', password: '123456' }) });
  assert.equal(ugLogin.body.user.currencyCode, 'UGX');
  assert.deepEqual((await request('/api/public/countries?mode=login')).body.countries.map((country) => country.countryCode), ['RW', 'BI', 'UG']);

  const product = { name: 'Canonical Localization Product', description: 'One shared RWF base product.', imageData, price: 10000, dailyIncome: 100, durationDays: 10, purchaseBonus: 0, totalSlots: 10, status: 'Active', position: 1 };
  assert.equal((await request('/api/admin/plans', { method: 'POST', headers: adminHeaders, body: JSON.stringify(product) }, adminCookie)).response.status, 201);
  const rwCommissionSettings = await request('/api/admin/referral-settings', { method: 'POST', headers: adminHeaders, body: JSON.stringify({ level: 1, percentage: 5 }) }, adminCookie);
  assert.equal(rwCommissionSettings.response.status, 200);
  const biCatalog = await request('/api/dashboard', {}, biReferrer.cookie);
  const ugCatalog = await request('/api/dashboard', {}, ugBuyer.cookie);
  assert.equal(biCatalog.body.plans[0].price, 10000);
  assert.equal(biCatalog.body.plans[0].displayPrice, 30000);
  assert.equal(biCatalog.body.plans[0].currencyCode, 'BIF');
  assert.equal(ugCatalog.body.plans[0].displayPrice, 20000);
  assert.equal(ugCatalog.body.plans[0].currencyCode, 'UGX');

  const depositMethodIds = {};
  for (const countryCode of ['RW', 'BI', 'UG']) {
    const name = `${countryCode} Deposit`;
    const created = await request('/api/admin/deposit-methods', { method: 'POST', headers: adminHeaders, body: JSON.stringify({ name, countryCode, accountName: `${name} Merchant`, accountNumber: '0792000000', minimumAmount: 1000, maximumAmount: 100000, enabled: true }) }, adminCookie);
    assert.equal(created.response.status, 201);
    assert.equal(created.body.method.crossBorderEnabled, false);
    assert.equal(created.body.method.receivingCountryCode, countryCode);
    depositMethodIds[countryCode] = created.body.method.id;
  }
  const rwDepositMethods = await request('/api/wallet/deposit/methods', {}, rwUser.cookie);
  const biDepositMethods = await request('/api/wallet/deposit/methods', {}, biReferrer.cookie);
  const ugDepositMethods = await request('/api/wallet/deposit/methods', {}, ugBuyer.cookie);
  assert.deepEqual(rwDepositMethods.body.methods.map((method) => method.name), ['RW Deposit']);
  assert.deepEqual(biDepositMethods.body.methods.map((method) => method.name), ['BI Deposit']);
  assert.equal(biDepositMethods.body.methods[0].minimumAmount, 3000);
  assert.deepEqual(ugDepositMethods.body.methods.map((method) => method.name), ['UG Deposit']);
  assert.equal(ugDepositMethods.body.methods[0].minimumAmount, 2000);
  assert.deepEqual((await request('/api/wallet/withdraw/methods', {}, biReferrer.cookie)).body.methods.map((method) => method.code), ['AIRTEL_MONEY']);
  assert.deepEqual((await request('/api/wallet/withdraw/methods', {}, ugBuyer.cookie)).body.methods.map((method) => method.code), ['MTN_MOMO']);
  assert.equal((await request('/api/wallet/withdraw/methods', {}, rwUser.cookie)).body.methods.length, 2);

  const invalidCrossBorder = await request(`/api/admin/deposit-methods/${depositMethodIds.UG}`, { method: 'PUT', headers: adminHeaders, body: JSON.stringify({ name: 'UG Deposit', accountName: 'UG Deposit Merchant', accountNumber: '0792000000', minimumAmount: 1000, maximumAmount: 100000, enabled: true, countryCode: 'UG', crossBorderEnabled: true, receivingCountryCode: 'XX' }) }, adminCookie);
  assert.equal(invalidCrossBorder.response.status, 400);
  const crossBorderConfig = await request(`/api/admin/deposit-methods/${depositMethodIds.UG}`, { method: 'PUT', headers: adminHeaders, body: JSON.stringify({ name: 'UG Deposit', accountName: 'UG Deposit Merchant', accountNumber: '0792000000', minimumAmount: 1000, maximumAmount: 100000, enabled: true, countryCode: 'UG', crossBorderEnabled: true, receivingCountryCode: 'BI' }) }, adminCookie);
  assert.equal(crossBorderConfig.response.status, 200);
  assert.equal(crossBorderConfig.body.method.crossBorderEnabled, true);
  assert.equal(crossBorderConfig.body.method.receivingCountryCode, 'BI');
  const ugCrossBorderMethod = (await request('/api/wallet/deposit/methods', {}, ugBuyer.cookie)).body.methods[0];
  assert.equal(ugCrossBorderMethod.customerUnitsPerRwf, 2);
  assert.equal(ugCrossBorderMethod.receivingCurrencyCode, 'BIF');
  assert.equal(ugCrossBorderMethod.receivingUnitsPerRwf, 3);
  const crossBorderDeposit = await request('/api/deposits', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount: 2000, phoneNumber: '+256771111123', senderName: 'Uganda Payer', depositMethodId: depositMethodIds.UG, screenshotData: imageData }) }, ugBuyer.cookie);
  assert.equal(crossBorderDeposit.response.status, 201);
  assert.equal(crossBorderDeposit.body.transaction.amount, 1000);
  assert.equal(crossBorderDeposit.body.transaction.depositReceivingCountryCode, 'BI');
  assert.equal(crossBorderDeposit.body.transaction.depositReceivingCurrencyCode, 'BIF');
  assert.equal(crossBorderDeposit.body.transaction.depositPaymentAmount, 3000);

  const biDeposit = await request('/api/deposits', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount: 3000, phoneNumber: '+25767111112', senderName: 'Burundi Referrer', depositMethodId: biDepositMethods.body.methods[0].id, screenshotData: imageData }) }, biReferrer.cookie);
  assert.equal(biDeposit.response.status, 201);
  assert.equal(biDeposit.body.transaction.amount, 1000);
  assert.equal(biDeposit.body.transaction.displayAmount, 3000);
  assert.equal(biDeposit.body.transaction.currencyCode, 'BIF');

  setBalance(ugBuyer.body.user.id, 50000);
  const purchase = await request('/api/purchases', { method: 'POST', headers: adminHeaders, body: JSON.stringify({ productId: product.name, idempotencyKey: 'country-localization-purchase-1' }) }, ugBuyer.cookie);
  assert.equal(purchase.response.status, 201);
  assert.equal(purchase.body.purchase.qualifying_amount, 10000);
  assert.equal(purchase.body.purchase.currency_code, 'UGX');
  assert.equal(purchase.body.purchase.display_amount, 20000);
  assert.equal(purchase.body.balance.welcomeBonusStatus, 'UNLOCKED');
  assert.equal(purchase.body.balance.displayAvailableBalance, 95000);

  const biWithdrawalAccount = await request('/api/wallet/withdraw/account', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountHolderName: 'Burundi Referrer', phoneNumber: '+25767111112', paymentMethod: 'AIRTEL_MONEY' }) }, biReferrer.cookie);
  assert.equal(biWithdrawalAccount.response.status, 200);
  setBalance(biReferrer.body.user.id, 50000);
  const preview = await request('/api/withdrawals/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount: 3000, paymentMethod: 'AIRTEL_MONEY' }) }, biReferrer.cookie);
  assert.equal(preview.response.status, 200);
  assert.equal(preview.body.withdrawalAmount, 1000);
  assert.equal(preview.body.displayWithdrawalAmount, 3000);
  assert.equal(preview.body.currencyCode, 'BIF');
  const team = await request('/api/team', {}, biReferrer.cookie);
  assert.equal(team.body.availableCommission, 500);
  assert.equal(team.body.displayAvailableCommission, 1500);
  assert.equal(team.body.currencyCode, 'BIF');

  const withdrawal = await request('/api/withdrawals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount: 3000, paymentMethod: 'AIRTEL_MONEY' }) }, biReferrer.cookie);
  assert.equal(withdrawal.response.status, 201);
  assert.equal(withdrawal.body.transaction.amount, 1000);
  assert.equal(withdrawal.body.transaction.displayAmount, 3000);
  assert.equal(withdrawal.body.transaction.currencyCode, 'BIF');

  const adminUsers = await request('/api/admin/users', {}, adminCookie);
  assert.equal(adminUsers.body.users.find((entry) => entry.id === ugBuyer.body.user.id).countryCode, 'UG');
  const accountDetails = await request(`/api/admin/users/${ugBuyer.body.user.id}`, {}, adminCookie);
  assert.equal(accountDetails.body.user.currencyCode, 'UGX');
});