import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const root = resolve(import.meta.dirname, '../..');
const tempDirectory = mkdtempSync(join(tmpdir(), 'rwanda-products-'));
const databasePath = join(tempDirectory, 'products.sqlite');
const port = 3127;
const baseUrl = `http://127.0.0.1:${port}`;
const adminToken = 'investment-products-test-admin';
const imageData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZk0AAAAASUVORK5CYII=';
let server;
let userCookie;
let secondUserCookie;

async function request(path, options = {}, cookie) {
  const headers = { ...(options.headers ?? {}) };
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const body = await response.json();
  return { response, body, cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] };
}

async function register(fullName, phoneNumber) {
  const result = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fullName, phoneNumber, password: '123456' }),
  });
  assert.equal(result.response.status, 201);
  return { user: result.body.user, cookie: result.cookie };
}

function setBalance(userId, balance) {
  const database = new DatabaseSync(databasePath);
  try { database.prepare('UPDATE wallet_accounts SET available_balance = ? WHERE user_id = ?').run(balance, userId); }
  finally { database.close(); }
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
  const bonusDisabled = await request('/api/admin/platform-settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-admin-token': adminToken },
    body: JSON.stringify({ withdrawalFeeEnabled: false, withdrawalFeeType: 'PERCENTAGE', withdrawalFeeValue: 0, welcomeBonusEnabled: false, welcomeBonusAmount: 0 }),
  });
  assert.equal(bonusDisabled.response.status, 200);
  const first = await register('Product Buyer', '0781234991');
  const second = await register('Concurrent Buyer', '0781234992');
  userCookie = first.cookie;
  secondUserCookie = second.cookie;
  setBalance(first.user.id, 1000);
  setBalance(second.user.id, 1000);
});

