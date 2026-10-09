import { createServer } from 'node:http';
import { randomUUID, randomBytes, randomInt, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { database } from './database.mjs';
import { convertLocalToRwf, convertRwfToLocal, normalizeCountryPhone, supportedCountries } from './currency.mjs';

const port = Number(process.env.API_PORT ?? 3001);
const adminToken = process.env.ADMIN_API_TOKEN;
const sessionLifetimeSeconds = 60 * 60 * 24 * 7;
const productIncomeIntervalMs = 60_000;
const methods = new Set(['MTN_MOMO', 'AIRTEL_MONEY']);
const statuses = new Set(['PENDING', 'APPROVED', 'AWAITING_PAYOUT', 'PROCESSING', 'SUCCESS', 'REJECTED', 'FAILED', 'CANCELLED']);
const maxDepositMethods = 4;
const maxScreenshotBytes = 4 * 1024 * 1024;
const maxLogoBytes = 128 * 1024;
const maxProductImageBytes = 4 * 1024 * 1024;
const userFeatures = ['dashboard', 'products', 'wallet', 'deposit', 'withdraw', 'myTeam', 'support', 'telegram', 'messages'];

function sendJson(response, status, body) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(body)); }
function now() { return new Date().toISOString(); }
function getAccountFor(userId) { return database.prepare('SELECT user_id AS userId, available_balance AS availableBalance, reserved_balance AS reservedBalance FROM wallet_accounts WHERE user_id = ?').get(userId); }
function countrySettingsForCode(countryCode) { return database.prepare('SELECT country_code AS countryCode, country_name AS countryName, phone_prefix AS phonePrefix, currency_code AS currencyCode, enabled, units_per_rwf AS unitsPerRwf FROM country_settings WHERE country_code = ?').get(countryCode) ?? null; }
function currencyForUser(userId) {
  const user = database.prepare('SELECT country_code AS countryCode, currency_code AS currencyCode FROM users WHERE id = ?').get(userId);
  const config = countrySettingsForCode(user?.countryCode ?? 'RW') ?? countrySettingsForCode('RW');
  const rateConfigured = Number(config?.unitsPerRwf) > 0;
  return { countryCode: user?.countryCode ?? 'RW', currencyCode: rateConfigured ? user?.currencyCode ?? config.currencyCode : 'RWF', unitsPerRwf: rateConfigured ? Number(config.unitsPerRwf) : 1, enabled: Boolean(config?.enabled), rateConfigured };
}
function localAmount(amountRwf, currency) { return convertRwfToLocal(amountRwf, currency.unitsPerRwf); }
function baseAmount(amountLocal, currency) { return convertLocalToRwf(amountLocal, currency.unitsPerRwf); }
function hasCompletedProductPurchase(userId) { return Boolean(database.prepare("SELECT 1 FROM product_purchases WHERE user_id = ? AND status = 'COMPLETED' LIMIT 1").get(userId)); }
function walletBalanceView(userId) {
  const account = getAccountFor(userId);
  const currency = currencyForUser(userId);
  const bonus = database.prepare('SELECT welcome_bonus_amount AS amount, welcome_bonus_awarded_at AS awardedAt, welcome_bonus_unlocked_at AS unlockedAt FROM users WHERE id = ?').get(userId);
  const amount = Number(bonus?.amount ?? 0);
  const hasCompletedPurchase = hasCompletedProductPurchase(userId);
  const lockedWelcomeBonus = amount > 0 && !hasCompletedPurchase ? amount : 0;
  const legacyBonusInBalance = !hasCompletedPurchase && bonus?.unlockedAt ? Math.min(amount, account?.availableBalance ?? 0) : 0;
  const availableBalance = Math.max(0, (account?.availableBalance ?? 0) - legacyBonusInBalance);
  return { ...account, availableBalance, lockedWelcomeBonus, welcomeBonusAmount: amount, welcomeBonusStatus: amount === 0 ? 'NONE' : lockedWelcomeBonus > 0 ? 'LOCKED' : 'UNLOCKED', welcomeBonusAwardedAt: bonus?.awardedAt ?? null, welcomeBonusUnlockedAt: hasCompletedPurchase ? bonus?.unlockedAt ?? null : null, ...currency, exchangeRate: currency.unitsPerRwf, displayAvailableBalance: localAmount(availableBalance, currency), displayReservedBalance: localAmount(account?.reservedBalance ?? 0, currency), displayLockedWelcomeBonus: localAmount(lockedWelcomeBonus, currency), displayWelcomeBonusAmount: localAmount(amount, currency) };
}
function amountOf(value) { const amount = Number(value); return Number.isSafeInteger(amount) && amount > 0 ? amount : null; }
function validPhone(phone, countryCode = 'RW') { return Boolean(normalizeCountryPhone(phone, countryCode)); }
function validMethod(method) { return methods.has(method); }
function methodEnabled(type, method, countryCode = null) { if (type === 'withdrawal') return Boolean(countryCode ? database.prepare('SELECT m.code FROM withdrawal_methods m JOIN country_withdrawal_methods c ON c.method_code = m.code WHERE m.code = ? AND m.enabled = 1 AND c.country_code = ? AND c.enabled = 1').get(method, countryCode) : database.prepare('SELECT m.code FROM withdrawal_methods m JOIN country_withdrawal_methods c ON c.method_code = m.code WHERE m.code = ? AND m.enabled = 1 AND c.enabled = 1').get(method)); return Boolean(database.prepare('SELECT code FROM deposit_methods WHERE code = ? AND enabled = 1 AND country_code = ?').get(method, countryCode ?? 'RW')); }
function mask(phone) { return `${phone.slice(0, 4)}****${phone.slice(-2)}`; }
function feeFor(amount) { const settings = platformSettings(); const configuredFee = !settings.withdrawalFeeEnabled ? 0 : settings.withdrawalFeeType === 'FIXED' ? settings.withdrawalFeeValue : Math.ceil(amount * settings.withdrawalFeeValue / 100); const withdrawalFee = Math.min(amount, Math.max(0, Math.floor(configuredFee))); return { withdrawalAmount: amount, withdrawalFee, amountReceived: amount - withdrawalFee }; }
function transactionView(row) { const currency = currencyForUser(row.user_id); const unitsPerRwf = Number(row.exchange_rate ?? currency.unitsPerRwf); const displayCurrencyCode = row.currency_code ?? currency.currencyCode; const displayAmount = row.display_amount || convertRwfToLocal(row.amount, unitsPerRwf); const displayFee = row.display_fee ?? convertRwfToLocal(row.withdrawal_fee, unitsPerRwf); const displayAmountReceived = row.display_amount_received ?? convertRwfToLocal(row.amount_received, unitsPerRwf); return { id: row.id, userId: row.user_id, type: row.type, amount: row.amount, withdrawalFee: row.withdrawal_fee, amountReceived: row.amount_received, displayAmount, displayFee, displayAmountReceived, countryCode: row.country_code ?? currency.countryCode, currencyCode: displayCurrencyCode, exchangeRate: unitsPerRwf, commissionAmount: row.commission_amount ?? 0, senderName: row.sender_name, receiverName: row.receiver_name, phoneNumber: mask(row.phone_number), paymentMethod: row.payment_method, depositMethodId: row.deposit_method_id ?? null, depositMethodName: row.deposit_method_name ?? null, depositReceivingCountryCode: row.deposit_receiving_country_code ?? null, depositReceivingCurrencyCode: row.deposit_receiving_currency_code ?? null, depositReceivingExchangeRate: row.deposit_receiving_exchange_rate ?? null, depositPaymentAmount: row.deposit_payment_amount ?? null, status: row.status, provider: row.provider, providerReference: row.provider_reference, internalReference: row.internal_reference, failureReason: row.failure_reason, rejectionReason: row.rejection_reason, approvedBy: row.approved_by, approvedAt: row.approved_at, rejectedBy: row.rejected_by, rejectedAt: row.rejected_at, createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at }; }
function audit(transactionId, actorId, action, oldStatus, newStatus, reason = null) { database.prepare('INSERT INTO wallet_audit_logs (id, transaction_id, actor_id, action, details) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), transactionId, actorId, action, JSON.stringify({ oldStatus, newStatus, reason, timestamp: now() })); }
async function readBody(request) { const chunks = []; let size = 0; for await (const chunk of request) { size += chunk.length; if (size > 8 * 1024 * 1024) { const error = new Error('Request body is too large.'); error.statusCode = 413; throw error; } chunks.push(chunk); } if (!chunks.length) return {}; try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('Request body must be valid JSON'); } }
function isAdmin(request) { return currentUser(request)?.role === 'ADMIN' || Boolean(adminToken && request.headers['x-admin-token'] === adminToken); }
function sessionCookie(request) { const pair = (request.headers.cookie ?? '').split(';').map((part) => part.trim()).find((part) => part.startsWith('rw_session=')); return pair?.slice('rw_session='.length) ?? ''; }
function tokenHash(token) { return createHash('sha256').update(token).digest('hex'); }
function userAccess(userId) {
  const controls = database.prepare('SELECT account_status AS accountStatus, allow_deposits AS allowDeposits, allow_withdrawals AS allowWithdrawals, deleted_at AS deletedAt FROM user_access_controls WHERE user_id = ?').get(userId);
  const permissions = Object.fromEntries(userFeatures.map((feature) => [feature, true]));
  for (const item of database.prepare('SELECT feature, enabled FROM user_permissions WHERE user_id = ?').all(userId)) permissions[item.feature] = Boolean(item.enabled);
  return { accountStatus: controls?.accountStatus ?? 'ACTIVE', allowDeposits: controls ? Boolean(controls.allowDeposits) : true, allowWithdrawals: controls ? Boolean(controls.allowWithdrawals) : true, deletedAt: controls?.deletedAt ?? null, permissions };
}
function currentUser(request) { const token = sessionCookie(request); if (!token) return null; const row = database.prepare('SELECT u.id, u.full_name AS fullName, u.phone_number AS phoneNumber, u.referral_code AS referralCode, u.role, u.country_code AS countryCode, u.currency_code AS currencyCode, u.welcome_bonus_amount AS welcomeBonusAmount, u.welcome_bonus_awarded_at AS welcomeBonusAwardedAt, u.welcome_bonus_unlocked_at AS welcomeBonusUnlockedAt FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?').get(tokenHash(token), now()); return row ? { ...row, ...userAccess(row.id), ...currencyForUser(row.id) } : null; }
function createSession(response, userId) { const token = randomBytes(32).toString('hex'); const expiresAt = new Date(Date.now() + sessionLifetimeSeconds * 1000).toISOString(); database.prepare('INSERT INTO auth_sessions (id, user_id, expires_at, token_hash, last_seen_at, current_page) VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), userId, expiresAt, tokenHash(token), now(), 'Other'); response.setHeader('Set-Cookie', `rw_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionLifetimeSeconds}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`); }
function clearSession(response) { response.setHeader('Set-Cookie', 'rw_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'); }
function passwordHash(password, salt = randomBytes(16).toString('hex')) { return { salt, hash: scryptSync(password, salt, 64).toString('hex') }; }
function passwordMatches(password, salt, hash) { const actual = scryptSync(password, salt, 64); const expected = Buffer.from(hash, 'hex'); return actual.length === expected.length && timingSafeEqual(actual, expected); }
function normalizedPhone(value, defaultCountryCode = 'RW') { return normalizeCountryPhone(value, defaultCountryCode)?.phoneNumber ?? ''; }
function publicUser(user) {
  const welcomeBonusAmount = user.welcomeBonusAmount ?? 0;
  const bonusUnlocked = welcomeBonusAmount > 0 && hasCompletedProductPurchase(user.id);
  const currency = currencyForUser(user.id);
  return { id: user.id, fullName: user.fullName, phoneNumber: user.phoneNumber, referralCode: user.referralCode, role: user.role, countryCode: user.countryCode ?? currency.countryCode, currencyCode: user.currencyCode ?? currency.currencyCode, exchangeRate: currency.unitsPerRwf, welcomeBonusAmount, displayWelcomeBonusAmount: localAmount(welcomeBonusAmount, currency), welcomeBonusAwardedAt: user.welcomeBonusAwardedAt ?? null, welcomeBonusUnlockedAt: bonusUnlocked ? user.welcomeBonusUnlockedAt ?? null : null, welcomeBonusStatus: welcomeBonusAmount === 0 ? 'NONE' : bonusUnlocked ? 'UNLOCKED' : 'LOCKED', accountStatus: user.accountStatus ?? 'ACTIVE', allowDeposits: user.allowDeposits ?? true, allowWithdrawals: user.allowWithdrawals ?? true, permissions: user.permissions ?? Object.fromEntries(userFeatures.map((feature) => [feature, true])) };
}
function auditAdmin(adminId, targetUserId, action, previousValue = null, newValue = null, metadata = null) { database.prepare('INSERT INTO admin_audit_log (id, admin_user_id, target_user_id, action, previous_value, new_value, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), adminId ?? null, targetUserId ?? null, action, previousValue === null ? null : JSON.stringify(previousValue), newValue === null ? null : JSON.stringify(newValue), metadata === null ? null : JSON.stringify(metadata)); }
function adminUser(request) { const user = currentUser(request); return user?.role === 'ADMIN' ? user : null; }
function saveUserControls(userId, adminId, controls, permissions, auditAction = 'USER_UPDATED') {
  const before = userAccess(userId);
  const status = ['ACTIVE', 'FROZEN', 'RESTRICTED', 'SUSPENDED'].includes(controls.accountStatus) ? controls.accountStatus : before.accountStatus;
  const allowDeposits = typeof controls.allowDeposits === 'boolean' ? controls.allowDeposits : before.allowDeposits;
  const allowWithdrawals = typeof controls.allowWithdrawals === 'boolean' ? controls.allowWithdrawals : before.allowWithdrawals;
  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare('INSERT INTO user_access_controls (user_id, account_status, allow_deposits, allow_withdrawals, deleted_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET account_status = excluded.account_status, allow_deposits = excluded.allow_deposits, allow_withdrawals = excluded.allow_withdrawals, deleted_at = excluded.deleted_at, updated_by = excluded.updated_by, updated_at = excluded.updated_at').run(userId, status, allowDeposits ? 1 : 0, allowWithdrawals ? 1 : 0, status === 'SUSPENDED' ? before.deletedAt ?? now() : null, adminId, now());
    const savePermission = database.prepare('INSERT INTO user_permissions (user_id, feature, enabled, updated_by, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, feature) DO UPDATE SET enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at');
    for (const [feature, enabled] of Object.entries(permissions ?? {})) if (userFeatures.includes(feature) && typeof enabled === 'boolean') savePermission.run(userId, feature, enabled ? 1 : 0, adminId, now());
    const after = userAccess(userId);
    if (before.accountStatus !== after.accountStatus) auditAdmin(adminId, userId, `USER_STATUS_${after.accountStatus}`, { accountStatus: before.accountStatus }, { accountStatus: after.accountStatus });
    if (before.allowWithdrawals !== after.allowWithdrawals) auditAdmin(adminId, userId, after.allowWithdrawals ? 'WITHDRAW_ENABLED' : 'WITHDRAW_DISABLED', { allowWithdrawals: before.allowWithdrawals }, { allowWithdrawals: after.allowWithdrawals });
    if (before.allowDeposits !== after.allowDeposits) auditAdmin(adminId, userId, after.allowDeposits ? 'DEPOSIT_ENABLED' : 'DEPOSIT_DISABLED', { allowDeposits: before.allowDeposits }, { allowDeposits: after.allowDeposits });
    for (const [feature, enabled] of Object.entries(permissions ?? {})) if (userFeatures.includes(feature) && typeof enabled === 'boolean' && before.permissions[feature] !== enabled) auditAdmin(adminId, userId, 'PERMISSION_CHANGED', { feature, enabled: before.permissions[feature] }, { feature, enabled });
    if (status === before.accountStatus && allowDeposits === before.allowDeposits && allowWithdrawals === before.allowWithdrawals && !Object.keys(permissions ?? {}).length) auditAdmin(adminId, userId, auditAction, null, null);
    database.exec('COMMIT');
    return after;
  } catch (error) { database.exec('ROLLBACK'); throw error; }
}
function permanentlyDeleteUsers(userIds) {
  const targets = [...new Set(userIds)];
  database.exec('BEGIN IMMEDIATE');
  try {
    for (const userId of targets) {
      const completedPurchases = database.prepare("SELECT coalesce(product_id, product_name) AS productId, count(*) AS count FROM product_purchases WHERE user_id = ? AND status = 'COMPLETED' GROUP BY coalesce(product_id, product_name)").all(userId);
      for (const purchase of completedPurchases) database.prepare('UPDATE plans SET sold_slots = max(0, sold_slots - ?) WHERE name = ?').run(purchase.count, purchase.productId);

      database.prepare('UPDATE users SET referred_by = NULL WHERE referred_by = ?').run(userId);
      database.prepare('DELETE FROM user_message_reads WHERE user_id = ? OR message_id IN (SELECT id FROM user_messages WHERE sender_user_id = ? OR recipient_user_id = ?)').run(userId, userId, userId);
      database.prepare('DELETE FROM user_messages WHERE sender_user_id = ? OR recipient_user_id = ?').run(userId, userId);
      database.prepare('DELETE FROM support_messages WHERE author_id = ? OR conversation_id IN (SELECT id FROM support_conversations WHERE user_id = ?)').run(userId, userId);
      database.prepare('DELETE FROM support_conversations WHERE user_id = ?').run(userId);
      database.prepare('DELETE FROM referral_relationships WHERE user_id = ? OR sponsor_user_id = ?').run(userId, userId);
      database.prepare("UPDATE commission_ledger SET source_user_id = 'DELETED_USER' WHERE source_user_id = ?").run(userId);
      database.prepare('DELETE FROM commission_ledger WHERE beneficiary_user_id = ?').run(userId);
      database.prepare('DELETE FROM admin_audit_log WHERE target_user_id = ? OR admin_user_id = ?').run(userId, userId);
      database.prepare('DELETE FROM wallet_audit_logs WHERE actor_id = ? OR transaction_id IN (SELECT id FROM wallet_transactions WHERE user_id = ?)').run(userId, userId);
      database.prepare('DELETE FROM wallet_transactions WHERE user_id = ?').run(userId);
      database.prepare('DELETE FROM product_purchases WHERE user_id = ?').run(userId);
      database.prepare('DELETE FROM wallet_accounts WHERE user_id = ?').run(userId);
      database.prepare('DELETE FROM users WHERE id = ?').run(userId);
    }
    database.exec('COMMIT');
    return targets.length;
  } catch (error) { database.exec('ROLLBACK'); throw error; }
}
function featureForPath(path, method) {
  if (path.startsWith('/api/admin/')) return null;
  if (path.startsWith('/api/auth/') || path === '/api/health') return null;
  if (path === '/api/dashboard') return null;
  if (path.startsWith('/api/user/messages')) return 'messages';
  if (path === '/api/team' || path.startsWith('/api/team/')) return 'myTeam';
  if (path.startsWith('/api/support/')) return 'support';
  if (path.startsWith('/api/wallet/withdraw') || path === '/api/withdrawals' || path === '/api/withdrawals/preview') return 'withdraw';
  if (path.startsWith('/api/wallet/deposit') || path === '/api/deposits' || path === '/api/deposit-methods') return 'deposit';
  if (path === '/api/wallet/products' || path === '/api/purchases') return 'products';
  if (path.startsWith('/api/wallet/')) return 'wallet';
  return null;
}
function newReferralCode() { let code; do { code = randomBytes(5).toString('hex').toUpperCase(); } while (database.prepare('SELECT id FROM users WHERE referral_code = ?').get(code)); return code; }
function setting(key) { return database.prepare('SELECT value FROM support_settings WHERE key = ?').get(key)?.value ?? ''; }
function platformSettings() {
  const read = (key) => database.prepare('SELECT value FROM support_settings WHERE key = ?').get(key)?.value;
  const legacyPercent = Math.max(0, Number(process.env.WITHDRAWAL_FEE_PERCENT ?? 0));
  const legacyFixed = Math.max(0, Math.floor(Number(process.env.WITHDRAWAL_FIXED_FEE ?? 0)));
  const storedType = read('withdrawal_fee_type');
  const withdrawalFeeType = storedType === 'FIXED' ? 'FIXED' : 'PERCENTAGE';
  const storedFeeValue = read('withdrawal_fee_value');
  return {
    withdrawalFeeEnabled: read('withdrawal_fee_enabled') === undefined ? legacyPercent > 0 || legacyFixed > 0 : read('withdrawal_fee_enabled') === '1',
    withdrawalFeeType,
    withdrawalFeeValue: storedFeeValue === undefined ? (withdrawalFeeType === 'FIXED' ? legacyFixed : legacyPercent) : Number(storedFeeValue),
    welcomeBonusEnabled: read('welcome_bonus_enabled') === '1',
    welcomeBonusAmount: Number(read('welcome_bonus_amount') ?? 0),
  };
}
function referralChain(userId) { const chain = []; let current = userId; for (let level = 1; level <= 3; level += 1) { const row = database.prepare('SELECT sponsor_user_id AS sponsorUserId FROM referral_relationships WHERE user_id = ?').get(current); if (!row) break; chain.push({ level, userId: row.sponsorUserId }); current = row.sponsorUserId; } return chain; }
function createCommissions(purchase) { const chain = referralChain(purchase.user_id); for (const item of chain) { const percentage = database.prepare('SELECT percentage FROM referral_settings WHERE level = ?').get(item.level)?.percentage ?? 0; const commission = Math.floor(purchase.qualifying_amount * percentage / 100); const timestamp = now(); const result = database.prepare('INSERT OR IGNORE INTO commission_ledger (id, beneficiary_user_id, source_user_id, product_id, purchase_id, referral_level, percentage, qualifying_amount, commission_amount, status, reference, approved_at, credited_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), item.userId, purchase.user_id, purchase.product_name, purchase.id, item.level, percentage, purchase.qualifying_amount, commission, 'APPROVED', `COM-${purchase.id}-${item.userId}-${item.level}`, timestamp, timestamp); if (result.changes && commission > 0) database.prepare('UPDATE wallet_accounts SET available_balance = available_balance + ?, updated_at = ? WHERE user_id = ?').run(commission, timestamp, item.userId); } }
function unlockWelcomeBonus(userId) {
  const bonus = database.prepare('SELECT welcome_bonus_amount AS amount FROM users WHERE id = ? AND welcome_bonus_awarded_at IS NOT NULL AND welcome_bonus_unlocked_at IS NULL').get(userId);
  if (!bonus || bonus.amount <= 0) return false;
  const timestamp = now();
  const result = database.prepare('UPDATE users SET welcome_bonus_unlocked_at = ? WHERE id = ? AND welcome_bonus_unlocked_at IS NULL AND welcome_bonus_awarded_at IS NOT NULL').run(timestamp, userId);
  if (!result.changes) return false;
  database.prepare('UPDATE wallet_accounts SET available_balance = available_balance + ?, updated_at = ? WHERE user_id = ?').run(bonus.amount, timestamp, userId);
  return true;
}
function settleDueProductIncome() {
  const timestamp = now();
  database.exec('BEGIN IMMEDIATE');
  try {
    const duePurchases = database.prepare(`SELECT purchaseId, userId, dailyIncome, durationDays, dueDays, paidDays FROM (
      SELECT p.id AS purchaseId, p.user_id AS userId, p.daily_income_snapshot AS dailyIncome, p.duration_days_snapshot AS durationDays,
        CAST(julianday(?) - julianday(coalesce(p.approved_at, p.created_at)) AS INTEGER) AS dueDays,
        count(i.income_day) AS paidDays
      FROM product_purchases p LEFT JOIN product_income_ledger i ON i.purchase_id = p.id
      WHERE p.status = 'COMPLETED' AND p.daily_income_snapshot > 0 AND p.duration_days_snapshot > 0
      GROUP BY p.id
    ) WHERE dueDays > paidDays`).all(timestamp);
    const addIncome = database.prepare('INSERT OR IGNORE INTO product_income_ledger (id, purchase_id, user_id, income_day, amount, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    const creditWallet = database.prepare('UPDATE wallet_accounts SET available_balance = available_balance + ?, updated_at = ? WHERE user_id = ?');
    for (const purchase of duePurchases) {
      const finalDay = Math.min(purchase.dueDays, purchase.durationDays);
      for (let incomeDay = purchase.paidDays + 1; incomeDay <= finalDay; incomeDay += 1) {
        const inserted = addIncome.run(randomUUID(), purchase.purchaseId, purchase.userId, incomeDay, purchase.dailyIncome, timestamp);
        if (inserted.changes) creditWallet.run(purchase.dailyIncome, timestamp, purchase.userId);
      }
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
function fields(input, party) { const amount = amountOf(input.amount); const phoneNumber = String(input.phoneNumber ?? '').replace(/[\s-]/g, ''); const paymentMethod = input.paymentMethod; const name = String(input[party] ?? '').trim().slice(0, 120); return { amount, phoneNumber, paymentMethod, name, valid: Boolean(amount && validPhone(phoneNumber) && validMethod(paymentMethod) && name) }; }
function withdrawalAccountFor(userId) { return database.prepare('SELECT account_holder_name AS accountHolderName, phone_number AS phoneNumber, payment_method AS paymentMethod, created_at AS createdAt, updated_at AS updatedAt FROM withdrawal_accounts WHERE user_id = ?').get(userId) ?? null; }
function boundWithdrawalFields(input, userId, currency = currencyForUser(userId)) { const displayAmount = amountOf(input.amount); const amount = displayAmount ? baseAmount(displayAmount, currency) : null; const account = withdrawalAccountFor(userId); return { amount, displayAmount, account, valid: Boolean(amount && account && validPhone(account.phoneNumber, currency.countryCode) && validMethod(account.paymentMethod)) }; }
function imageDataValid(value, maxBytes) { if (typeof value !== 'string') return false; const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/); if (!match) return false; return Buffer.from(match[2], 'base64').byteLength <= maxBytes; }
function depositMethodView(row, currency = null) { const countryCode = row.country_code ?? 'RW'; const receivingCountryCode = row.receiving_country_code ?? countryCode; const receivingCurrency = countrySettingsForCode(receivingCountryCode); const currencyCode = currency?.currencyCode ?? 'RWF'; return { id: row.code, name: row.name, accountName: row.account_name, accountNumber: row.account_number, instructions: row.instructions, ussdTemplate: row.ussd_template ?? '', minimumAmount: currency ? localAmount(row.minimum_amount, currency) : row.minimum_amount, maximumAmount: currency ? localAmount(row.maximum_amount, currency) : row.maximum_amount, countryCode, currencyCode, customerUnitsPerRwf: Number(currency?.unitsPerRwf ?? 1), crossBorderEnabled: Boolean(row.cross_border_enabled), receivingCountryCode, receivingCurrencyCode: receivingCurrency?.currencyCode ?? currencyCode, receivingUnitsPerRwf: Number(receivingCurrency?.unitsPerRwf ?? currency?.unitsPerRwf ?? 1), logoData: row.logo_data, enabled: Boolean(row.enabled), position: row.position }; }
function parseDepositMethod(input) {
  const name = String(input.name ?? '').trim().slice(0, 80);
  const accountName = String(input.accountName ?? '').trim().slice(0, 120);
  const accountNumber = String(input.accountNumber ?? '').trim().slice(0, 80);
  const instructions = String(input.instructions ?? '').trim().slice(0, 1000);
  let ussdTemplate = String(input.ussdTemplate ?? '').trim().slice(0, 160);
  const minimumAmount = Number(input.minimumAmount);
  const maximumAmount = Number(input.maximumAmount);
  const enabled = Boolean(input.enabled);
  const countryCode = ['RW', 'BI', 'UG'].includes(input.countryCode) ? input.countryCode : 'RW';
  const crossBorderEnabled = input.crossBorderEnabled === true;
  const receivingCountryCode = crossBorderEnabled && ['RW', 'BI', 'UG'].includes(input.receivingCountryCode) ? input.receivingCountryCode : countryCode;
  const receivingCountry = countrySettingsForCode(receivingCountryCode);
  const logoData = input.logoData ? String(input.logoData) : null;
  if (accountNumber && ussdTemplate.includes(accountNumber)) ussdTemplate = ussdTemplate.replace(accountNumber, '{number}');
  if (minimumAmount > 0) {
    const literalMinimum = new RegExp(`(?<!\\d)${minimumAmount}(?!\\d)`);
    ussdTemplate = ussdTemplate.replace(literalMinimum, '{amount}');
  }
  if (!name || !Number.isSafeInteger(minimumAmount) || minimumAmount < 0 || !Number.isSafeInteger(maximumAmount) || maximumAmount <= 0 || minimumAmount > maximumAmount) return { error: 'Enter a name and valid minimum and maximum deposit amounts.' };
  if (enabled && (!accountName || !accountNumber)) return { error: 'Add an account/merchant name and number before activating this method.' };
  if (crossBorderEnabled && !['RW', 'BI', 'UG'].includes(input.receivingCountryCode)) return { error: 'Choose a supported receiving country for cross-border deposits.' };
  if (crossBorderEnabled && (!receivingCountry || Number(receivingCountry.unitsPerRwf) <= 0)) return { error: 'Configure a positive receiving-country exchange rate before enabling cross-border deposits.' };
  if (ussdTemplate && (!/(?:\{\{?\s*number\s*\}\}?|\bnumber\b)/i.test(ussdTemplate) || !/^[0-9*#+\s{}A-Za-z_-]+$/.test(ussdTemplate))) return { error: 'USSD template must include the number placeholder and contain only USSD digits, symbols, and placeholders.' };
  if (logoData && !imageDataValid(logoData, maxLogoBytes)) return { error: 'Logo must be a PNG, JPEG, or WebP image under 128 KB.' };
  return { value: { name, accountName, accountNumber, instructions, ussdTemplate, minimumAmount, maximumAmount, enabled: enabled ? 1 : 0, countryCode, crossBorderEnabled: crossBorderEnabled ? 1 : 0, receivingCountryCode, logoData, position: Number.isSafeInteger(Number(input.position)) ? Number(input.position) : 0 } };
}
function parsePlan(input) {
  const name = String(input.name ?? '').trim().slice(0, 100);
  const description = String(input.description ?? '').trim().slice(0, 2000);
  const imageData = input.imageData;
  const price = Number(input.price);
  const dailyIncome = Number(input.dailyIncome);
  const durationDays = Number(input.durationDays);
  const purchaseBonus = 0;
  const totalSlots = Number(input.totalSlots);
  const status = input.status === 'Ending soon' ? 'Ending soon' : 'Active';
  const position = Number.isSafeInteger(Number(input.position)) ? Number(input.position) : 0;
  if (!name || !description || !Number.isSafeInteger(price) || price <= 0 || !Number.isSafeInteger(dailyIncome) || dailyIncome < 0 || !Number.isSafeInteger(durationDays) || durationDays <= 0 || !Number.isSafeInteger(totalSlots) || totalSlots <= 0) return { error: 'Enter a name, description, positive price and duration, non-negative income, and at least one slot.' };
  if (!imageDataValid(imageData, maxProductImageBytes)) return { error: 'Upload a PNG, JPEG, or WebP product image no larger than 4 MB.' };
  return { value: { name, description, imageData, price, dailyIncome, durationDays, purchaseBonus, totalSlots, status, position } };
}
function planView(row) {
  const soldSlots = Number(row.sold_slots ?? 0);
  const totalSlots = Number(row.total_slots ?? 0);
  const remainingSlots = Math.max(0, totalSlots - soldSlots);
  const durationDays = Number(row.duration_days ?? 0);
  const dailyIncome = Number(row.daily_income ?? 0);
  const totalIncome = dailyIncome * durationDays;
  return {
    id: row.name,
    name: row.name,
    description: row.description ?? row.note,
    imageData: row.image_data ?? null,
    price: Number(row.price ?? 0),
    deposited: row.deposited,
    dailyIncome,
    incomePerDay: dailyIncome,
    totalIncome,
    durationDays,
    termDays: durationDays,
    term: `${durationDays} days`,
    purchaseBonus: 0,
    totalSlots,
    soldSlots,
    remainingSlots,
    progressPercent: totalSlots ? Math.min(100, Math.floor((soldSlots / totalSlots) * 100)) : 0,
    soldOut: totalSlots > 0 && soldSlots >= totalSlots,
    status: row.status,
    note: row.description ?? row.note,
    position: row.position,
  };
}
function localizedPlanView(row, currency) {
  const plan = planView(row);
  return { ...plan, displayPrice: localAmount(plan.price, currency), displayDailyIncome: localAmount(plan.dailyIncome, currency), displayTotalIncome: localAmount(plan.totalIncome, currency), currencyCode: currency.currencyCode, countryCode: currency.countryCode };
}
function currentPageForPath(path) {
  const pages = new Map([
    ['/', 'Home'], ['/plans', 'Products'], ['/wallet', 'My Wallet'], ['/deposit', 'Deposit'],
    ['/withdraw', 'Withdraw'], ['/team', 'My Team'], ['/invite', 'Promotion'], ['/support', 'Support'],
    ['/messages', 'Messages'], ['/me', 'Profile'], ['/admin/settings', 'Settings'],
  ]);
  return pages.get(path) ?? 'Other';
}
function referralEdgesCte() {
  return `WITH RECURSIVE referral_edges(user_id, sponsor_user_id, created_at) AS (
    SELECT user_id, sponsor_user_id, created_at FROM referral_relationships
    UNION ALL
    SELECT u.id, u.referred_by, u.created_at FROM users u
    WHERE u.referred_by IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM referral_relationships r WHERE r.user_id = u.id)
  )`;
}
function teamCte() {
  return `${referralEdgesCte()}, team(user_id, level) AS (
    SELECT user_id, 1 FROM referral_edges WHERE sponsor_user_id = ?
    UNION ALL
    SELECT edge.user_id, team.level + 1 FROM referral_edges edge
    JOIN team ON edge.sponsor_user_id = team.user_id
    WHERE team.level < 3
  )`;
}
function teamMemberStatsSql() {
  return `SELECT u.id AS userId, u.full_name AS fullName, u.phone_number AS phoneNumber,
    u.role, u.created_at AS createdAt, team.level,
    (SELECT count(*) FROM product_purchases p WHERE p.user_id = u.id AND p.status = 'COMPLETED') AS productsPurchased,
    (SELECT coalesce(sum(t.amount), 0) FROM wallet_transactions t WHERE t.user_id = u.id AND t.type = 'DEPOSIT' AND t.status = 'SUCCESS') AS totalDeposit,
    (SELECT coalesce(sum(t.amount), 0) FROM wallet_transactions t WHERE t.user_id = u.id AND t.type = 'WITHDRAWAL' AND t.status IN ('APPROVED', 'AWAITING_PAYOUT', 'PROCESSING', 'SUCCESS')) AS totalWithdrawal,
    coalesce(w.available_balance, 0) AS currentBalance,
    (SELECT max(s.last_seen_at) FROM auth_sessions s WHERE s.user_id = u.id) AS lastActive,
    (SELECT CASE WHEN julianday(s.last_seen_at) >= julianday('now', '-60 seconds') THEN s.current_page ELSE NULL END FROM auth_sessions s WHERE s.user_id = u.id ORDER BY s.last_seen_at DESC LIMIT 1) AS currentPage,
    (SELECT s.created_at FROM auth_sessions s WHERE s.user_id = u.id ORDER BY s.last_seen_at DESC LIMIT 1) AS loginAt
    FROM team JOIN users u ON u.id = team.user_id
    LEFT JOIN wallet_accounts w ON w.user_id = u.id`;
}
function completeDeposit(id, adminId, approve, reason) { const timestamp = now(); database.exec('BEGIN IMMEDIATE'); try { const row = database.prepare('SELECT * FROM wallet_transactions WHERE id = ? AND type = ?').get(id, 'DEPOSIT'); if (!row || row.status !== 'PENDING') { database.exec('ROLLBACK'); return row; } const nextStatus = approve ? 'SUCCESS' : 'REJECTED'; database.prepare('UPDATE wallet_transactions SET status = ?, approved_by = ?, approved_at = ?, rejected_by = ?, rejected_at = ?, rejection_reason = ?, updated_at = ?, completed_at = ? WHERE id = ? AND status = ?').run(nextStatus, approve ? adminId : null, approve ? timestamp : null, approve ? null : adminId, approve ? null : timestamp, approve ? null : reason, timestamp, timestamp, id, 'PENDING'); if (approve) database.prepare('UPDATE wallet_accounts SET available_balance = available_balance + ?, updated_at = ? WHERE user_id = ?').run(row.amount, timestamp, row.user_id); audit(id, adminId, approve ? 'DEPOSIT_APPROVED' : 'DEPOSIT_REJECTED', 'PENDING', nextStatus, reason); database.exec('COMMIT'); return database.prepare('SELECT * FROM wallet_transactions WHERE id = ?').get(id); } catch (error) { database.exec('ROLLBACK'); throw error; } }
function reviewWithdrawal(id, adminId, approve, reason) { const timestamp = now(); database.exec('BEGIN IMMEDIATE'); try { const row = database.prepare('SELECT * FROM wallet_transactions WHERE id = ? AND type = ?').get(id, 'WITHDRAWAL'); if (!row || row.status !== 'PENDING') { database.exec('ROLLBACK'); return row; } const reserved = row.reserved_amount || row.amount + row.withdrawal_fee; const nextStatus = approve ? 'AWAITING_PAYOUT' : 'REJECTED'; database.prepare('UPDATE wallet_transactions SET status = ?, approved_by = ?, approved_at = ?, rejected_by = ?, rejected_at = ?, rejection_reason = ?, updated_at = ? WHERE id = ? AND status = ?').run(nextStatus, approve ? adminId : null, approve ? timestamp : null, approve ? null : adminId, approve ? null : timestamp, approve ? null : reason, timestamp, id, 'PENDING'); if (!approve) database.prepare('UPDATE wallet_accounts SET reserved_balance = reserved_balance - ?, available_balance = available_balance + ?, updated_at = ? WHERE user_id = ? AND reserved_balance >= ?').run(reserved, reserved, timestamp, row.user_id, reserved); audit(id, adminId, approve ? 'WITHDRAWAL_APPROVED' : 'WITHDRAWAL_REJECTED', 'PENDING', nextStatus, reason); database.exec('COMMIT'); return database.prepare('SELECT * FROM wallet_transactions WHERE id = ?').get(id); } catch (error) { database.exec('ROLLBACK'); throw error; } }

async function handle(request, response) {
  const requestedPath = new URL(request.url ?? '/', 'http://localhost').pathname;
  const path = requestedPath === '/api/deposits' ? '/api/wallet/deposit' : requestedPath === '/api/withdrawals/preview' ? '/api/wallet/withdraw/preview' : requestedPath === '/api/withdrawals' ? '/api/wallet/withdraw' : requestedPath;
  const method = request.method ?? 'GET';
  if (method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  if (path === '/api/health' && method === 'GET') { database.prepare('SELECT 1').get(); sendJson(response, 200, { status: 'ok', workflow: 'admin-review' }); return; }
  if (path === '/api/auth/register' && method === 'POST') {
    const input = await readBody(request);
    const fullName = String(input.fullName ?? '').trim();
    const requestedCountryCode = String(input.countryCode ?? '').trim().toUpperCase();
    const phone = normalizeCountryPhone(input.phoneNumber, supportedCountries.some((country) => country.countryCode === requestedCountryCode) ? requestedCountryCode : 'RW');
    const phoneNumber = phone?.phoneNumber ?? '';
    const country = phone ? countrySettingsForCode(phone.countryCode) : null;
    const password = String(input.password ?? '');
    const referralCode = String(input.referralCode ?? '').trim().toUpperCase();
    if (fullName.length < 2 || fullName.length > 100) { sendJson(response, 400, { error: 'Full name must be between 2 and 100 characters.' }); return; }
    if (!phoneNumber || !phone || input.countryCode && (!supportedCountries.some((country) => country.countryCode === requestedCountryCode) || phone.countryCode !== requestedCountryCode)) { sendJson(response, 400, { error: 'Enter a valid phone number for the selected country.' }); return; }
    if (!country?.enabled || country.unitsPerRwf <= 0) { sendJson(response, 403, { error: 'Registration is currently unavailable for this country. Contact support.', code: 'COUNTRY_DISABLED', countryCode: phone.countryCode }); return; }
    if (!/^\d{6}$/.test(password)) { sendJson(response, 400, { error: 'Password must contain exactly 6 digits.' }); return; }
    if (database.prepare('SELECT id FROM users WHERE phone_number = ?').get(phoneNumber)) { sendJson(response, 409, { error: 'An account with this phone number already exists.' }); return; }
    const sponsor = referralCode ? database.prepare('SELECT id FROM users WHERE referral_code = ?').get(referralCode) : null;
    if (referralCode && !sponsor) { sendJson(response, 400, { error: 'Referral code is invalid.' }); return; }
    const id = randomUUID(); const code = newReferralCode(); const credential = passwordHash(password);
    database.exec('BEGIN IMMEDIATE');
    try {
      database.prepare('INSERT INTO users (id, full_name, phone_number, password_hash, referral_code, referred_by, country_code, currency_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, fullName, phoneNumber, `${credential.salt}:${credential.hash}`, code, sponsor?.id ?? null, phone.countryCode, phone.currencyCode);
      database.prepare('INSERT INTO wallet_accounts (user_id) VALUES (?)').run(id);
      const bonusSettings = platformSettings();
      if (bonusSettings.welcomeBonusEnabled && bonusSettings.welcomeBonusAmount > 0) {
        const awardedAt = now();
        database.prepare('UPDATE users SET welcome_bonus_amount = ?, welcome_bonus_awarded_at = ? WHERE id = ? AND welcome_bonus_awarded_at IS NULL AND welcome_bonus_amount = 0').run(bonusSettings.welcomeBonusAmount, awardedAt, id);
      }
      if (sponsor) database.prepare('INSERT INTO referral_relationships (user_id, sponsor_user_id) VALUES (?, ?)').run(id, sponsor.id);
      database.exec('COMMIT');
    } catch (error) { database.exec('ROLLBACK'); if (database.prepare('SELECT id FROM users WHERE phone_number = ?').get(phoneNumber)) { sendJson(response, 409, { error: 'An account with this phone number already exists.' }); return; } throw error; }
    createSession(response, id);
    const user = database.prepare('SELECT id, full_name AS fullName, phone_number AS phoneNumber, referral_code AS referralCode, role, welcome_bonus_amount AS welcomeBonusAmount, welcome_bonus_awarded_at AS welcomeBonusAwardedAt, welcome_bonus_unlocked_at AS welcomeBonusUnlockedAt FROM users WHERE id = ?').get(id);
    sendJson(response, 201, { user: publicUser({ ...user, ...userAccess(id) }) }); return;
  }
  if (path === '/api/auth/login' && method === 'POST') {
    const input = await readBody(request); const requestedCountryCode = String(input.countryCode ?? '').trim().toUpperCase(); const phone = normalizeCountryPhone(input.phoneNumber, supportedCountries.some((country) => country.countryCode === requestedCountryCode) ? requestedCountryCode : 'RW'); const phoneNumber = phone?.phoneNumber ?? ''; const password = String(input.password ?? '');
    if (input.countryCode && (!supportedCountries.some((country) => country.countryCode === requestedCountryCode) || phone?.countryCode !== requestedCountryCode)) { sendJson(response, 400, { error: 'Enter a valid phone number for the selected country.' }); return; }
    if (!phoneNumber || !/^\d{6}$/.test(password)) { sendJson(response, 400, { error: 'Enter a valid phone number and 6-digit password.' }); return; }
    const row = database.prepare('SELECT id, full_name AS fullName, phone_number AS phoneNumber, password_hash AS passwordHash, referral_code AS referralCode, role, welcome_bonus_amount AS welcomeBonusAmount, welcome_bonus_awarded_at AS welcomeBonusAwardedAt, welcome_bonus_unlocked_at AS welcomeBonusUnlockedAt FROM users WHERE phone_number = ?').get(phoneNumber);
    const [salt, hash] = (row?.passwordHash ?? ':').split(':');
    if (!row || !salt || !hash || !passwordMatches(password, salt, hash)) { sendJson(response, 401, { error: 'Phone number or password is incorrect.' }); return; }
    createSession(response, row.id); sendJson(response, 200, { user: publicUser({ ...row, ...userAccess(row.id) }) }); return;
  }
  if (path === '/api/auth/logout' && method === 'POST') { const token = sessionCookie(request); if (token) database.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(tokenHash(token)); clearSession(response); sendJson(response, 200, { ok: true }); return; }
  if (path === '/api/auth/me' && method === 'GET') { const user = currentUser(request); sendJson(response, 200, { user: user ? publicUser(user) : null }); return; }
  if (path === '/api/public/countries' && method === 'GET') {
    const mode = new URL(request.url ?? '/', 'http://localhost').searchParams.get('mode');
    const existingCountries = mode === 'login' ? new Set(database.prepare('SELECT DISTINCT u.country_code AS countryCode FROM users u LEFT JOIN user_access_controls controls ON controls.user_id = u.id WHERE controls.deleted_at IS NULL').all().map((row) => row.countryCode)) : new Set();
    const countries = supportedCountries.map((country) => ({ ...country, enabled: Boolean(countrySettingsForCode(country.countryCode)?.enabled) }))
      .filter((country) => country.enabled && Number(countrySettingsForCode(country.countryCode)?.unitsPerRwf) > 0 || existingCountries.has(country.countryCode));
    sendJson(response, 200, { countries }); return;
  }
  if (path === '/api/admin/daily-checkin' && method === 'GET') {
    if (!isAdmin(request)) { sendJson(response, 401, { error: 'Admin authentication required.' }); return; }
    sendJson(response, 200, { enabled: setting('daily_checkin_enabled') === '1', rewardAmount: Number(setting('daily_checkin_reward_amount')) || 0 }); return;
  }
  if (path === '/api/admin/daily-checkin' && method === 'PUT') {
    if (!isAdmin(request)) { sendJson(response, 401, { error: 'Admin authentication required.' }); return; }
    const input = await readBody(request);
    const enabled = input.enabled === true;
    const rewardAmount = Number(input.rewardAmount);
    if (!Number.isSafeInteger(rewardAmount) || rewardAmount < 0 || enabled && rewardAmount <= 0) { sendJson(response, 400, { error: 'Enter a whole-number reward above zero to enable daily check-in.' }); return; }
    database.prepare('INSERT INTO support_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').run('daily_checkin_enabled', enabled ? '1' : '0', now());
    database.prepare('INSERT INTO support_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').run('daily_checkin_reward_amount', String(rewardAmount), now());
    sendJson(response, 200, { enabled, rewardAmount }); return;
  }
  if (path === '/api/admin/members/role' && method === 'PUT') {
    if (!adminToken || request.headers['x-admin-token'] !== adminToken) { sendJson(response, 401, { error: 'Bootstrap admin token required.' }); return; }
    const input = await readBody(request);
    const phoneNumber = normalizedPhone(input.phoneNumber);
    if (!phoneNumber) { sendJson(response, 400, { error: 'Enter a valid Rwanda phone number.' }); return; }
    const result = database.prepare('UPDATE users SET role = ?, updated_at = ? WHERE phone_number = ?').run(input.role === 'ADMIN' ? 'ADMIN' : 'USER', now(), phoneNumber);
    if (!result.changes) { sendJson(response, 404, { error: 'No account exists for that phone number.' }); return; }
    sendJson(response, 200, { updated: true, role: input.role === 'ADMIN' ? 'ADMIN' : 'USER' }); return;
  }
  const user = path.startsWith('/api/admin/') ? null : currentUser(request);
  if (path.startsWith('/api/') && !path.startsWith('/api/admin/') && !user) { sendJson(response, 401, { error: 'Authentication required.' }); return; }
  if (path === '/api/presence' && method === 'POST') {
    const page = currentPageForPath(String((await readBody(request)).path ?? ''));
    const result = database.prepare('UPDATE auth_sessions SET last_seen_at = ?, current_page = ? WHERE token_hash = ? AND user_id = ? AND expires_at > ?').run(now(), page, tokenHash(sessionCookie(request)), user.id, now());
    if (!result.changes) { sendJson(response, 401, { error: 'Authentication required.' }); return; }
    sendJson(response, 200, { ok: true }); return;
  }
  if (user) {
    const feature = featureForPath(path, method);
    const country = countrySettingsForCode(user.countryCode);
    if ((!country?.enabled || country.unitsPerRwf <= 0) && (feature === 'deposit' || feature === 'withdraw' || path === '/api/purchases')) { sendJson(response, 403, { error: 'Payments are disabled for this country. Contact support.', code: 'COUNTRY_DISABLED', countryCode: user.countryCode }); return; }
    const isUserMessages = path.startsWith('/api/user/messages');
    if (user.accountStatus === 'FROZEN' || user.accountStatus === 'SUSPENDED') {
      if (!(user.accountStatus === 'FROZEN' && isUserMessages) && path !== '/api/user/account-state') { sendJson(response, 403, { error: user.accountStatus === 'FROZEN' ? 'Your account is frozen. Contact support for assistance.' : 'Your account is suspended. Contact support for assistance.', code: `ACCOUNT_${user.accountStatus}` }); return; }
    }
    if (user.accountStatus === 'RESTRICTED' && (feature === 'deposit' || feature === 'withdraw')) { sendJson(response, 403, { error: 'Deposits and withdrawals are restricted on this account. Contact support.', code: 'ACCOUNT_RESTRICTED' }); return; }
    if ((path === '/api/wallet/withdraw/preview' || path === '/api/wallet/withdraw') && method === 'POST') { const account = withdrawalAccountFor(user.id); if (account && !methodEnabled('withdrawal', account.paymentMethod, user.countryCode)) { sendJson(response, 403, { error: 'This withdrawal method is not enabled for your country.', code: 'COUNTRY_PAYMENT_METHOD_DISABLED' }); return; } }
    if (feature && !user.permissions[feature]) { sendJson(response, 403, { error: `Access to ${feature} is disabled for this account. Contact support.`, code: 'FEATURE_DISABLED', feature }); return; }
    if (path === '/api/dashboard' && !['dashboard', 'products', 'myTeam', 'support'].some((name) => user.permissions[name])) { sendJson(response, 403, { error: 'Dashboard data access is disabled for this account.', code: 'FEATURE_DISABLED', feature: 'dashboard' }); return; }
    if (feature === 'deposit' && !user.allowDeposits) { sendJson(response, 403, { error: 'Deposit access is disabled for this account. Contact support.', code: 'DEPOSIT_DISABLED' }); return; }
    if (feature === 'withdraw' && !user.allowWithdrawals) { sendJson(response, 403, { error: 'Withdrawal access is disabled for this account. Contact support.', code: 'WITHDRAWAL_DISABLED' }); return; }
  }
  const demoUserId = user?.id;
  const getAccount = (userId = demoUserId) => {
    const account = getAccountFor(userId);
    return account ? { ...account, availableBalance: walletBalanceView(userId).availableBalance } : account;
  };
  if (path === '/api/user/account-state' && method === 'GET') { sendJson(response, 200, { accountStatus: user.accountStatus, allowDeposits: user.allowDeposits, allowWithdrawals: user.allowWithdrawals, permissions: user.permissions, countryCode: user.countryCode, currencyCode: user.currencyCode, exchangeRate: user.unitsPerRwf }); return; }
  if (path === '/api/admin/countries' && method === 'GET') {
    if (!isAdmin(request)) { sendJson(response, 401, { error: 'Admin authentication required.' }); return; }
    const countries = supportedCountries.map((supported) => {
      const settings = countrySettingsForCode(supported.countryCode);
      const withdrawalMethods = database.prepare(`SELECT m.code, m.name, coalesce(c.enabled, 0) AS enabled FROM withdrawal_methods m LEFT JOIN country_withdrawal_methods c ON c.method_code = m.code AND c.country_code = ? ORDER BY m.name`).all(supported.countryCode).map((method) => ({ ...method, enabled: Boolean(method.enabled) }));
      const depositMethods = database.prepare('SELECT code, name, enabled FROM deposit_methods WHERE country_code = ? ORDER BY position, name').all(supported.countryCode).map((method) => ({ ...method, enabled: Boolean(method.enabled) }));
      return { ...settings, withdrawalMethods, depositMethods };
    });
    sendJson(response, 200, { countries }); return;
  }
  const countrySettingsRoute = path.match(/^\/api\/admin\/countries\/([A-Z]{2})$/);
  if (countrySettingsRoute && method === 'PUT') {
    const admin = adminUser(request);
    if (!admin) { sendJson(response, 401, { error: 'Admin authentication required.' }); return; }
    const countryCode = countrySettingsRoute[1];
    const current = countrySettingsForCode(countryCode);
    if (!current) { sendJson(response, 404, { error: 'Supported country not found.' }); return; }
    const input = await readBody(request);
    const enabled = input.enabled;
    const unitsPerRwf = Number(input.unitsPerRwf);
    if (typeof enabled !== 'boolean' || !Number.isFinite(unitsPerRwf) || unitsPerRwf < 0 || enabled && unitsPerRwf <= 0 || countryCode === 'RW' && unitsPerRwf !== 1) { sendJson(response, 400, { error: countryCode === 'RW' ? 'Rwanda must remain enabled at exactly 1 RWF per RWF.' : 'Enter a positive exchange rate before enabling this country.' }); return; }
    const withdrawalMethods = input.withdrawalMethods;
    if (withdrawalMethods !== undefined && (!Array.isArray(withdrawalMethods) || withdrawalMethods.some((code) => !validMethod(code)))) { sendJson(response, 400, { error: 'Choose valid withdrawal methods.' }); return; }
    database.exec('BEGIN IMMEDIATE');
    try {
      database.prepare('UPDATE country_settings SET enabled = ?, units_per_rwf = ?, updated_at = ? WHERE country_code = ?').run(enabled ? 1 : 0, unitsPerRwf, now(), countryCode);
      if (withdrawalMethods !== undefined) {
        const saveMethod = database.prepare('INSERT INTO country_withdrawal_methods (country_code, method_code, enabled, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(country_code, method_code) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at');
        for (const method of database.prepare('SELECT code FROM withdrawal_methods').all()) saveMethod.run(countryCode, method.code, withdrawalMethods.includes(method.code) ? 1 : 0, now());
      }
      auditAdmin(admin.id, null, 'COUNTRY_CURRENCY_UPDATED', { enabled: Boolean(current.enabled), unitsPerRwf: current.unitsPerRwf }, { enabled, unitsPerRwf, withdrawalMethods: withdrawalMethods ?? null });
      database.exec('COMMIT');
    } catch (error) { database.exec('ROLLBACK'); throw error; }
    const updated = countrySettingsForCode(countryCode);
    sendJson(response, 200, { ...updated }); return;
  }
  if (path === '/api/admin/users' && method === 'DELETE') {
    const admin = adminUser(request);
    if (!admin) { sendJson(response, 401, { error: 'Sign in with an Admin account to manage users.' }); return; }
    const targetIds = database.prepare("SELECT id FROM users WHERE role <> 'ADMIN'").all().map((target) => target.id);
    const deletedCount = permanentlyDeleteUsers(targetIds);
    sendJson(response, 200, { deleted: deletedCount, permanentlyDeleted: true }); return;
  }
  if (path === '/api/admin/users' && method === 'GET') {
    if (!adminUser(request)) { sendJson(response, 401, { error: 'Sign in with an Admin account to manage users.' }); return; }
    const url = new URL(request.url ?? '/', 'http://localhost');
    const search = String(url.searchParams.get('search') ?? '').trim().slice(0, 100);
    const requestedStatus = url.searchParams.get('status') ?? 'ALL';
    const statusFilter = ['ACTIVE', 'FROZEN', 'RESTRICTED', 'SUSPENDED'].includes(requestedStatus) ? requestedStatus : 'ALL';
    const activeOnly = url.searchParams.get('active') === '1' ? 1 : 0;
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const rows = database.prepare(`SELECT u.id, u.full_name AS fullName, u.phone_number AS phoneNumber, u.referral_code AS referralCode, u.role, u.country_code AS countryCode, u.currency_code AS currencyCode, u.created_at AS createdAt,
      (SELECT max(s.last_seen_at) FROM auth_sessions s WHERE s.user_id = u.id) AS lastActivity,
      (SELECT CASE WHEN julianday(s.last_seen_at) >= julianday('now', '-60 seconds') THEN 1 ELSE 0 END FROM auth_sessions s WHERE s.user_id = u.id ORDER BY s.last_seen_at DESC LIMIT 1) AS isLive,
      (SELECT CASE WHEN julianday(s.last_seen_at) >= julianday('now', '-60 seconds') THEN s.current_page ELSE NULL END FROM auth_sessions s WHERE s.user_id = u.id ORDER BY s.last_seen_at DESC LIMIT 1) AS currentPage,
      coalesce(w.available_balance, 0) AS availableBalance,
      u.welcome_bonus_amount AS welcomeBonusAmount, u.welcome_bonus_awarded_at AS welcomeBonusAwardedAt, u.welcome_bonus_unlocked_at AS welcomeBonusUnlockedAt,
      (SELECT coalesce(sum(t.amount), 0) FROM wallet_transactions t WHERE t.user_id = u.id AND t.type = 'DEPOSIT' AND t.status = 'SUCCESS') AS totalDeposit,
      (SELECT coalesce(sum(t.amount), 0) FROM wallet_transactions t WHERE t.user_id = u.id AND t.type = 'WITHDRAWAL' AND t.status IN ('APPROVED', 'AWAITING_PAYOUT', 'PROCESSING', 'SUCCESS')) AS totalWithdrawal,
      (SELECT count(*) FROM product_purchases p WHERE p.user_id = u.id AND p.status = 'COMPLETED') AS productsPurchased,
      coalesce((SELECT sponsor.full_name FROM referral_relationships r JOIN users sponsor ON sponsor.id = r.sponsor_user_id WHERE r.user_id = u.id), (SELECT sponsor.full_name FROM users sponsor WHERE sponsor.id = u.referred_by)) AS referredBy,
      coalesce(c.account_status, 'ACTIVE') AS accountStatus, coalesce(c.allow_deposits, 1) AS allowDeposits, coalesce(c.allow_withdrawals, 1) AS allowWithdrawals,
      (SELECT status FROM wallet_transactions t WHERE t.user_id = u.id AND t.type = 'DEPOSIT' ORDER BY t.created_at DESC LIMIT 1) AS lastDepositStatus,
      (SELECT status FROM wallet_transactions t WHERE t.user_id = u.id AND t.type = 'WITHDRAWAL' ORDER BY t.created_at DESC LIMIT 1) AS lastWithdrawalStatus
      FROM users u LEFT JOIN wallet_accounts w ON w.user_id = u.id LEFT JOIN user_access_controls c ON c.user_id = u.id
      WHERE c.deleted_at IS NULL AND (? = '' OR u.full_name LIKE '%' || ? || '%' OR u.phone_number LIKE '%' || ? || '%') AND (? = 'ALL' OR coalesce(c.account_status, 'ACTIVE') = ?) AND (? = 0 OR EXISTS (SELECT 1 FROM product_purchases p WHERE p.user_id = u.id AND p.status = 'COMPLETED'))
      ORDER BY u.created_at DESC LIMIT ? OFFSET ?`).all(search, search, search, statusFilter, statusFilter, activeOnly, limit, offset);
    const total = database.prepare(`SELECT count(*) AS count FROM users u LEFT JOIN user_access_controls c ON c.user_id = u.id WHERE c.deleted_at IS NULL AND (? = '' OR u.full_name LIKE '%' || ? || '%' OR u.phone_number LIKE '%' || ? || '%') AND (? = 'ALL' OR coalesce(c.account_status, 'ACTIVE') = ?) AND (? = 0 OR EXISTS (SELECT 1 FROM product_purchases p WHERE p.user_id = u.id AND p.status = 'COMPLETED'))`).get(search, search, search, statusFilter, statusFilter, activeOnly).count;
    sendJson(response, 200, { users: rows.map((row) => {
      const wallet = walletBalanceView(row.id);
      const currency = currencyForUser(row.id);
      return { ...row, availableBalance: wallet.availableBalance, displayAvailableBalance: wallet.displayAvailableBalance, displayTotalDeposit: localAmount(row.totalDeposit, currency), displayTotalWithdrawal: localAmount(row.totalWithdrawal, currency), displayWelcomeBonusAmount: wallet.displayWelcomeBonusAmount, welcomeBonusUnlockedAt: wallet.welcomeBonusUnlockedAt, allowDeposits: Boolean(row.allowDeposits), allowWithdrawals: Boolean(row.allowWithdrawals) };
    }), total, limit, offset }); return;
  }
  const adminUserRoute = path.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (adminUserRoute && method === 'GET') {
    if (!adminUser(request)) { sendJson(response, 401, { error: 'Sign in with an Admin account to manage users.' }); return; }
    const targetId = decodeURIComponent(adminUserRoute[1]);
    const target = database.prepare(`SELECT u.id, u.full_name AS fullName, u.phone_number AS phoneNumber, u.referral_code AS referralCode, u.role, u.country_code AS countryCode, u.currency_code AS currencyCode, u.created_at AS createdAt,
      (SELECT max(s.last_seen_at) FROM auth_sessions s WHERE s.user_id = u.id) AS lastActivity,
      (SELECT CASE WHEN julianday(s.last_seen_at) >= julianday('now', '-60 seconds') THEN 1 ELSE 0 END FROM auth_sessions s WHERE s.user_id = u.id ORDER BY s.last_seen_at DESC LIMIT 1) AS isLive,
      (SELECT CASE WHEN julianday(s.last_seen_at) >= julianday('now', '-60 seconds') THEN s.current_page ELSE NULL END FROM auth_sessions s WHERE s.user_id = u.id ORDER BY s.last_seen_at DESC LIMIT 1) AS currentPage,
      coalesce((SELECT sponsor.full_name FROM referral_relationships r JOIN users sponsor ON sponsor.id = r.sponsor_user_id WHERE r.user_id = u.id), (SELECT sponsor.full_name FROM users sponsor WHERE sponsor.id = u.referred_by)) AS referredBy,
      u.welcome_bonus_amount AS welcomeBonusAmount, u.welcome_bonus_awarded_at AS welcomeBonusAwardedAt,
      CASE WHEN EXISTS (SELECT 1 FROM product_purchases p WHERE p.user_id = u.id AND p.status = 'COMPLETED') THEN u.welcome_bonus_unlocked_at ELSE NULL END AS welcomeBonusUnlockedAt
      FROM users u WHERE u.id = ?`).get(targetId);
    if (!target) { sendJson(response, 404, { error: 'User not found.' }); return; }
    const controls = userAccess(targetId);
    const wallet = walletBalanceView(targetId);
    const financialTotals = database.prepare(`SELECT
      (SELECT coalesce(sum(amount), 0) FROM wallet_transactions WHERE user_id = ? AND type = 'DEPOSIT' AND status = 'SUCCESS') AS totalDeposit,
      (SELECT coalesce(sum(amount), 0) FROM wallet_transactions WHERE user_id = ? AND type = 'WITHDRAWAL' AND status IN ('APPROVED', 'AWAITING_PAYOUT', 'PROCESSING', 'SUCCESS')) AS totalWithdrawal,
      (SELECT count(*) FROM product_purchases WHERE user_id = ? AND status = 'COMPLETED') AS productsPurchased,
      (SELECT coalesce(sum(commission_amount), 0) FROM commission_ledger WHERE beneficiary_user_id = ? AND status IN ('PENDING', 'APPROVED')) AS referralCommissionEarned`).get(targetId, targetId, targetId, targetId);
    const transactions = database.prepare('SELECT * FROM wallet_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(targetId).map(transactionView);
    const messages = database.prepare("SELECT m.id, m.kind, m.title, m.body, m.notification_type AS notificationType, m.created_at AS createdAt, CASE WHEN r.message_id IS NULL THEN 0 ELSE 1 END AS isRead FROM user_messages m LEFT JOIN user_message_reads r ON r.message_id = m.id AND r.user_id = ? WHERE m.recipient_user_id = ? OR m.kind = 'BROADCAST' ORDER BY m.created_at DESC LIMIT 50").all(targetId, targetId).map((message) => ({ ...message, isRead: Boolean(message.isRead) }));
    const audit = database.prepare('SELECT id, action, previous_value AS previousValue, new_value AS newValue, metadata, created_at AS createdAt FROM admin_audit_log WHERE target_user_id = ? ORDER BY created_at DESC LIMIT 50').all(targetId);
    const currency = currencyForUser(targetId);
    sendJson(response, 200, { user: { ...target, ...controls, ...wallet, ...financialTotals, displayTotalDeposit: localAmount(financialTotals.totalDeposit, currency), displayTotalWithdrawal: localAmount(financialTotals.totalWithdrawal, currency), displayReferralCommissionEarned: localAmount(financialTotals.referralCommissionEarned, currency) }, transactions, messages, audit }); return;
  }
  const adminBalanceRoute = path.match(/^\/api\/admin\/users\/([^/]+)\/balance$/);
  if (adminBalanceRoute && method === 'POST') {
    const admin = adminUser(request);
    if (!admin) { sendJson(response, 401, { error: 'Sign in with an Admin account to adjust balances.' }); return; }
    const targetId = decodeURIComponent(adminBalanceRoute[1]);
    const input = await readBody(request);
    const amount = Number(input.amount);
    const reason = String(input.reason ?? '').trim().slice(0, 250);
    if (!Number.isSafeInteger(amount) || amount === 0 || !reason) { sendJson(response, 400, { error: 'Enter a non-zero whole RWF amount and a reason.' }); return; }
    if (!getAccountFor(targetId)) { sendJson(response, 404, { error: 'User wallet not found.' }); return; }
    database.exec('BEGIN IMMEDIATE');
    try {
      const previousBalance = walletBalanceView(targetId).availableBalance;
      if (previousBalance + amount < 0) throw new Error('Adjustment cannot make the available balance negative.');
      const updated = database.prepare('UPDATE wallet_accounts SET available_balance = available_balance + ?, updated_at = ? WHERE user_id = ?').run(amount, now(), targetId);
      if (!updated.changes) throw new Error('User wallet not found.');
      auditAdmin(admin.id, targetId, 'WALLET_BALANCE_ADJUSTED', { availableBalance: previousBalance }, { availableBalance: previousBalance + amount }, { amount, reason });
      database.exec('COMMIT');
      sendJson(response, 200, { balance: walletBalanceView(targetId) });
    } catch (error) {
      database.exec('ROLLBACK');
      sendJson(response, 400, { error: error.message });
    }
    return;
  }
  if (adminUserRoute && method === 'PATCH') {
    const admin = adminUser(request);
    if (!admin) { sendJson(response, 401, { error: 'Sign in with an Admin account to manage users.' }); return; }
    const targetId = decodeURIComponent(adminUserRoute[1]);
    const target = database.prepare('SELECT id, full_name AS fullName, role FROM users WHERE id = ?').get(targetId);
    if (!target) { sendJson(response, 404, { error: 'User not found.' }); return; }
    const input = await readBody(request);
    if (target.role === 'ADMIN' && admin?.id === target.id && ['role', 'permissions', 'accountStatus', 'allowDeposits', 'allowWithdrawals'].some((field) => input[field] !== undefined)) { sendJson(response, 403, { error: 'You cannot change your own Admin role, status or permissions.' }); return; }
    if (input.role !== undefined && !['USER', 'ADMIN'].includes(input.role)) { sendJson(response, 400, { error: 'Role must be USER or ADMIN.' }); return; }
    if (input.role !== undefined && input.role !== target.role) {
      if (targetId === admin.id) { sendJson(response, 403, { error: 'You cannot change your own Admin role.' }); return; }
      if (target.role === 'ADMIN' && input.role === 'USER' && database.prepare("SELECT count(*) AS count FROM users WHERE role = 'ADMIN'").get().count <= 1) { sendJson(response, 409, { error: 'The last Admin account cannot be demoted.' }); return; }
      database.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(input.role, now(), targetId);
      if (target.role === 'ADMIN' && input.role === 'USER') database.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(targetId);
      auditAdmin(admin.id, targetId, 'USER_ROLE_UPDATED', { role: target.role }, { role: input.role });
    }
    const fullName = input.fullName === undefined ? undefined : String(input.fullName).trim();
    if (fullName !== undefined && (fullName.length < 2 || fullName.length > 100)) { sendJson(response, 400, { error: 'Name must be between 2 and 100 characters.' }); return; }
    const controlsInput = { accountStatus: input.accountStatus, allowDeposits: input.allowDeposits, allowWithdrawals: input.allowWithdrawals };
    const hasControls = Object.values(controlsInput).some((value) => value !== undefined);
    if (['allowDeposits', 'allowWithdrawals'].some((field) => input[field] !== undefined && typeof input[field] !== 'boolean')) { sendJson(response, 400, { error: 'Deposit and withdrawal access values must be true or false.' }); return; }
    const permissions = input.permissions && typeof input.permissions === 'object' && !Array.isArray(input.permissions) ? input.permissions : {};
    const invalidPermission = Object.entries(permissions).some(([feature, enabled]) => !userFeatures.includes(feature) || typeof enabled !== 'boolean');
    if (invalidPermission) { sendJson(response, 400, { error: 'One or more feature permissions are invalid.' }); return; }
    if (input.permissions !== undefined && (!input.permissions || typeof input.permissions !== 'object' || Array.isArray(input.permissions))) { sendJson(response, 400, { error: 'Feature permissions must be an object.' }); return; }
    if (input.accountStatus !== undefined && !['ACTIVE', 'FROZEN', 'RESTRICTED', 'SUSPENDED'].includes(input.accountStatus)) { sendJson(response, 400, { error: 'Invalid account status.' }); return; }
    if (fullName !== undefined) {
      database.prepare('UPDATE users SET full_name = ?, updated_at = ? WHERE id = ?').run(fullName, now(), targetId);
      auditAdmin(admin.id, targetId, 'USER_UPDATED', { fullName: target.fullName }, { fullName });
    }
    if (hasControls || Object.keys(permissions).length) {
      saveUserControls(targetId, admin.id, controlsInput, permissions);
      if (input.accountStatus === 'SUSPENDED') database.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(targetId);
    }
    const refreshed = database.prepare('SELECT id, full_name AS fullName, phone_number AS phoneNumber, referral_code AS referralCode, role FROM users WHERE id = ?').get(targetId);
    sendJson(response, 200, { user: { ...refreshed, ...userAccess(targetId) } }); return;
  }
  if (adminUserRoute && method === 'DELETE') {
    const admin = adminUser(request);
    if (!admin) { sendJson(response, 401, { error: 'Sign in with an Admin account to manage users.' }); return; }
    const targetId = decodeURIComponent(adminUserRoute[1]);
    const target = database.prepare('SELECT id, role FROM users WHERE id = ?').get(targetId);
    if (!target) { sendJson(response, 404, { error: 'User not found.' }); return; }
    if (target.role === 'ADMIN') { sendJson(response, 403, { error: 'Admin accounts cannot be deleted from user management.' }); return; }
    if (admin.id === targetId) { sendJson(response, 400, { error: 'You cannot delete your own account.' }); return; }
    permanentlyDeleteUsers([targetId]);
    sendJson(response, 200, { deleted: true, permanentlyDeleted: true }); return;
  }
  const passwordReset = path.match(/^\/api\/admin\/users\/([^/]+)\/reset-password$/);
  if (passwordReset && method === 'POST') {
    const admin = adminUser(request);
    if (!admin) { sendJson(response, 401, { error: 'Sign in with an Admin account to reset passwords.' }); return; }
    const targetId = decodeURIComponent(passwordReset[1]);
    const target = database.prepare('SELECT id, role FROM users WHERE id = ?').get(targetId);
    if (!target) { sendJson(response, 404, { error: 'User not found.' }); return; }
    if (target.role === 'ADMIN' && admin.id !== targetId) { sendJson(response, 403, { error: 'An Admin cannot reset another Admin password.' }); return; }
    const temporaryPassword = String(randomInt(0, 1000000)).padStart(6, '0');
    const credential = passwordHash(temporaryPassword);
    database.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(`${credential.salt}:${credential.hash}`, now(), targetId);
    database.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(targetId);
    auditAdmin(admin?.id ?? null, targetId, 'PASSWORD_RESET', null, { sessionsInvalidated: true });
    sendJson(response, 200, { temporaryPassword }); return;
  }
  if (path === '/api/admin/messages/private' && method === 'POST') {
    const admin = adminUser(request);
    if (!admin) { sendJson(response, 401, { error: 'Sign in with an Admin account to send messages.' }); return; }
    const input = await readBody(request);
    const recipientUserId = String(input.userId ?? '');
    const title = String(input.title ?? '').trim().slice(0, 160);
    const body = String(input.body ?? '').trim().slice(0, 4000);
    const notificationType = ['INFO', 'SUCCESS', 'WARNING'].includes(input.notificationType) ? input.notificationType : 'INFO';
    if (!database.prepare('SELECT id FROM users WHERE id = ?').get(recipientUserId)) { sendJson(response, 404, { error: 'Recipient user not found.' }); return; }
    if (!body) { sendJson(response, 400, { error: 'Message cannot be empty.' }); return; }
    const id = randomUUID();
    database.prepare('INSERT INTO user_messages (id, sender_user_id, recipient_user_id, kind, title, body, notification_type) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, admin?.id ?? null, recipientUserId, 'PRIVATE', title, body, notificationType);
    auditAdmin(admin?.id ?? null, recipientUserId, 'PRIVATE_MESSAGE_SENT', null, { title, notificationType });
    sendJson(response, 201, { message: { id, recipientUserId, title, body, notificationType } }); return;
  }
  if (path === '/api/admin/messages/broadcast' && method === 'POST') {
    const admin = adminUser(request);
    if (!admin) { sendJson(response, 401, { error: 'Sign in with an Admin account to send messages.' }); return; }
    const input = await readBody(request);
    const title = String(input.title ?? '').trim().slice(0, 160);
    const body = String(input.body ?? '').trim().slice(0, 4000);
    const notificationType = ['INFO', 'SUCCESS', 'WARNING'].includes(input.notificationType) ? input.notificationType : 'INFO';
    if (!body) { sendJson(response, 400, { error: 'Broadcast message cannot be empty.' }); return; }
    const id = randomUUID();
    database.prepare('INSERT INTO user_messages (id, sender_user_id, recipient_user_id, kind, title, body, notification_type) VALUES (?, ?, NULL, ?, ?, ?, ?)').run(id, admin?.id ?? null, 'BROADCAST', title, body, notificationType);
    auditAdmin(admin?.id ?? null, null, 'BROADCAST_SENT', null, { title, notificationType });
    sendJson(response, 201, { broadcast: { id, title, body, notificationType } }); return;
  }
  if (path === '/api/user/messages' && method === 'GET') {
    const limit = Math.min(100, Math.max(1, Number(new URL(request.url ?? '/', 'http://localhost').searchParams.get('limit')) || 50));
    const messages = database.prepare('SELECT m.id, m.kind, m.title, m.body, m.notification_type AS notificationType, m.created_at AS createdAt, u.full_name AS senderName, CASE WHEN r.message_id IS NULL THEN 0 ELSE 1 END AS isRead FROM user_messages m LEFT JOIN users u ON u.id = m.sender_user_id LEFT JOIN user_message_reads r ON r.message_id = m.id AND r.user_id = ? WHERE m.recipient_user_id = ? OR m.kind = \'BROADCAST\' ORDER BY m.created_at DESC LIMIT ?').all(user.id, user.id, limit);
    sendJson(response, 200, { messages: messages.map((message) => ({ ...message, isRead: Boolean(message.isRead) })), unreadCount: messages.filter((message) => !message.isRead).length }); return;
  }
  const messageRead = path.match(/^\/api\/user\/messages\/([^/]+)\/read$/);
  if (messageRead && method === 'PATCH') {
    const messageId = decodeURIComponent(messageRead[1]);
    const allowed = database.prepare('SELECT id FROM user_messages WHERE id = ? AND (recipient_user_id = ? OR kind = ?)').get(messageId, user.id, 'BROADCAST');
    if (!allowed) { sendJson(response, 404, { error: 'Message not found.' }); return; }
    database.prepare('INSERT OR IGNORE INTO user_message_reads (message_id, user_id) VALUES (?, ?)').run(messageId, user.id);
    sendJson(response, 200, { read: true }); return;
  }
  if (path === '/api/admin/overview' && method === 'GET') {
    if (!isAdmin(request)) { sendJson(response, 401, { error: 'Admin authentication required.' }); return; }
    const members = database.prepare('SELECT count(*) AS count FROM users').get().count;
    const deposits = database.prepare("SELECT count(*) AS count, coalesce(sum(amount), 0) AS amount FROM wallet_transactions WHERE type = 'DEPOSIT' AND status = 'PENDING'").get();
    const withdrawals = database.prepare("SELECT count(*) AS count, coalesce(sum(amount), 0) AS amount FROM wallet_transactions WHERE type = 'WITHDRAWAL' AND status = 'PENDING'").get();
    const plans = database.prepare('SELECT count(*) AS count FROM plans').get().count;
    const completedDeposits = database.prepare("SELECT coalesce(sum(amount), 0) AS amount FROM wallet_transactions WHERE type = 'DEPOSIT' AND status = 'SUCCESS'").get().amount;
    const completedWithdrawals = database.prepare("SELECT coalesce(sum(amount), 0) AS amount FROM wallet_transactions WHERE type = 'WITHDRAWAL' AND status IN ('APPROVED', 'AWAITING_PAYOUT', 'PROCESSING', 'SUCCESS')").get().amount;
    const activeUsers = database.prepare("SELECT count(DISTINCT user_id) AS count FROM product_purchases WHERE status = 'COMPLETED'").get().count;
    const liveUsers = database.prepare("SELECT count(DISTINCT user_id) AS count FROM auth_sessions WHERE expires_at > ? AND last_seen_at >= ?").get(now(), new Date(Date.now() - 60_000).toISOString()).count;
    const productsSold = database.prepare("SELECT count(*) AS count FROM product_purchases WHERE status = 'COMPLETED'").get().count;
    const referrals = database.prepare('SELECT count(*) AS count FROM referral_relationships').get().count;
    const totalReferralCommissions = database.prepare("SELECT coalesce(sum(commission_amount), 0) AS total FROM commission_ledger WHERE status = 'APPROVED'").get().total;
    const summary = { totalUsers: members, activeUsers, liveUsers, totalDeposit: completedDeposits, totalWithdrawal: completedWithdrawals, totalProductsSold: productsSold, totalReferrals: referrals, totalReferralCommissions };
    sendJson(response, 200, { members, pendingDeposits: deposits, pendingWithdrawals: withdrawals, plans, activeUsers, liveUsers, completedDeposits, completedWithdrawals, productsSold, referrals, summary }); return;
  }
  if (path === '/api/admin/summary' && method === 'GET') {
    if (!adminUser(request)) { sendJson(response, 401, { error: 'Admin authentication required.' }); return; }
    const totals = database.prepare(`SELECT
      (SELECT count(*) FROM users) AS totalUsers,
      (SELECT count(DISTINCT user_id) FROM product_purchases WHERE status = 'COMPLETED') AS activeUsers,
      (SELECT count(DISTINCT user_id) FROM auth_sessions WHERE expires_at > ? AND last_seen_at >= ?) AS liveUsers,
      (SELECT coalesce(sum(amount), 0) FROM wallet_transactions WHERE type = 'DEPOSIT' AND status = 'SUCCESS') AS totalDeposit,
      (SELECT coalesce(sum(amount), 0) FROM wallet_transactions WHERE type = 'WITHDRAWAL' AND status IN ('APPROVED', 'AWAITING_PAYOUT', 'PROCESSING', 'SUCCESS')) AS totalWithdrawal,
      (SELECT count(*) FROM product_purchases WHERE status = 'COMPLETED') AS totalProductsSold,
      (SELECT count(*) FROM referral_relationships) AS totalReferrals,
      (SELECT coalesce(sum(commission_amount), 0) FROM commission_ledger WHERE status = 'APPROVED') AS totalReferralCommissions`).get(now(), new Date(Date.now() - 60_000).toISOString());
    sendJson(response, 200, totals); return;
  }
  if (path === '/api/admin/promoters' && method === 'GET') {
    if (!adminUser(request)) { sendJson(response, 401, { error: 'Admin authentication required.' }); return; }
    const url = new URL(request.url ?? '/', 'http://localhost');
    const search = String(url.searchParams.get('search') ?? '').trim().slice(0, 100);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 25));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const promoters = database.prepare(`${referralEdgesCte()}
      SELECT u.id AS userId, u.full_name AS fullName, u.phone_number AS phoneNumber, u.created_at AS createdAt,
        count(edge.user_id) AS totalReferred,
        sum(CASE WHEN EXISTS (SELECT 1 FROM product_purchases p WHERE p.user_id = edge.user_id AND p.status = 'COMPLETED') THEN 1 ELSE 0 END) AS activeMembers
      FROM users u JOIN referral_edges edge ON edge.sponsor_user_id = u.id
      WHERE (? = '' OR u.full_name LIKE '%' || ? || '%' OR u.phone_number LIKE '%' || ? || '%')
      GROUP BY u.id ORDER BY totalReferred DESC, u.created_at DESC LIMIT ? OFFSET ?`).all(search, search, search, limit, offset);
    const total = database.prepare(`${referralEdgesCte()} SELECT count(*) AS count FROM (SELECT u.id FROM users u JOIN referral_edges edge ON edge.sponsor_user_id = u.id WHERE (? = '' OR u.full_name LIKE '%' || ? || '%' OR u.phone_number LIKE '%' || ? || '%') GROUP BY u.id)`).get(search, search, search).count;
    sendJson(response, 200, { promoters: promoters.map((row) => ({ ...row, activeMembers: Number(row.activeMembers ?? 0) })), total, limit, offset }); return;
  }
  const adminPromoter = path.match(/^\/api\/admin\/promoters\/([^/]+)$/);
  if (adminPromoter && method === 'GET') {
    if (!adminUser(request)) { sendJson(response, 401, { error: 'Admin authentication required.' }); return; }
    const promoterId = decodeURIComponent(adminPromoter[1]);
    const promoter = database.prepare('SELECT id AS userId, full_name AS fullName, phone_number AS phoneNumber, created_at AS createdAt FROM users WHERE id = ?').get(promoterId);
    if (!promoter) { sendJson(response, 404, { error: 'Promoter not found.' }); return; }
    const url = new URL(request.url ?? '/', 'http://localhost');
    const requestedLevel = Number(url.searchParams.get('level')) || 0;
    const level = requestedLevel >= 1 && requestedLevel <= 3 ? requestedLevel : 0;
    const search = String(url.searchParams.get('search') ?? '').trim().slice(0, 100);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 25));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const levels = database.prepare(`${teamCte()}
      SELECT team.level, count(*) AS total,
        sum(CASE WHEN EXISTS (SELECT 1 FROM product_purchases p WHERE p.user_id = team.user_id AND p.status = 'COMPLETED') THEN 1 ELSE 0 END) AS active
      FROM team GROUP BY team.level ORDER BY team.level`).all(promoterId);
    const aggregates = database.prepare(`${teamCte()}
      SELECT count(*) AS totalReferred,
        sum(CASE WHEN EXISTS (SELECT 1 FROM product_purchases p WHERE p.user_id = team.user_id AND p.status = 'COMPLETED') THEN 1 ELSE 0 END) AS activeMembers,
        coalesce(sum((SELECT coalesce(sum(t.amount), 0) FROM wallet_transactions t WHERE t.user_id = team.user_id AND t.type = 'DEPOSIT' AND t.status = 'SUCCESS')), 0) AS totalDeposit,
        coalesce(sum((SELECT coalesce(sum(t.amount), 0) FROM wallet_transactions t WHERE t.user_id = team.user_id AND t.type = 'WITHDRAWAL' AND t.status IN ('APPROVED', 'AWAITING_PAYOUT', 'PROCESSING', 'SUCCESS'))), 0) AS totalWithdrawal,
        coalesce(sum((SELECT count(*) FROM product_purchases p WHERE p.user_id = team.user_id AND p.status = 'COMPLETED')), 0) AS totalProductsPurchased
      FROM team`).get(promoterId);
    const directAggregates = database.prepare(`${teamCte()}
      SELECT count(*) AS totalReferred,
        sum(CASE WHEN EXISTS (SELECT 1 FROM product_purchases p WHERE p.user_id = team.user_id AND p.status = 'COMPLETED') THEN 1 ELSE 0 END) AS activeMembers
      FROM team WHERE level = 1`).get(promoterId);
    const commissions = database.prepare(`SELECT c.id, c.beneficiary_user_id AS referrerUserId, referrer.full_name AS referrerName,
      c.source_user_id AS referredUserId, referred.full_name AS referredUserName, c.product_id AS productId,
      c.qualifying_amount AS purchaseAmount, c.referral_level AS commissionLevel, c.percentage AS commissionPercentage,
      c.commission_amount AS commissionAmount, c.status, c.created_at AS date, c.reference
      FROM commission_ledger c JOIN users referrer ON referrer.id = c.beneficiary_user_id
      JOIN users referred ON referred.id = c.source_user_id WHERE c.beneficiary_user_id = ? ORDER BY c.created_at DESC LIMIT 200`).all(promoterId);
    const filteredTeamCount = database.prepare(`${teamCte()} SELECT count(*) AS count FROM team JOIN users u ON u.id = team.user_id WHERE (? = 0 OR team.level = ?) AND (? = '' OR u.full_name LIKE '%' || ? || '%' OR u.phone_number LIKE '%' || ? || '%')`).get(promoterId, level, level, search, search, search).count;
    const users = database.prepare(`${teamCte()}, team_users AS (${teamMemberStatsSql()})
      SELECT *, CASE WHEN productsPurchased > 0 THEN 'ACTIVE' ELSE 'INACTIVE' END AS activityStatus
      FROM team_users WHERE (? = 0 OR level = ?) AND (? = '' OR fullName LIKE '%' || ? || '%' OR phoneNumber LIKE '%' || ? || '%')
      ORDER BY level, createdAt DESC LIMIT ? OFFSET ?`).all(promoterId, level, level, search, search, search, limit, offset);
    sendJson(response, 200, {
      promoter,
      totals: {
        totalReferred: directAggregates.totalReferred ?? 0,
        activeMembers: directAggregates.activeMembers ?? 0,
        inactiveMembers: (directAggregates.totalReferred ?? 0) - (directAggregates.activeMembers ?? 0),
      },
      teamTotals: { totalDeposit: aggregates.totalDeposit, totalWithdrawal: aggregates.totalWithdrawal, totalProductsPurchased: aggregates.totalProductsPurchased },
      levels,
      members: users,
      commissions,
      total: filteredTeamCount,
      limit,
      offset,
    }); return;
  }
  if (path === '/api/admin/live-users' && method === 'GET') {
    if (!adminUser(request)) { sendJson(response, 401, { error: 'Admin authentication required.' }); return; }
    const url = new URL(request.url ?? '/', 'http://localhost');
    const search = String(url.searchParams.get('search') ?? '').trim().slice(0, 100);
    const page = String(url.searchParams.get('page') ?? 'ALL').trim().slice(0, 40);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 25));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const since = new Date(Date.now() - 60_000).toISOString();
    const liveSessions = database.prepare(`SELECT s.id AS sessionId, s.user_id AS userId, u.full_name AS fullName, u.phone_number AS phoneNumber, u.country_code AS countryCode, u.currency_code AS currencyCode,
      s.current_page AS currentPage, s.last_seen_at AS lastActive, s.created_at AS loginAt,
      (SELECT coalesce(sum(t.amount), 0) FROM wallet_transactions t WHERE t.user_id = u.id AND t.type = 'DEPOSIT' AND t.status = 'SUCCESS') AS totalDeposit,
      (SELECT coalesce(sum(t.amount), 0) FROM wallet_transactions t WHERE t.user_id = u.id AND t.type = 'WITHDRAWAL' AND t.status IN ('APPROVED', 'AWAITING_PAYOUT', 'PROCESSING', 'SUCCESS')) AS totalWithdrawal,
      coalesce(w.available_balance, 0) AS currentBalance,
      (SELECT count(*) FROM product_purchases p WHERE p.user_id = u.id AND p.status = 'COMPLETED') AS productsPurchased,
      (SELECT sponsor.full_name FROM referral_relationships r JOIN users sponsor ON sponsor.id = r.sponsor_user_id WHERE r.user_id = u.id
       UNION ALL SELECT sponsor.full_name FROM users referred JOIN users sponsor ON sponsor.id = referred.referred_by WHERE referred.id = u.id AND NOT EXISTS (SELECT 1 FROM referral_relationships r WHERE r.user_id = u.id) LIMIT 1) AS promoterName
      FROM auth_sessions s JOIN users u ON u.id = s.user_id LEFT JOIN wallet_accounts w ON w.user_id = u.id
      WHERE s.expires_at > ? AND s.last_seen_at >= ? AND (? = '' OR u.full_name LIKE '%' || ? || '%' OR u.phone_number LIKE '%' || ? || '%') AND (? = 'ALL' OR s.current_page = ?)
      ORDER BY s.last_seen_at DESC LIMIT ? OFFSET ?`).all(now(), since, search, search, search, page, page, limit, offset);
    const total = database.prepare(`SELECT count(*) AS count FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.expires_at > ? AND s.last_seen_at >= ? AND (? = '' OR u.full_name LIKE '%' || ? || '%' OR u.phone_number LIKE '%' || ? || '%') AND (? = 'ALL' OR s.current_page = ?)`).get(now(), since, search, search, search, page, page).count;
    sendJson(response, 200, { users: liveSessions.map((session) => { const currency = currencyForUser(session.userId); return { ...session, displayTotalDeposit: localAmount(session.totalDeposit, currency), displayTotalWithdrawal: localAmount(session.totalWithdrawal, currency), displayCurrentBalance: localAmount(walletBalanceView(session.userId).availableBalance, currency), currencyCode: currency.currencyCode, active: session.productsPurchased > 0 }; }), total, limit, offset, onlineWindowSeconds: 60 }); return;
  }
  if (path === '/api/admin/members' && method === 'GET') {
    if (!isAdmin(request)) { sendJson(response, 401, { error: 'Admin authentication required.' }); return; }
    const members = database.prepare('SELECT u.id, u.full_name AS fullName, u.phone_number AS phoneNumber, u.referral_code AS referralCode, u.role, u.created_at AS createdAt, coalesce(w.available_balance, 0) AS availableBalance FROM users u LEFT JOIN wallet_accounts w ON w.user_id = u.id ORDER BY u.created_at DESC LIMIT 500').all();
    sendJson(response, 200, { members }); return;
  }
  if (path === '/api/admin/plans' && method === 'GET') {
    if (!isAdmin(request)) { sendJson(response, 401, { error: 'Admin authentication required.' }); return; }
    const plans = database.prepare('SELECT * FROM plans ORDER BY position, name').all().map(planView);
    sendJson(response, 200, { plans }); return;
  }
  if (path === '/api/admin/plans' && method === 'POST') {
    if (!isAdmin(request)) { sendJson(response, 401, { error: 'Admin authentication required.' }); return; }
    const parsed = parsePlan(await readBody(request));
    if (parsed.error) { sendJson(response, 400, { error: parsed.error }); return; }
    const plan = parsed.value;
    try {
      database.prepare('INSERT INTO plans (name, deposited, income_per_day, term, status, note, position, description, image_data, price, daily_income, duration_days, purchase_bonus, total_slots, sold_slots) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)')
        .run(plan.name, String(plan.price), String(plan.dailyIncome), `${plan.durationDays} days`, plan.status, plan.description, plan.position, plan.description, plan.imageData, plan.price, plan.dailyIncome, plan.durationDays, plan.purchaseBonus, plan.totalSlots);
    }
    catch (error) { if (error.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint failed/.test(error.message)) { sendJson(response, 409, { error: 'A product with that name already exists.' }); return; } throw error; }
    sendJson(response, 201, { plan: planView(database.prepare('SELECT * FROM plans WHERE name = ?').get(plan.name)) }); return;
  }
  const adminPlan = path.match(/^\/api\/admin\/plans\/([^/]+)$/);
  if (adminPlan && method === 'PUT') {
    if (!isAdmin(request)) { sendJson(response, 401, { error: 'Admin authentication required.' }); return; }
    const name = decodeURIComponent(adminPlan[1]);
    const parsed = parsePlan({ ...await readBody(request), name });
    if (parsed.error) { sendJson(response, 400, { error: parsed.error }); return; }
    const plan = parsed.value;
    const current = database.prepare('SELECT sold_slots FROM plans WHERE name = ?').get(name);
    if (!current) { sendJson(response, 404, { error: 'Product not found.' }); return; }
    if (plan.totalSlots < current.sold_slots) { sendJson(response, 400, { error: `Total slots cannot be less than ${current.sold_slots} slots already sold.` }); return; }
    database.prepare('UPDATE plans SET deposited = ?, income_per_day = ?, term = ?, status = ?, note = ?, position = ?, description = ?, image_data = ?, price = ?, daily_income = ?, duration_days = ?, purchase_bonus = ?, total_slots = ? WHERE name = ?')
      .run(String(plan.price), String(plan.dailyIncome), `${plan.durationDays} days`, plan.status, plan.description, plan.position, plan.description, plan.imageData, plan.price, plan.dailyIncome, plan.durationDays, plan.purchaseBonus, plan.totalSlots, name);
    sendJson(response, 200, { plan: planView(database.prepare('SELECT * FROM plans WHERE name = ?').get(name)) }); return;
  }
  if (adminPlan && method === 'DELETE') {
    if (!isAdmin(request)) { sendJson(response, 401, { error: 'Admin authentication required.' }); return; }
    const name = decodeURIComponent(adminPlan[1]);
    if (database.prepare('SELECT id FROM product_purchases WHERE product_name = ? LIMIT 1').get(name)) { sendJson(response, 409, { error: 'Products with purchase history cannot be deleted.' }); return; }
    const result = database.prepare('DELETE FROM plans WHERE name = ?').run(name);
    if (!result.changes) { sendJson(response, 404, { error: 'Plan not found.' }); return; }
    sendJson(response, 200, { deleted: true }); return;
  }
  if (path === '/api/admin/support/settings' && method === 'GET') {
    if (!isAdmin(request)) { sendJson(response, 401, { error: 'Admin authentication required.' }); return; }
    sendJson(response, 200, { telegramUrl: setting('telegram_url'), telegramPopupMessage: setting('telegram_popup_message'), supportEmail: setting('support_email'), liveChatEnabled: setting('live_chat_enabled') === '1' }); return;
  }
  if (path === '/api/admin/support/settings' && method === 'PUT') {
    if (!isAdmin(request)) { sendJson(response, 401, { error: 'Admin authentication required.' }); return; }
    const input = await readBody(request);
    const telegramUrl = String(input.telegramUrl ?? '').trim();
    const telegramPopupMessage = String(input.telegramPopupMessage ?? '').trim();
    const supportEmail = String(input.supportEmail ?? '').trim();
    if (telegramUrl) {
      try {
        const parsed = new URL(telegramUrl);
        if (parsed.protocol !== 'https:' || !['t.me', 'telegram.me'].includes(parsed.hostname) || parsed.pathname === '/') throw new Error();
      } catch { sendJson(response, 400, { error: 'Enter a valid HTTPS Telegram group link.' }); return; }
    }
    if (supportEmail && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail) || supportEmail.length > 200)) { sendJson(response, 400, { error: 'Enter a valid support email address.' }); return; }
    if (telegramPopupMessage.length > 180) { sendJson(response, 400, { error: 'Telegram popup message must be 180 characters or fewer.' }); return; }
    const values = { telegram_url: telegramUrl, telegram_popup_message: telegramPopupMessage, support_email: supportEmail, live_chat_enabled: input.liveChatEnabled ? '1' : '0' };
    const saveSetting = database.prepare('INSERT INTO support_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at');
    for (const [key, value] of Object.entries(values)) saveSetting.run(key, value, now());
    sendJson(response, 200, { telegramUrl: values.telegram_url, telegramPopupMessage: values.telegram_popup_message, supportEmail: values.support_email, liveChatEnabled: values.live_chat_enabled === '1' }); return;
  }
  if (path === '/api/admin/audit-log' && method === 'GET') {
    if (!isAdmin(request)) { sendJson(response, 401, { error: 'Admin authentication required.' }); return; }
    const walletEntries = database.prepare('SELECT id, transaction_id AS targetUserId, actor_id AS adminUserId, action, details AS metadata, created_at AS createdAt FROM wallet_audit_logs ORDER BY created_at DESC LIMIT 200').all();
    const accountEntries = database.prepare('SELECT id, target_user_id AS targetUserId, admin_user_id AS adminUserId, action, metadata, created_at AS createdAt FROM admin_audit_log ORDER BY created_at DESC LIMIT 200').all();
    const entries = [...walletEntries, ...accountEntries].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 200);
    sendJson(response, 200, { entries }); return;
  }
  if (path === '/api/wallet/products' && method === 'GET') {
    settleDueProductIncome();
    const currency = currencyForUser(user.id);
    const products = database.prepare(`SELECT p.id, p.product_name AS name, p.qualifying_amount AS amount, p.display_amount AS displayAmount,
      p.currency_code AS currencyCode, p.status, p.reference, coalesce(p.approved_at, p.created_at) AS purchasedAt,
      p.daily_income_snapshot AS dailyIncome, p.duration_days_snapshot AS durationDays, count(i.income_day) AS incomePaidDays,
      CASE WHEN p.daily_income_snapshot > 0 AND count(i.income_day) < p.duration_days_snapshot
        THEN strftime('%Y-%m-%dT%H:%M:%fZ', datetime(coalesce(p.approved_at, p.created_at), printf('+%d days', count(i.income_day) + 1)))
        ELSE NULL END AS nextIncomeAt
      FROM product_purchases p LEFT JOIN product_income_ledger i ON i.purchase_id = p.id
      WHERE p.user_id = ? AND p.status = 'COMPLETED'
      GROUP BY p.id ORDER BY coalesce(p.approved_at, p.created_at) DESC`).all(user.id);
    for (const product of products) {
      product.displayAmount = product.displayAmount || localAmount(product.amount, currency);
      product.currencyCode = product.currencyCode || currency.currencyCode;
      product.displayDailyIncome = localAmount(product.dailyIncome, currency);
    }
    sendJson(response, 200, { products }); return;
  }
  if (path === '/api/wallet/daily-checkin' && method === 'GET') {
    const checkinDate = new Date().toISOString().slice(0, 10);
    const enabled = setting('daily_checkin_enabled') === '1';
    const rewardAmount = Number(setting('daily_checkin_reward_amount')) || 0;
    const claim = database.prepare('SELECT reward_amount AS rewardAmount, created_at AS claimedAt FROM daily_checkins WHERE user_id = ? AND checkin_date = ?').get(user.id, checkinDate);
    const currency = currencyForUser(user.id);
    sendJson(response, 200, { enabled, rewardAmount, displayRewardAmount: localAmount(rewardAmount, currency), currencyCode: currency.currencyCode, claimed: Boolean(claim), claimedAt: claim?.claimedAt ?? null }); return;
  }
  if (path === '/api/wallet/daily-checkin' && method === 'POST') {
    const checkinDate = new Date().toISOString().slice(0, 10);
    const enabled = setting('daily_checkin_enabled') === '1';
    const rewardAmount = Number(setting('daily_checkin_reward_amount')) || 0;
    if (!enabled || !Number.isSafeInteger(rewardAmount) || rewardAmount <= 0) { sendJson(response, 403, { error: 'Daily check-in is currently unavailable.' }); return; }
    database.exec('BEGIN IMMEDIATE');
    try {
      database.prepare('INSERT INTO daily_checkins (user_id, checkin_date, reward_amount) VALUES (?, ?, ?)').run(user.id, checkinDate, rewardAmount);
      database.prepare('UPDATE wallet_accounts SET available_balance = available_balance + ?, updated_at = ? WHERE user_id = ?').run(rewardAmount, now(), user.id);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      if (error.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint failed: daily_checkins\.user_id, daily_checkins\.checkin_date/.test(error.message)) { sendJson(response, 409, { error: 'Daily check-in has already been claimed today.' }); return; }
      throw error;
    }
    const currency = currencyForUser(user.id);
    sendJson(response, 201, { claimed: true, rewardAmount, displayRewardAmount: localAmount(rewardAmount, currency), currencyCode: currency.currencyCode, checkinDate, balance: walletBalanceView(user.id) }); return;
  }
  if (path === '/api/admin/deposit-methods' && method === 'GET') {
    if (!isAdmin(request)) { sendJson(response, 401, { error: 'Admin authentication required.' }); return; }
    const rows = database.prepare('SELECT * FROM deposit_methods ORDER BY position, name').all();
    sendJson(response, 200, { methods: rows.map((row) => depositMethodView(row)), maximumMethods: maxDepositMethods }); return;
  }
  if (path === '/api/admin/deposit-methods' && method === 'POST') {
    if (!isAdmin(request)) { sendJson(response, 401, { error: 'Admin authentication required.' }); return; }
    const input = await readBody(request); const parsed = parseDepositMethod(input);
    if (parsed.error) { sendJson(response, 400, { error: parsed.error }); return; }
    const countryCode = parsed.value.countryCode;
    if (database.prepare('SELECT count(*) AS count FROM deposit_methods WHERE country_code = ?').get(countryCode).count >= maxDepositMethods) { sendJson(response, 409, { error: `You can configure up to ${maxDepositMethods} deposit methods for ${countryCode}.` }); return; }
    const id = `DEP-${randomUUID()}`; const item = parsed.value;
    database.prepare('INSERT INTO deposit_methods (code, name, enabled, provider, account_name, account_number, instructions, ussd_template, minimum_amount, maximum_amount, logo_data, position, updated_at, country_code, cross_border_enabled, receiving_country_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, item.name, item.enabled, 'ADMIN_REVIEW', item.accountName, item.accountNumber, item.instructions, item.ussdTemplate, item.minimumAmount, item.maximumAmount, item.logoData, item.position, now(), item.countryCode, item.crossBorderEnabled, item.receivingCountryCode);
    sendJson(response, 201, { method: depositMethodView(database.prepare('SELECT * FROM deposit_methods WHERE code = ?').get(id)) }); return;
  }
  const adminDepositMethod = path.match(/^\/api\/admin\/deposit-methods\/([^/]+)$/);
  if (adminDepositMethod && method === 'PUT') {
    if (!isAdmin(request)) { sendJson(response, 401, { error: 'Admin authentication required.' }); return; }
    if (!database.prepare('SELECT code FROM deposit_methods WHERE code = ?').get(adminDepositMethod[1])) { sendJson(response, 404, { error: 'Deposit method not found.' }); return; }
    const input = await readBody(request); const parsed = parseDepositMethod(input);
    if (parsed.error) { sendJson(response, 400, { error: parsed.error }); return; }
    const item = parsed.value;
    const countryCount = database.prepare('SELECT count(*) AS count FROM deposit_methods WHERE country_code = ? AND code <> ?').get(item.countryCode, adminDepositMethod[1]).count;
    if (countryCount >= maxDepositMethods) { sendJson(response, 409, { error: `You can configure up to ${maxDepositMethods} deposit methods for ${item.countryCode}.` }); return; }
    database.prepare('UPDATE deposit_methods SET name = ?, enabled = ?, account_name = ?, account_number = ?, instructions = ?, ussd_template = ?, minimum_amount = ?, maximum_amount = ?, logo_data = ?, position = ?, updated_at = ?, country_code = ?, cross_border_enabled = ?, receiving_country_code = ? WHERE code = ?').run(item.name, item.enabled, item.accountName, item.accountNumber, item.instructions, item.ussdTemplate, item.minimumAmount, item.maximumAmount, item.logoData, item.position, now(), item.countryCode, item.crossBorderEnabled, item.receivingCountryCode, adminDepositMethod[1]);
    sendJson(response, 200, { method: depositMethodView(database.prepare('SELECT * FROM deposit_methods WHERE code = ?').get(adminDepositMethod[1])) }); return;
  }
  if (adminDepositMethod && method === 'DELETE') {
    if (!isAdmin(request)) { sendJson(response, 401, { error: 'Admin authentication required.' }); return; }
    const result = database.prepare('DELETE FROM deposit_methods WHERE code = ?').run(adminDepositMethod[1]);
    if (!result.changes) { sendJson(response, 404, { error: 'Deposit method not found.' }); return; }
    sendJson(response, 200, { deleted: true }); return;
  }
  if (path === '/api/deposit-methods' && method === 'GET') {
    const currency = currencyForUser(user.id);
    const rows = database.prepare("SELECT * FROM deposit_methods WHERE country_code = ? AND enabled = 1 AND trim(account_name) <> '' AND trim(account_number) <> '' ORDER BY position, name").all(currency.countryCode);
    sendJson(response, 200, { methods: rows.map((row) => depositMethodView(row, currency)), currencyCode: currency.currencyCode }); return;
  }
  if (path === '/api/dashboard' && method === 'GET') { const currency = currencyForUser(user.id); const metrics = user.permissions.dashboard ? database.prepare('SELECT label, value, detail, tone FROM dashboard_metrics ORDER BY position, label').all() : []; const plans = user.permissions.products && currency.enabled ? database.prepare("SELECT * FROM plans WHERE total_slots > 0 AND status = 'Active' ORDER BY position, name").all().map((plan) => localizedPlanView(plan, currency)) : []; const referrals = user.permissions.myTeam ? database.prepare('SELECT person, joined, contribution, commission, status FROM referrals ORDER BY position, person').all() : []; const tools = user.permissions.support ? database.prepare('SELECT name, value, state FROM support_tools ORDER BY position, name').all() : []; sendJson(response, 200, { metrics, plans, referrals, tools, countryCode: currency.countryCode, currencyCode: currency.currencyCode, exchangeRate: currency.unitsPerRwf }); return; }
    if (path === '/api/admin/platform-settings' && method === 'GET') {
      if (!isAdmin(request)) { sendJson(response, 401, { error: 'Admin authentication required.' }); return; }
      sendJson(response, 200, platformSettings()); return;
    }
    if (path === '/api/admin/platform-settings' && method === 'PUT') {
      if (!isAdmin(request)) { sendJson(response, 401, { error: 'Admin authentication required.' }); return; }
      const input = await readBody(request);
      const feeType = input.withdrawalFeeType;
      const feeValue = Number(input.withdrawalFeeValue);
      const welcomeAmount = Number(input.welcomeBonusAmount);
      if (typeof input.withdrawalFeeEnabled !== 'boolean' || !['PERCENTAGE', 'FIXED'].includes(feeType) || !Number.isFinite(feeValue) || feeValue < 0 || (feeType === 'PERCENTAGE' && feeValue > 100) || (feeType === 'FIXED' && !Number.isSafeInteger(feeValue))) { sendJson(response, 400, { error: 'Enter a valid withdrawal fee type and value.' }); return; }
      if (typeof input.welcomeBonusEnabled !== 'boolean' || !Number.isSafeInteger(welcomeAmount) || welcomeAmount < 0) { sendJson(response, 400, { error: 'Enter a valid welcome bonus amount.' }); return; }
      const values = {
        withdrawal_fee_enabled: input.withdrawalFeeEnabled ? '1' : '0',
        withdrawal_fee_type: feeType,
        withdrawal_fee_value: String(feeValue),
        welcome_bonus_enabled: input.welcomeBonusEnabled ? '1' : '0',
        welcome_bonus_amount: String(welcomeAmount),
      };
      const saveSetting = database.prepare('INSERT INTO support_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at');
      database.exec('BEGIN IMMEDIATE');
      try {
        for (const [key, value] of Object.entries(values)) saveSetting.run(key, value, now());
        database.exec('COMMIT');
      } catch (error) { database.exec('ROLLBACK'); throw error; }
      sendJson(response, 200, platformSettings()); return;
    }
  if (path === '/api/wallet/balance' && method === 'GET') { settleDueProductIncome(); sendJson(response, 200, walletBalanceView(demoUserId)); return; }
  if (path === '/api/wallet/withdraw/account' && method === 'GET') { sendJson(response, 200, { account: withdrawalAccountFor(demoUserId) }); return; }
  if (path === '/api/wallet/withdraw/account' && method === 'PUT') {
    const input = await readBody(request);
    const accountHolderName = String(input.accountHolderName ?? '').trim().slice(0, 120);
    const phoneNumber = String(input.phoneNumber ?? '').replace(/[\s-]/g, '');
    const paymentMethod = input.paymentMethod;
    if (!accountHolderName || !validPhone(phoneNumber, user.countryCode) || !validMethod(paymentMethod) || !methodEnabled('withdrawal', paymentMethod, user.countryCode)) { sendJson(response, 400, { error: 'Choose a payment method enabled for your country and enter a valid phone number.' }); return; }
    database.prepare("INSERT INTO withdrawal_accounts (user_id, account_holder_name, phone_number, payment_method, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET account_holder_name = excluded.account_holder_name, phone_number = excluded.phone_number, payment_method = excluded.payment_method, updated_at = excluded.updated_at").run(demoUserId, accountHolderName, phoneNumber, paymentMethod, now());
    sendJson(response, 200, { account: withdrawalAccountFor(demoUserId) }); return;
  }
  if (path === '/api/wallet/transactions' && method === 'GET') { const rows = database.prepare('SELECT * FROM wallet_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').all(demoUserId); sendJson(response, 200, { transactions: rows.map(transactionView) }); return; }
  if (path === '/api/team' && method === 'GET') {
    const levels = database.prepare(`WITH RECURSIVE team(userId, sponsorUserId, level, joinedAt) AS (
      SELECT r.user_id, r.sponsor_user_id, 1, r.created_at FROM referral_relationships r WHERE r.sponsor_user_id = ?
      UNION ALL
      SELECT r.user_id, r.sponsor_user_id, team.level + 1, r.created_at FROM referral_relationships r JOIN team ON r.sponsor_user_id = team.userId WHERE team.level < 3
    )
    SELECT team.userId, team.sponsorUserId, team.joinedAt, team.level, u.full_name AS displayName, u.phone_number AS phoneNumber,
      (SELECT count(*) FROM product_purchases p WHERE p.user_id = team.userId AND p.status = 'COMPLETED') AS qualifyingProducts,
      (SELECT coalesce(sum(c.commission_amount), 0) FROM commission_ledger c WHERE c.beneficiary_user_id = ? AND c.source_user_id = team.userId AND c.status = 'APPROVED') AS commissionEarned
    FROM team JOIN users u ON u.id = team.userId ORDER BY team.level, team.joinedAt DESC`).all(user.id, user.id).map((member) => ({ ...member, activeReferral: member.qualifyingProducts > 0 }));
    const commissions = database.prepare(`SELECT c.id, c.source_user_id AS sourceUserId, source.full_name AS sourceUserName, c.product_id AS productId, c.purchase_id AS purchaseId, c.referral_level AS referralLevel, c.percentage, c.qualifying_amount AS qualifyingAmount, c.commission_amount AS commissionAmount, c.status, c.created_at AS createdAt, c.approved_at AS approvedAt, c.reference FROM commission_ledger c JOIN users source ON source.id = c.source_user_id WHERE c.beneficiary_user_id = ? ORDER BY c.created_at DESC`).all(user.id);
    const commissionSummary = database.prepare(`SELECT coalesce(sum(CASE WHEN status = 'PENDING' THEN commission_amount ELSE 0 END), 0) AS pendingCommission, coalesce(sum(CASE WHEN status = 'APPROVED' AND credited_at IS NOT NULL THEN commission_amount ELSE 0 END), 0) AS creditedCommission FROM commission_ledger WHERE beneficiary_user_id = ?`).get(user.id);
    const commissionUsage = database.prepare(`SELECT coalesce(sum(CASE WHEN status = 'SUCCESS' THEN commission_amount ELSE 0 END), 0) AS withdrawnCommission, coalesce(sum(CASE WHEN status NOT IN ('REJECTED', 'FAILED', 'CANCELLED', 'SUCCESS') THEN commission_amount ELSE 0 END), 0) AS reservedCommission FROM wallet_transactions WHERE user_id = ? AND type = 'WITHDRAWAL'`).get(user.id);
    const availableCommission = Math.max(0, commissionSummary.creditedCommission - commissionUsage.withdrawnCommission - commissionUsage.reservedCommission);
    const totalCommission = commissionSummary.creditedCommission + commissionSummary.pendingCommission;
    const settings = database.prepare('SELECT level, percentage FROM referral_settings ORDER BY level').all();
    const host = request.headers['x-forwarded-host'] ?? request.headers.host ?? 'localhost';
    const protocol = request.headers['x-forwarded-proto'] ?? 'http';
    const activeReferrals = levels.filter((member) => member.activeReferral).length;
    const currency = currencyForUser(user.id);
    const localizedCommissions = commissions.map((commission) => ({ ...commission, displayQualifyingAmount: localAmount(commission.qualifyingAmount, currency), displayCommissionAmount: localAmount(commission.commissionAmount, currency), currencyCode: currency.currencyCode }));
    const localizedLevels = levels.map((member) => ({ ...member, displayCommissionEarned: localAmount(member.commissionEarned, currency), currencyCode: currency.currencyCode }));
    sendJson(response, 200, { referralCode: user.referralCode, referralLink: `${protocol}://${host}/register?ref=${encodeURIComponent(user.referralCode)}`, levels: localizedLevels, settings, commissions: localizedCommissions, activeReferrals, pendingCommission: commissionSummary.pendingCommission, displayPendingCommission: localAmount(commissionSummary.pendingCommission, currency), availableCommission, displayAvailableCommission: localAmount(availableCommission, currency), withdrawnCommission: commissionUsage.withdrawnCommission, displayWithdrawnCommission: localAmount(commissionUsage.withdrawnCommission, currency), earnings: totalCommission, displayEarnings: localAmount(totalCommission, currency), countryCode: currency.countryCode, currencyCode: currency.currencyCode, exchangeRate: currency.unitsPerRwf }); return;
  }
  if (path === '/api/support/settings' && method === 'GET') { sendJson(response, 200, { telegramUrl: user.permissions.telegram ? setting('telegram_url') : '', telegramPopupMessage: user.permissions.telegram ? setting('telegram_popup_message') : '', supportEmail: setting('support_email'), liveChatEnabled: setting('live_chat_enabled') === '1' }); return; }
  if (path === '/api/team' && method === 'GET') { const rows = database.prepare('SELECT r.user_id AS userId, r.sponsor_user_id AS sponsorUserId, r.created_at AS joinedAt, u.full_name AS displayName, u.phone_number AS phoneNumber FROM referral_relationships r JOIN users u ON u.id = r.user_id').all(); const levels = rows.map((member) => { let depth = 1; let current = member.sponsorUserId; while (current !== user.id && depth <= 3) { const parent = database.prepare('SELECT sponsor_user_id AS sponsorUserId FROM referral_relationships WHERE user_id = ?').get(current); if (!parent) return null; current = parent.sponsorUserId; depth += 1; } if (current !== user.id || depth > 3) return null; const purchaseStats = database.prepare("SELECT count(*) AS productCount, coalesce(sum(qualifying_amount), 0) AS qualifyingAmount FROM product_purchases WHERE user_id = ? AND status = 'COMPLETED'").get(member.userId); const earned = database.prepare('SELECT coalesce(sum(commission_amount), 0) AS amount FROM commission_ledger WHERE beneficiary_user_id = ? AND source_user_id = ?').get(user.id, member.userId); return { ...member, level: depth, maskedPhone: mask(member.phoneNumber), qualifyingProducts: purchaseStats.productCount, qualifyingAmount: purchaseStats.qualifyingAmount, commissionEarned: earned.amount }; }).filter(Boolean); const commissions = database.prepare('SELECT * FROM commission_ledger WHERE beneficiary_user_id = ? ORDER BY created_at DESC').all(user.id); const settings = database.prepare('SELECT level, percentage FROM referral_settings ORDER BY level').all(); const earnings = commissions.reduce((total, item) => total + item.commission_amount, 0); const host = request.headers['x-forwarded-host'] ?? request.headers.host ?? 'localhost'; const protocol = request.headers['x-forwarded-proto'] ?? 'http'; sendJson(response, 200, { referralCode: user.referralCode, referralLink: `${protocol}://${host}/register?ref=${encodeURIComponent(user.referralCode)}`, levels, settings, commissions: commissions.map((item) => ({ id: item.id, sourceUserId: item.source_user_id, productId: item.product_id, purchaseId: item.purchase_id, referralLevel: item.referral_level, percentage: item.percentage, qualifyingAmount: item.qualifying_amount, commissionAmount: item.commission_amount, status: item.status, createdAt: item.created_at, approvedAt: item.approved_at, reference: item.reference })), earnings }); return; }
  if (path === '/api/support/conversations' && method === 'GET') { const rows = database.prepare('SELECT * FROM support_conversations WHERE user_id = ? ORDER BY updated_at DESC').all(demoUserId); sendJson(response, 200, { conversations: rows }); return; }
  if (path === '/api/support/conversations' && method === 'POST') { const id = randomUUID(); database.prepare('INSERT INTO support_conversations (id, user_id) VALUES (?, ?)').run(id, demoUserId); sendJson(response, 201, { conversation: database.prepare('SELECT * FROM support_conversations WHERE id = ?').get(id) }); return; }
  if (path === '/api/team' && method === 'GET') { const rows = database.prepare('SELECT r.user_id AS userId, r.sponsor_user_id AS sponsorUserId, r.created_at AS joinedAt, u.full_name AS displayName, u.phone_number AS phoneNumber FROM referral_relationships r JOIN users u ON u.id = r.user_id').all(); const levels = rows.map((member) => { let depth = 1; let current = member.sponsorUserId; while (current !== user.id && depth <= 3) { const parent = database.prepare('SELECT sponsor_user_id AS sponsorUserId FROM referral_relationships WHERE user_id = ?').get(current); if (!parent) return null; current = parent.sponsorUserId; depth += 1; } if (current !== user.id || depth > 3) return null; const products = database.prepare("SELECT count(*) AS count, coalesce(sum(qualifying_amount), 0) AS amount FROM product_purchases WHERE user_id = ? AND status = 'COMPLETED'").get(member.userId); const commissionsForMember = database.prepare('SELECT coalesce(sum(commission_amount), 0) AS amount FROM commission_ledger WHERE beneficiary_user_id = ? AND source_user_id = ?').get(user.id, member.userId); return { ...member, maskedPhone: mask(member.phoneNumber), level: depth, qualifyingProducts: products.count, qualifyingAmount: products.amount, commissionEarned: commissionsForMember.amount }; }).filter(Boolean); const commissions = database.prepare('SELECT id, source_user_id AS sourceUserId, product_id AS productId, purchase_id AS purchaseId, referral_level AS referralLevel, percentage, qualifying_amount AS qualifyingAmount, commission_amount AS commissionAmount, status, created_at AS createdAt, approved_at AS approvedAt, reference FROM commission_ledger WHERE beneficiary_user_id = ? ORDER BY created_at DESC').all(user.id); const settings = database.prepare('SELECT level, percentage FROM referral_settings ORDER BY level').all(); const earnings = commissions.reduce((total, item) => total + item.commissionAmount, 0); const origin = `${request.headers['x-forwarded-proto'] ?? 'http'}://${request.headers['x-forwarded-host'] ?? request.headers.host ?? 'localhost'}`; sendJson(response, 200, { referralCode: user.referralCode, referralLink: `${origin}/register?ref=${encodeURIComponent(user.referralCode)}`, levels, settings, commissions, earnings }); return; }
  const conversation = path.match(/^\/api\/support\/conversations\/([^/]+)\/messages$/); if (conversation && method === 'GET') { const owner = database.prepare('SELECT id FROM support_conversations WHERE id = ? AND user_id = ?').get(conversation[1], demoUserId); if (!owner) { sendJson(response, 404, { error: 'Conversation not found.' }); return; } sendJson(response, 200, { messages: database.prepare('SELECT id, author_id AS authorId, body, created_at AS createdAt FROM support_messages WHERE conversation_id = ? ORDER BY created_at').all(conversation[1]) }); return; }
  if (path === '/api/team' && method === 'GET') { const rows = database.prepare('SELECT r.user_id AS userId, r.sponsor_user_id AS sponsorUserId, r.created_at AS joinedAt, u.full_name AS displayName, u.phone_number AS phoneNumber FROM referral_relationships r JOIN users u ON u.id = r.user_id').all(); const levels = rows.map((member) => { let depth = 1; let current = member.sponsorUserId; while (current !== user.id && depth <= 3) { const parent = database.prepare('SELECT sponsor_user_id AS sponsorUserId FROM referral_relationships WHERE user_id = ?').get(current); if (!parent) return null; current = parent.sponsorUserId; depth += 1; } if (current !== user.id || depth > 3) return null; return { ...member, level: depth, displayName: member.displayName, maskedPhone: mask(member.phoneNumber) }; }).filter(Boolean); const commissions = database.prepare('SELECT id, source_user_id AS sourceUserId, product_id AS productId, purchase_id AS purchaseId, referral_level AS referralLevel, percentage, qualifying_amount AS qualifyingAmount, commission_amount AS commissionAmount, status, created_at AS createdAt, approved_at AS approvedAt, reference FROM commission_ledger WHERE beneficiary_user_id = ? ORDER BY created_at DESC').all(user.id); const settings = database.prepare('SELECT level, percentage FROM referral_settings ORDER BY level').all(); const earnings = commissions.reduce((total, item) => total + item.commissionAmount, 0); const origin = process.env.PUBLIC_APP_URL ?? request.headers.origin ?? 'http://localhost:5174'; sendJson(response, 200, { referralCode: user.referralCode, referralLink: `${origin}/register?ref=${encodeURIComponent(user.referralCode)}`, chain: referralChain(user.id), levels, settings, commissions, earnings }); return; }
  if (conversation && method === 'POST') { const owner = database.prepare('SELECT id FROM support_conversations WHERE id = ? AND user_id = ?').get(conversation[1], demoUserId); const input = await readBody(request); if (!owner || !String(input.body ?? '').trim()) { sendJson(response, 400, { error: 'Conversation and message are required.' }); return; } const id = randomUUID(); database.prepare('INSERT INTO support_messages (id, conversation_id, author_id, body) VALUES (?, ?, ?, ?)').run(id, conversation[1], demoUserId, String(input.body).trim().slice(0, 2000)); database.prepare('UPDATE support_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(conversation[1]); sendJson(response, 201, { message: database.prepare('SELECT id, author_id AS authorId, body, created_at AS createdAt FROM support_messages WHERE id = ?').get(id) }); return; }
  if (path === '/api/team' && method === 'GET') { const code = demoUserId; const members = database.prepare('SELECT r.user_id AS userId, r.sponsor_user_id AS sponsorUserId, r.created_at AS joinedAt FROM referral_relationships r').all(); const levels = members.map((member) => { let level = 1; let current = member.sponsorUserId; while (current !== demoUserId && level < 3) { const parent = database.prepare('SELECT sponsor_user_id AS sponsorUserId FROM referral_relationships WHERE user_id = ?').get(current); if (!parent) return null; current = parent.sponsorUserId; level += 1; } return current === demoUserId ? { ...member, level, displayName: member.userId } : null; }).filter(Boolean); const commissions = database.prepare('SELECT id, source_user_id AS sourceUserId, product_id AS productId, purchase_id AS purchaseId, referral_level AS referralLevel, percentage, qualifying_amount AS qualifyingAmount, commission_amount AS commissionAmount, status, created_at AS createdAt, approved_at AS approvedAt, reference FROM commission_ledger WHERE beneficiary_user_id = ? ORDER BY created_at DESC').all(demoUserId); const settings = database.prepare('SELECT level, percentage FROM referral_settings ORDER BY level').all(); const earnings = commissions.reduce((total, item) => total + item.commissionAmount, 0); sendJson(response, 200, { referralCode: code, referralLink: `/?ref=${encodeURIComponent(code)}`, chain: referralChain(demoUserId), levels, settings, commissions, earnings }); return; }
  if (path === '/api/purchases' && method === 'POST') {
    const input = await readBody(request);
    const purchaseCurrency = currencyForUser(demoUserId);
    const productId = String(input.productId ?? '').trim();
    if (!productId) { sendJson(response, 400, { error: 'Choose a product to purchase.' }); return; }
    const idempotencyKey = String(input.idempotencyKey ?? request.headers['idempotency-key'] ?? '').trim();
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) { sendJson(response, 400, { error: 'A valid purchase idempotency key is required.' }); return; }
    const id = randomUUID();
    const reference = `PUR-${randomUUID()}`;
    database.exec('BEGIN IMMEDIATE');
    try {
      if (idempotencyKey) {
        const existing = database.prepare('SELECT * FROM product_purchases WHERE user_id = ? AND idempotency_key = ?').get(demoUserId, idempotencyKey);
        if (existing) {
          if (existing.product_name !== productId) throw new Error('This idempotency key was already used for another product.');
          const existingPlan = database.prepare('SELECT * FROM plans WHERE name = ?').get(existing.product_name);
          database.exec('COMMIT');
          sendJson(response, 200, { purchase: existing, product: existingPlan ? localizedPlanView(existingPlan, purchaseCurrency) : null, balance: walletBalanceView(demoUserId), idempotentReplay: true });
          return;
        }
      }
      if (database.prepare("SELECT id FROM product_purchases WHERE user_id = ? AND product_name = ? AND status IN ('PENDING', 'APPROVED', 'COMPLETED') LIMIT 1").get(demoUserId, productId)) {
        throw new Error('You already purchased this product. Choose a different product.');
      }
      const product = database.prepare('SELECT * FROM plans WHERE name = ?').get(productId);
      if (!product || product.total_slots <= 0) throw new Error('Product is not available.');
      if (product.status !== 'Active') throw new Error('This product is not currently available for purchase.');
      if (product.sold_slots >= product.total_slots) throw new Error('This product is sold out.');
      const account = getAccount();
      if (!account || account.availableBalance < product.price) throw new Error('Insufficient available balance for this product.');
      const nextSoldSlots = product.sold_slots + 1;
      const charge = database.prepare('UPDATE wallet_accounts SET available_balance = available_balance - ?, updated_at = ? WHERE user_id = ? AND available_balance >= ?').run(product.price, now(), demoUserId, product.price);
      if (!charge.changes) throw new Error('Insufficient available balance for this product.');
      database.prepare('INSERT INTO product_purchases (id, user_id, product_name, qualifying_amount, status, reference, product_id, description_snapshot, image_snapshot, daily_income_snapshot, duration_days_snapshot, purchase_bonus_snapshot, total_slots_snapshot, idempotency_key, country_code, currency_code, exchange_rate, display_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, demoUserId, product.name, product.price, 'COMPLETED', reference, product.name, product.description, product.image_data, product.daily_income, product.duration_days, 0, product.total_slots, idempotencyKey, purchaseCurrency.countryCode, purchaseCurrency.currencyCode, purchaseCurrency.unitsPerRwf, localAmount(product.price, purchaseCurrency));
      const inventory = database.prepare('UPDATE plans SET sold_slots = ? WHERE name = ? AND sold_slots < total_slots').run(nextSoldSlots, product.name);
      if (!inventory.changes) throw new Error('This product is sold out.');
      createCommissions({ id, user_id: demoUserId, product_name: product.name, qualifying_amount: product.price });
      unlockWelcomeBonus(demoUserId);
      database.exec('COMMIT');
      const purchase = database.prepare('SELECT * FROM product_purchases WHERE id = ?').get(id);
      sendJson(response, 201, { purchase, product: localizedPlanView(database.prepare('SELECT * FROM plans WHERE name = ?').get(product.name), purchaseCurrency), balance: walletBalanceView(demoUserId) });
    } catch (error) {
      database.exec('ROLLBACK');
      sendJson(response, 400, { error: error.message });
    }
    return;
  }
  const purchaseApproval = path.match(/^\/api\/admin\/purchases\/([^/]+)\/approve$/); if (purchaseApproval && method === 'POST') { if (!isAdmin(request)) { sendJson(response, 401, { error: 'Admin authentication required.' }); return; } database.exec('BEGIN IMMEDIATE'); try { const purchase = database.prepare('SELECT * FROM product_purchases WHERE id = ?').get(purchaseApproval[1]); if (!purchase) throw new Error('Purchase not found.'); if (purchase.status !== 'PENDING') { database.exec('ROLLBACK'); sendJson(response, 200, { purchase }); return; } database.prepare('UPDATE product_purchases SET status = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ? AND status = ?').run('COMPLETED', purchase.id, 'PENDING'); createCommissions({ ...purchase, status: 'COMPLETED' }); unlockWelcomeBonus(purchase.user_id); database.exec('COMMIT'); sendJson(response, 200, { purchase: database.prepare('SELECT * FROM product_purchases WHERE id = ?').get(purchase.id) }); } catch (error) { database.exec('ROLLBACK'); sendJson(response, 400, { error: error.message }); } return; }
  if (path === '/api/admin/referral-settings' && method === 'GET') { if (!isAdmin(request)) { sendJson(response, 401, { error: 'Admin authentication required.' }); return; } sendJson(response, 200, { settings: database.prepare('SELECT level, percentage FROM referral_settings ORDER BY level').all() }); return; }
  if (path === '/api/admin/referral-settings' && method === 'POST') { if (!isAdmin(request)) { sendJson(response, 401, { error: 'Admin authentication required.' }); return; } const input = await readBody(request); const level = Number(input.level); const percentage = Number(input.percentage); if (![1, 2, 3].includes(level) || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) { sendJson(response, 400, { error: 'Level must be 1-3 and percentage must be between 0 and 100.' }); return; } database.prepare('UPDATE referral_settings SET percentage = ?, updated_at = CURRENT_TIMESTAMP WHERE level = ?').run(percentage, level); sendJson(response, 200, { settings: database.prepare('SELECT level, percentage FROM referral_settings ORDER BY level').all() }); return; }
  if (path === '/api/admin/payment-methods' && method === 'GET') { if (!isAdmin(request)) { sendJson(response, 401, { error: 'Admin authentication required.' }); return; } sendJson(response, 200, { withdrawals: database.prepare('SELECT * FROM withdrawal_methods').all() }); return; }
  if (path === '/api/admin/payment-methods' && method === 'POST') { if (!isAdmin(request)) { sendJson(response, 401, { error: 'Admin authentication required.' }); return; } const input = await readBody(request); if (input.type !== 'withdrawal' || !validMethod(input.code)) { sendJson(response, 400, { error: 'Use the deposit-specific settings endpoint for deposit methods.' }); return; } database.prepare('UPDATE withdrawal_methods SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE code = ?').run(input.enabled ? 1 : 0, input.code); sendJson(response, 200, { updated: true }); return; }
  if (path === '/api/admin/support/conversations' && method === 'GET') { if (!isAdmin(request)) { sendJson(response, 401, { error: 'Admin authentication required.' }); return; } sendJson(response, 200, { conversations: database.prepare('SELECT * FROM support_conversations ORDER BY updated_at DESC').all() }); return; }
  const adminConversationMessages = path.match(/^\/api\/admin\/support\/conversations\/([^/]+)\/messages$/);
  if (adminConversationMessages && method === 'GET') { if (!isAdmin(request)) { sendJson(response, 401, { error: 'Admin authentication required.' }); return; } const conversation = database.prepare('SELECT id FROM support_conversations WHERE id = ?').get(adminConversationMessages[1]); if (!conversation) { sendJson(response, 404, { error: 'Conversation not found.' }); return; } const messages = database.prepare('SELECT id, author_id AS authorId, body, created_at AS createdAt FROM support_messages WHERE conversation_id = ? ORDER BY created_at').all(conversation.id); sendJson(response, 200, { messages }); return; }
  if (adminConversationMessages && method === 'POST') { if (!isAdmin(request)) { sendJson(response, 401, { error: 'Admin authentication required.' }); return; } const conversation = database.prepare('SELECT id FROM support_conversations WHERE id = ?').get(adminConversationMessages[1]); const input = await readBody(request); const body = String(input.body ?? '').trim(); if (!conversation || !body) { sendJson(response, 400, { error: 'Conversation and message are required.' }); return; } const id = randomUUID(); const authorId = currentUser(request)?.id ?? 'ADMIN'; database.prepare('INSERT INTO support_messages (id, conversation_id, author_id, body) VALUES (?, ?, ?, ?)').run(id, conversation.id, authorId, body.slice(0, 2000)); database.prepare('UPDATE support_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(conversation.id); const message = database.prepare('SELECT id, author_id AS authorId, body, created_at AS createdAt FROM support_messages WHERE id = ?').get(id); sendJson(response, 201, { message }); return; }
  if (path === '/api/admin/purchases' && method === 'GET') { if (!isAdmin(request)) { sendJson(response, 401, { error: 'Admin authentication required.' }); return; } sendJson(response, 200, { purchases: database.prepare('SELECT * FROM product_purchases ORDER BY created_at DESC').all(), commissions: database.prepare('SELECT * FROM commission_ledger ORDER BY created_at DESC').all() }); return; }
  if (path === '/api/wallet/deposit/methods' && method === 'GET') { const currency = currencyForUser(user.id); const rows = database.prepare("SELECT * FROM deposit_methods WHERE country_code = ? AND enabled = 1 AND trim(account_name) <> '' AND trim(account_number) <> '' ORDER BY position, name").all(user.countryCode); sendJson(response, 200, { methods: rows.map((row) => depositMethodView(row, currency)), currencyCode: currency.currencyCode }); return; }
  if (path === '/api/wallet/withdraw/methods' && method === 'GET') { sendJson(response, 200, { methods: database.prepare('SELECT m.code, m.name FROM withdrawal_methods m JOIN country_withdrawal_methods c ON c.method_code = m.code WHERE m.enabled = 1 AND c.enabled = 1 AND c.country_code = ? ORDER BY m.name').all(user.countryCode) }); return; }
  if (path === '/api/wallet/deposit' && method === 'POST') {
    const input = await readBody(request);
    const currency = currencyForUser(user.id);
    const displayAmount = amountOf(input.amount);
    const amount = displayAmount ? baseAmount(displayAmount, currency) : null;
    const phoneNumber = String(input.phoneNumber ?? '').replace(/[\s-]/g, '');
    const senderName = String(input.senderName ?? '').trim().slice(0, 120);
    const depositMethodId = String(input.depositMethodId ?? '').trim();
    const screenshotData = input.screenshotData;
    const depositMethod = depositMethodId ? database.prepare('SELECT * FROM deposit_methods WHERE code = ? AND country_code = ? AND enabled = 1').get(depositMethodId, user.countryCode) : null;
    if (!amount || !displayAmount || !validPhone(phoneNumber, user.countryCode) || !senderName || !depositMethod || !depositMethod.account_name.trim() || !depositMethod.account_number.trim() || !imageDataValid(screenshotData, maxScreenshotBytes)) {
      sendJson(response, 400, { error: 'Choose an active payment method for your country, enter a valid amount, phone number and payer name, and attach a PNG, JPEG, or WebP payment screenshot (max 4 MB).' }); return;
    }
    const minimumDisplayAmount = localAmount(depositMethod.minimum_amount, currency);
    const maximumDisplayAmount = localAmount(depositMethod.maximum_amount, currency);
    if (amount < depositMethod.minimum_amount || amount > depositMethod.maximum_amount) { sendJson(response, 400, { error: `Amount must be between ${minimumDisplayAmount.toLocaleString()} and ${maximumDisplayAmount.toLocaleString()} ${currency.currencyCode} for ${depositMethod.name}.` }); return; }
    const receivingCurrency = countrySettingsForCode(depositMethod.receiving_country_code ?? currency.countryCode);
    const receivingRate = Number(receivingCurrency?.unitsPerRwf);
    const depositPaymentAmount = receivingCurrency && receivingRate > 0 ? localAmount(amount, { unitsPerRwf: receivingRate }) : 0;
    if (!receivingCurrency || receivingRate <= 0 || depositPaymentAmount <= 0) { sendJson(response, 400, { error: 'The receiving payment account does not have a valid exchange rate.' }); return; }
    const id = randomUUID(); const reference = `DEP-${randomUUID()}`;
    database.prepare('INSERT INTO wallet_transactions (id, user_id, type, amount, sender_name, receiver_name, phone_number, payment_method, deposit_method_id, deposit_method_name, screenshot_data, status, provider, internal_reference, deposit_receiving_country_code, deposit_receiving_currency_code, deposit_receiving_exchange_rate, deposit_payment_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, demoUserId, 'DEPOSIT', amount, senderName, '', phoneNumber, depositMethod.name, depositMethod.code, depositMethod.name, screenshotData, 'PENDING', 'ADMIN_REVIEW', reference, receivingCurrency.countryCode, receivingCurrency.currencyCode, receivingRate, depositPaymentAmount);
    sendJson(response, 201, { transaction: transactionView(database.prepare('SELECT * FROM wallet_transactions WHERE id = ?').get(id), currency) }); return;
  }
  if (path === '/api/wallet/withdraw/preview' && method === 'POST') {
    const input = await readBody(request);
    const currency = currencyForUser(demoUserId);
    const data = boundWithdrawalFields(input, demoUserId, currency);
    if (!data.account) { sendJson(response, 400, { error: 'Bind a withdrawal account before continuing.' }); return; }
    if (!data.valid || !methodEnabled('withdrawal', data.account.paymentMethod, user.countryCode)) { sendJson(response, 400, { error: 'Your bound withdrawal account is invalid or its provider is unavailable in your country.' }); return; }
    const calculation = feeFor(data.amount);
    if (data.amount > getAccount().availableBalance) { sendJson(response, 400, { error: 'Withdrawal amount exceeds available balance.' }); return; }
    sendJson(response, 200, { channel: data.account.paymentMethod === 'AIRTEL_MONEY' ? 'Airtel Money' : 'MTN MoMo', receiverName: data.account.accountHolderName, phoneNumber: data.account.phoneNumber, paymentMethod: data.account.paymentMethod, availableBalance: getAccount().availableBalance, displayAvailableBalance: localAmount(getAccount().availableBalance, currency), displayWithdrawalAmount: data.displayAmount, displayWithdrawalFee: localAmount(calculation.withdrawalFee, currency), displayAmountReceived: localAmount(calculation.amountReceived, currency), currencyCode: currency.currencyCode, ...calculation }); return;
  }
  if (path === '/api/wallet/withdraw' && method === 'POST') { const input = await readBody(request); const data = boundWithdrawalFields(input, demoUserId); if (!data.account) { sendJson(response, 400, { error: 'Bind a withdrawal account before requesting a withdrawal.' }); return; } if (!data.valid || !methodEnabled('withdrawal', data.account.paymentMethod)) { sendJson(response, 400, { error: 'Your bound withdrawal account is invalid or its provider is unavailable.' }); return; } const calculation = feeFor(data.amount); const reserved = data.amount; const timestamp = now(); const id = randomUUID(); const reference = `WDR-${randomUUID()}`; database.exec('BEGIN IMMEDIATE'); try { if (reserved > getAccount().availableBalance) throw new Error('Withdrawal amount exceeds available balance.'); const commissionTotals = database.prepare(`SELECT (SELECT coalesce(sum(commission_amount), 0) FROM commission_ledger WHERE beneficiary_user_id = ? AND status = 'APPROVED' AND credited_at IS NOT NULL) AS credited, (SELECT coalesce(sum(commission_amount), 0) FROM wallet_transactions WHERE user_id = ? AND type = 'WITHDRAWAL' AND status NOT IN ('REJECTED', 'FAILED', 'CANCELLED')) AS allocated`).get(demoUserId, demoUserId); const commissionAmount = Math.min(reserved, Math.max(0, commissionTotals.credited - commissionTotals.allocated)); database.prepare('UPDATE wallet_accounts SET available_balance = available_balance - ?, reserved_balance = reserved_balance + ?, updated_at = ? WHERE user_id = ? AND available_balance >= ?').run(reserved, reserved, timestamp, demoUserId, reserved); database.prepare('INSERT INTO wallet_transactions (id, user_id, type, amount, withdrawal_fee, amount_received, reserved_amount, commission_amount, sender_name, receiver_name, phone_number, payment_method, status, provider, internal_reference) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, demoUserId, 'WITHDRAWAL', data.amount, calculation.withdrawalFee, calculation.amountReceived, reserved, commissionAmount, '', data.account.accountHolderName, data.account.phoneNumber, data.account.paymentMethod, 'PENDING', 'ADMIN_REVIEW', reference); database.exec('COMMIT'); } catch (error) { database.exec('ROLLBACK'); sendJson(response, 400, { error: error.message }); return; } sendJson(response, 201, { transaction: transactionView(database.prepare('SELECT * FROM wallet_transactions WHERE id = ?').get(id)) }); return; }
  const transactionProof = path.match(/^\/api\/admin\/transactions\/([^/]+)\/proof$/);
  if (transactionProof && method === 'GET') { if (!isAdmin(request)) { sendJson(response, 401, { error: 'Admin authentication required.' }); return; } const row = database.prepare("SELECT screenshot_data AS screenshotData FROM wallet_transactions WHERE id = ? AND type = 'DEPOSIT'").get(transactionProof[1]); if (!row?.screenshotData) { sendJson(response, 404, { error: 'Payment screenshot not found.' }); return; } sendJson(response, 200, { screenshotData: row.screenshotData }); return; }
  if (path === '/api/admin/transactions' && method === 'GET') { if (!isAdmin(request)) { sendJson(response, 401, { error: 'Admin authentication required.' }); return; } const rows = database.prepare('SELECT t.*, u.full_name AS user_name FROM wallet_transactions t LEFT JOIN users u ON u.id = t.user_id ORDER BY t.created_at DESC LIMIT 200').all(); sendJson(response, 200, { transactions: rows.map((row) => ({ ...transactionView(row), userName: row.user_name ?? 'Account holder', phoneNumber: row.phone_number })) }); return; }
  const adminAction = path.match(/^\/api\/admin\/transactions\/([^/]+)\/(approve|reject)$/); if (adminAction && method === 'POST') { if (!isAdmin(request)) { sendJson(response, 401, { error: 'Admin authentication required.' }); return; } const input = await readBody(request); if (adminAction[2] === 'reject' && !String(input.reason ?? '').trim()) { sendJson(response, 400, { error: 'A rejection reason is required.' }); return; } const row = database.prepare('SELECT * FROM wallet_transactions WHERE id = ?').get(adminAction[1]); if (!row) { sendJson(response, 404, { error: 'Transaction not found.' }); return; } const updated = row.type === 'DEPOSIT' ? completeDeposit(row.id, 'admin', adminAction[2] === 'approve', String(input.reason ?? '').trim()) : reviewWithdrawal(row.id, 'admin', adminAction[2] === 'approve', String(input.reason ?? '').trim()); sendJson(response, 200, { transaction: transactionView(updated) }); return; }
  sendJson(response, 404, { error: 'Not found' });
}

const server = createServer((request, response) => { handle(request, response).catch((error) => sendJson(response, 500, { error: error.message })); });
const productIncomeTimer = setInterval(() => { try { settleDueProductIncome(); } catch (error) { console.error('Could not settle product income:', error); } }, productIncomeIntervalMs);
productIncomeTimer.unref();
server.listen(port, '127.0.0.1', () => {
  try { settleDueProductIncome(); } catch (error) { console.error('Could not settle product income:', error); }
  console.log(`Dashboard API listening on http://127.0.0.1:${port} (admin review)`);
});
process.on('SIGINT', () => { clearInterval(productIncomeTimer); server.close(() => database.close()); });
process.on('SIGTERM', () => { clearInterval(productIncomeTimer); server.close(() => database.close()); });