after(async () => {
  if (server && server.exitCode === null) { server.kill(); await new Promise((resolveExit) => server.once('exit', resolveExit)); }
  try { rmSync(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { }
});

test('Admin products feed the user catalog and purchases atomically update balances and slots', async () => {
  const productInput = {
    name: 'Greenhouse Starter',
    description: 'A test investment product with a real uploaded image.',
    imageData,
    price: 100,
    dailyIncome: 10,
    durationDays: 30,
    purchaseBonus: 20,
    totalSlots: 2,
    status: 'Active',
    position: 1,
  };
  const adminHeaders = { 'content-type': 'application/json', 'x-admin-token': adminToken };
  const created = await request('/api/admin/plans', { method: 'POST', headers: adminHeaders, body: JSON.stringify(productInput) });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.plan.imageData, imageData);
  assert.equal(created.body.plan.purchaseBonus, 0);
  assert.equal(created.body.plan.remainingSlots, 2);

  const catalog = await request('/api/dashboard', {}, userCookie);
  assert.equal(catalog.response.status, 200);
  assert.equal(catalog.body.plans.length, 1);
  assert.equal(catalog.body.plans[0].name, productInput.name);
  assert.equal(catalog.body.plans[0].imageData, imageData);
  assert.equal(catalog.body.plans[0].price, productInput.price);
  assert.equal(catalog.body.plans[0].totalIncome, 300);
  assert.equal(catalog.body.plans[0].progressPercent, 0);

  const missingIdempotencyKey = await request('/api/purchases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ productId: productInput.name }),
  }, userCookie);
  assert.equal(missingIdempotencyKey.response.status, 400);
  assert.match(missingIdempotencyKey.body.error, /idempotency key/i);

  const firstPurchase = await request('/api/purchases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ productId: productInput.name, qualifyingAmount: 1, idempotencyKey: 'greenhouse-buyer-purchase-1' }),
  }, userCookie);
  assert.equal(firstPurchase.response.status, 201);
  assert.equal(firstPurchase.body.purchase.qualifying_amount, 100);
  assert.equal(firstPurchase.body.balance.availableBalance, 900);
  assert.equal(firstPurchase.body.product.soldSlots, 1);
  assert.equal(firstPurchase.body.product.remainingSlots, 1);
  assert.equal(firstPurchase.body.product.progressPercent, 50);

  const edited = await request(`/api/admin/plans/${encodeURIComponent(productInput.name)}`, {
    method: 'PUT',
    headers: adminHeaders,
    body: JSON.stringify({ ...productInput, description: 'Updated terms for new buyers.', imageData, price: 500, dailyIncome: 50, durationDays: 60, purchaseBonus: 40 }),
  });
  assert.equal(edited.response.status, 200);
  const purchaseSnapshot = new DatabaseSync(databasePath);
  try {
    const snapshot = { ...purchaseSnapshot.prepare('SELECT qualifying_amount, description_snapshot, daily_income_snapshot, duration_days_snapshot, purchase_bonus_snapshot FROM product_purchases WHERE id = ?').get(firstPurchase.body.purchase.id) };
    assert.deepEqual(snapshot, { qualifying_amount: 100, description_snapshot: productInput.description, daily_income_snapshot: 10, duration_days_snapshot: 30, purchase_bonus_snapshot: 0 });
  } finally { purchaseSnapshot.close(); }

  const currentCatalog = await request('/api/dashboard', {}, userCookie);
  assert.equal(currentCatalog.body.plans[0].price, 500);
  assert.equal(currentCatalog.body.plans[0].description, 'Updated terms for new buyers.');

  const secondPurchase = await request('/api/purchases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ productId: productInput.name, idempotencyKey: 'greenhouse-buyer-purchase-2' }),
  }, userCookie);
  assert.equal(secondPurchase.response.status, 400);
  assert.match(secondPurchase.body.error, /already purchased/i);
  assert.equal((await request('/api/wallet/balance', {}, userCookie)).body.availableBalance, 900);

  const otherBuyerPurchase = await request('/api/purchases', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ productId: productInput.name, idempotencyKey: 'greenhouse-other-buyer-1' }),
  }, secondUserCookie);
  assert.equal(otherBuyerPurchase.response.status, 201);
  assert.equal(otherBuyerPurchase.body.balance.availableBalance, 500);
  assert.equal(otherBuyerPurchase.body.product.soldSlots, 2);
  assert.equal(otherBuyerPurchase.body.product.remainingSlots, 0);
  assert.equal(otherBuyerPurchase.body.product.progressPercent, 100);
  assert.equal(otherBuyerPurchase.body.product.soldOut, true);

  const otherProductInput = { ...productInput, name: 'Greenhouse Plus', description: 'A different product can still be purchased.', price: 500, dailyIncome: 50, durationDays: 60, totalSlots: 1, position: 2 };
  const otherProduct = await request('/api/admin/plans', { method: 'POST', headers: adminHeaders, body: JSON.stringify(otherProductInput) });
  assert.equal(otherProduct.response.status, 201);
  const differentPurchase = await request('/api/purchases', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ productId: otherProductInput.name, idempotencyKey: 'greenhouse-plus-purchase-1' }),
  }, userCookie);
  assert.equal(differentPurchase.response.status, 201);
  assert.equal(differentPurchase.body.balance.availableBalance, 400);
  assert.equal(differentPurchase.body.product.soldOut, true);

  const soldOut = await request('/api/purchases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ productId: otherProductInput.name, idempotencyKey: 'greenhouse-plus-repeat' }),
  }, userCookie);
  assert.equal(soldOut.response.status, 400);
  assert.match(soldOut.body.error, /already purchased/i);
  const balanceAfterReject = await request('/api/wallet/balance', {}, userCookie);
  assert.equal(balanceAfterReject.body.availableBalance, 400);
  const adminList = await request('/api/admin/plans', { headers: { 'x-admin-token': adminToken } });
  assert.equal(adminList.body.plans.find((plan) => plan.name === productInput.name).soldSlots, 2);
  assert.equal(adminList.body.plans.find((plan) => plan.name === productInput.name).soldOut, true);
  assert.equal(adminList.body.plans.find((plan) => plan.name === otherProductInput.name).soldSlots, 1);

  const expensiveProduct = await request('/api/admin/plans', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ ...productInput, name: 'Insufficient Balance Product', price: 10000, totalSlots: 1 }),
  });
  assert.equal(expensiveProduct.response.status, 201);
  const insufficient = await request('/api/purchases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ productId: 'Insufficient Balance Product', idempotencyKey: 'greenhouse-buyer-insufficient' }),
  }, userCookie);
  assert.equal(insufficient.response.status, 400);
  const afterInsufficient = await request('/api/admin/plans', { headers: { 'x-admin-token': adminToken } });
  assert.equal(afterInsufficient.body.plans.find((plan) => plan.name === 'Insufficient Balance Product').soldSlots, 0);
  assert.equal((await request('/api/wallet/balance', {}, userCookie)).body.availableBalance, 400);
});

test('concurrent purchases cannot oversell the final product slot', async () => {
  const product = {
    name: 'Single Slot Product', description: 'One available slot.', imageData, price: 100,
    dailyIncome: 1, durationDays: 1, purchaseBonus: 0, totalSlots: 1, status: 'Active', position: 2,
  };
  const created = await request('/api/admin/plans', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': adminToken }, body: JSON.stringify(product) });
  assert.equal(created.response.status, 201);
  const attempts = await Promise.all([
    request('/api/purchases', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId: product.name, idempotencyKey: 'single-slot-buyer-one' }) }, userCookie),
    request('/api/purchases', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId: product.name, idempotencyKey: 'single-slot-buyer-two' }) }, secondUserCookie),
  ]);
  assert.deepEqual(attempts.map((result) => result.response.status).sort(), [201, 400]);
  const database = new DatabaseSync(databasePath);
  try {
    assert.equal(database.prepare('SELECT sold_slots FROM plans WHERE name = ?').get(product.name).sold_slots, 1);
    assert.equal(database.prepare('SELECT count(*) AS count FROM product_purchases WHERE product_name = ?').get(product.name).count, 1);
  } finally { database.close(); }
});

test('daily product income starts after 24 hours, credits once per day, and stops at the product term', async () => {
  const buyer = await register('Daily Income Buyer', '0781234993');
  setBalance(buyer.user.id, 1000);
  const product = { name: 'Daily Income Product', description: '24-hour income test.', imageData, price: 100, dailyIncome: 10, durationDays: 3, purchaseBonus: 0, totalSlots: 2, status: 'Active', position: 4 };
  const created = await request('/api/admin/plans', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': adminToken }, body: JSON.stringify(product) });
  assert.equal(created.response.status, 201);
  const purchased = await request('/api/purchases', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId: product.name, idempotencyKey: 'daily-income-purchase-1' }) }, buyer.cookie);
  assert.equal(purchased.response.status, 201);
  assert.equal(purchased.body.balance.availableBalance, 900);

  const setPurchaseAge = (hours) => {
    const database = new DatabaseSync(databasePath);
    try { database.prepare("UPDATE product_purchases SET created_at = datetime('now', ?) WHERE id = ?").run(`-${hours} hours`, purchased.body.purchase.id); }
    finally { database.close(); }
  };
  const incomeCount = () => {
    const database = new DatabaseSync(databasePath);
    try { return database.prepare('SELECT count(*) AS count FROM product_income_ledger WHERE purchase_id = ?').get(purchased.body.purchase.id).count; }
    finally { database.close(); }
  };

  setPurchaseAge(23);
  assert.equal((await request('/api/wallet/balance', {}, buyer.cookie)).body.availableBalance, 900);
  assert.equal(incomeCount(), 0);
  const beforeDueProduct = (await request('/api/wallet/products', {}, buyer.cookie)).body.products[0];
  assert.equal(beforeDueProduct.dailyIncome, 10);
  assert.equal(beforeDueProduct.durationDays, 3);
  assert.equal(beforeDueProduct.incomePaidDays, 0);
  assert.ok(beforeDueProduct.nextIncomeAt);

  setPurchaseAge(25);
  assert.equal((await request('/api/wallet/balance', {}, buyer.cookie)).body.availableBalance, 910);
  assert.equal((await request('/api/wallet/balance', {}, buyer.cookie)).body.availableBalance, 910);
  assert.equal(incomeCount(), 1);
  const afterDueProduct = (await request('/api/wallet/products', {}, buyer.cookie)).body.products[0];
  assert.equal(afterDueProduct.incomePaidDays, 1);
  assert.ok(afterDueProduct.nextIncomeAt);
  setPurchaseAge(49);
  assert.equal((await request('/api/wallet/balance', {}, buyer.cookie)).body.availableBalance, 920);
  setPurchaseAge(96);
  assert.equal((await request('/api/wallet/balance', {}, buyer.cookie)).body.availableBalance, 930);
  assert.equal(incomeCount(), 3);
  const completedIncomeProduct = (await request('/api/wallet/products', {}, buyer.cookie)).body.products[0];
  assert.equal(completedIncomeProduct.incomePaidDays, 3);
  assert.equal(completedIncomeProduct.nextIncomeAt, null);
});
