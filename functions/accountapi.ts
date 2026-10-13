import { randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { attachDatabasePool } from '@neon/functions';
import { convertLocalToRwf, convertRwfToLocal, normalizeCountryPhone, supportedCountries } from '../backend/currency.mjs';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5, application_name: 'rwanda-wealth-account-api' });
attachDatabasePool(pool);

const sessionLifetimeSeconds = 60 * 60 * 24 * 7;
const defaultPermissions = ['dashboard', 'products', 'wallet', 'deposit', 'withdraw', 'myTeam', 'support', 'telegram', 'messages'];

function json(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}

function tokenHash(token: string) { return createHash('sha256').update(token).digest('hex'); }
function now() { return new Date().toISOString(); }
function cookieToken(request: Request) {
  return request.headers.get('cookie')?.split(';').map((item) => item.trim()).find((item) => item.startsWith('rw_session='))?.slice('rw_session='.length) ?? '';
}
function passwordHash(password: string, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
function passwordMatches(password: string, stored: string) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function normalizePhone(input: unknown, countryCode: string) {
  return normalizeCountryPhone(input, countryCode)?.phoneNumber ?? '';
}
function localAmount(amount: number, unitsPerRwf: number) {
  return convertRwfToLocal(Number(amount ?? 0), unitsPerRwf > 0 ? unitsPerRwf : 1);
}
function usdtAmount(amountRwf: number, unitsPerRwf: number, unitsPerUsdt: number) {
  return Math.round((localAmount(amountRwf, unitsPerRwf) / unitsPerUsdt) * 100) / 100;
}
// Admin USDT fee: deposits pay more USDT, withdrawals send less USDT.
function usdtWithFee(usdt: number, feePercent: number, direction: 'deposit' | 'withdrawal') {
  const factor = direction === 'deposit' ? 1 + feePercent / 100 : 1 - feePercent / 100;
  return Math.max(0, Math.round(usdt * factor * 100) / 100);
}
const cryptoMethod = 'USDT_TRC20';
const cryptoNetworkTrc20 = 'TRC20';
const trc20AddressPattern = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
function validTronAddress(address: unknown) {
  return trc20AddressPattern.test(String(address ?? '').trim());
}

async function countrySettings(countryCode: string) {
  const result = await pool.query(
    'SELECT country_code AS "countryCode", country_name AS "countryName", phone_prefix AS "phonePrefix", currency_code AS "currencyCode", enabled, units_per_rwf AS "unitsPerRwf", units_per_usdt AS "unitsPerUsdt" FROM country_settings WHERE country_code = $1',
    [countryCode],
  );
  return result.rows[0] ?? null;
}

async function userAccess(userId: string) {
  const [controlResult, permissionResult] = await Promise.all([
    pool.query('SELECT account_status AS "accountStatus", allow_deposits AS "allowDeposits", allow_withdrawals AS "allowWithdrawals", deleted_at AS "deletedAt" FROM user_access_controls WHERE user_id = $1', [userId]),
    pool.query('SELECT feature, enabled FROM user_permissions WHERE user_id = $1', [userId]),
  ]);
  const controls = controlResult.rows[0];
  const permissions = Object.fromEntries(defaultPermissions.map((feature) => [feature, true])) as Record<string, boolean>;
  for (const permission of permissionResult.rows) permissions[permission.feature] = Boolean(permission.enabled);
  return {
    accountStatus: controls?.accountStatus ?? 'ACTIVE',
    allowDeposits: controls ? Boolean(controls.allowDeposits) : true,
    allowWithdrawals: controls ? Boolean(controls.allowWithdrawals) : true,
    deletedAt: controls?.deletedAt ?? null,
    permissions,
  };
}

async function currencyForUser(userId: string) {
  const result = await pool.query('SELECT country_code AS "countryCode", currency_code AS "currencyCode" FROM users WHERE id = $1', [userId]);
  const countryCode = result.rows[0]?.countryCode ?? 'RW';
  const country = await countrySettings(countryCode);
  const validRate = Number(country?.unitsPerRwf) > 0;
  return {
    countryCode,
    currencyCode: validRate ? result.rows[0]?.currencyCode ?? country?.currencyCode : 'RWF',
    unitsPerRwf: validRate ? Number(country?.unitsPerRwf) : 1,
    unitsPerUsdt: Number(country?.unitsPerUsdt) || 0,
    enabled: Boolean(country?.enabled),
    rateConfigured: validRate,
  };
}

async function publicUser(user: Record<string, any>) {
  const [access, currency, purchaseResult] = await Promise.all([
    userAccess(user.id),
    currencyForUser(user.id),
    pool.query("SELECT 1 FROM product_purchases WHERE user_id = $1 AND status = 'COMPLETED' LIMIT 1", [user.id]),
  ]);
  const amount = Number(user.welcomeBonusAmount ?? 0);
  const unlocked = amount > 0 && purchaseResult.rows.length > 0;
  return {
    id: user.id,
    fullName: user.fullName,
    phoneNumber: user.phoneNumber,
    referralCode: user.referralCode,
    role: user.role,
    countryCode: user.countryCode ?? currency.countryCode,
    currencyCode: user.currencyCode ?? currency.currencyCode,
    exchangeRate: currency.unitsPerRwf,
    welcomeBonusAmount: amount,
    displayWelcomeBonusAmount: localAmount(amount, currency.unitsPerRwf),
    welcomeBonusAwardedAt: user.welcomeBonusAwardedAt ?? null,
    welcomeBonusUnlockedAt: unlocked ? user.welcomeBonusUnlockedAt ?? null : null,
    welcomeBonusStatus: amount === 0 ? 'NONE' : unlocked ? 'UNLOCKED' : 'LOCKED',
    accountStatus: access.accountStatus,
    allowDeposits: access.allowDeposits,
    allowWithdrawals: access.allowWithdrawals,
    permissions: access.permissions,
  };
}

async function currentUser(request: Request) {
  const token = cookieToken(request);
  if (!token) return null;
  const session = await pool.query('SELECT user_id AS "userId" FROM auth_sessions WHERE token_hash = $1 AND expires_at::timestamptz > now()', [tokenHash(token)]);
  if (!session.rows[0]) return null;
  const result = await pool.query(`SELECT id, full_name AS "fullName", phone_number AS "phoneNumber",
      referral_code AS "referralCode", role, country_code AS "countryCode", currency_code AS "currencyCode",
      welcome_bonus_amount AS "welcomeBonusAmount", welcome_bonus_awarded_at AS "welcomeBonusAwardedAt",
      welcome_bonus_unlocked_at AS "welcomeBonusUnlockedAt" FROM users WHERE id = $1`, [session.rows[0].userId]);
  if (!result.rows[0]) return null;
  return { ...result.rows[0], ...(await userAccess(result.rows[0].id)), ...(await currencyForUser(result.rows[0].id)) };
}

async function createSession(userId: string) {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + sessionLifetimeSeconds * 1000).toISOString();
  await pool.query('INSERT INTO auth_sessions (id, user_id, expires_at, token_hash, last_seen_at, current_page) VALUES ($1, $2, $3, $4, $5, $6)', [randomUUID(), userId, expiresAt, tokenHash(token), now(), 'Other']);
  return `rw_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionLifetimeSeconds}; Secure`;
}

async function accountFor(userId: string) {
  const result = await pool.query('SELECT user_id AS "userId", available_balance AS "availableBalance", reserved_balance AS "reservedBalance" FROM wallet_accounts WHERE user_id = $1', [userId]);
  return result.rows[0] ?? { userId, availableBalance: 0, reservedBalance: 0 };
}

async function balanceView(userId: string) {
  const [account, currencyResult, bonusResult, purchaseResult] = await Promise.all([
    accountFor(userId),
    currencyForUser(userId),
    pool.query('SELECT welcome_bonus_amount AS amount, welcome_bonus_awarded_at AS "awardedAt", welcome_bonus_unlocked_at AS "unlockedAt" FROM users WHERE id = $1', [userId]),
    pool.query("SELECT 1 FROM product_purchases WHERE user_id = $1 AND status = 'COMPLETED' LIMIT 1", [userId]),
  ]);
  const currency = currencyResult;
  const bonus = bonusResult.rows[0] ?? { amount: 0, awardedAt: null, unlockedAt: null };
  const amount = Number(bonus.amount ?? 0);
  const hasPurchase = purchaseResult.rows.length > 0;
  const locked = amount > 0 && !hasPurchase ? amount : 0;
  const legacyBonus = !hasPurchase && bonus.unlockedAt ? Math.min(amount, Number(account.availableBalance)) : 0;
  const available = Math.max(0, Number(account.availableBalance) - legacyBonus);
  return {
    ...account,
    availableBalance: available,
    lockedWelcomeBonus: locked,
    welcomeBonusAmount: amount,
    welcomeBonusStatus: amount === 0 ? 'NONE' : locked > 0 ? 'LOCKED' : 'UNLOCKED',
    welcomeBonusAwardedAt: bonus.awardedAt,
    welcomeBonusUnlockedAt: hasPurchase ? bonus.unlockedAt : null,
    ...currency,
    exchangeRate: currency.unitsPerRwf,
    displayAvailableBalance: localAmount(available, currency.unitsPerRwf),
    displayReservedBalance: localAmount(Number(account.reservedBalance), currency.unitsPerRwf),
    displayLockedWelcomeBonus: localAmount(locked, currency.unitsPerRwf),
    displayWelcomeBonusAmount: localAmount(amount, currency.unitsPerRwf),
    paymentMode: 'admin-review',
  };
}

async function settleDueIncome(userId?: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const due = await client.query(`SELECT p.id, p.user_id, p.daily_income_snapshot, p.duration_days_snapshot,
        coalesce(p.approved_at::timestamptz, p.created_at::timestamptz) AS purchased_at
      FROM product_purchases p
      WHERE p.status = 'COMPLETED' AND p.daily_income_snapshot > 0 AND p.duration_days_snapshot > 0
        AND ($1::text IS NULL OR p.user_id = $1)
      ORDER BY p.id FOR UPDATE OF p`, [userId ?? null]);
    for (const purchase of due.rows) {
      const paidResult = await client.query('SELECT count(*)::integer AS count FROM product_income_ledger WHERE purchase_id = $1', [purchase.id]);
      const paidDays = paidResult.rows[0].count;
      const dueDays = Math.floor((Date.now() - new Date(purchase.purchased_at).getTime()) / 86_400_000);
      const finalDay = Math.min(dueDays, purchase.duration_days_snapshot);
      for (let day = paidDays + 1; day <= finalDay; day += 1) {
        const inserted = await client.query(`INSERT INTO product_income_ledger (id, purchase_id, user_id, income_day, amount, created_at)
          VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (purchase_id, income_day) DO NOTHING RETURNING id`,
        [randomUUID(), purchase.id, purchase.user_id, day, purchase.daily_income_snapshot, now()]);
        if (inserted.rowCount) await client.query('UPDATE wallet_accounts SET available_balance = available_balance + $1, updated_at = $2 WHERE user_id = $3', [purchase.daily_income_snapshot, now(), purchase.user_id]);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function readBody(request: Request) {
  try { return await request.json() as Record<string, unknown>; }
  catch { throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400 }); }
}

const userFeatures = defaultPermissions;
const accountStatuses = ['ACTIVE', 'FROZEN', 'RESTRICTED', 'SUSPENDED'];
const liveWindowSql = "interval '20 seconds'";
const totalsSql = (alias: string) => `
  (SELECT coalesce(sum(t.amount), 0)::bigint::text FROM wallet_transactions t WHERE t.user_id = ${alias}.id AND t.type = 'DEPOSIT' AND t.status = 'SUCCESS') AS "totalDeposit",
  (SELECT coalesce(sum(t.amount), 0)::bigint::text FROM wallet_transactions t WHERE t.user_id = ${alias}.id AND t.type = 'WITHDRAWAL' AND t.status IN ('APPROVED', 'AWAITING_PAYOUT', 'PROCESSING', 'SUCCESS')) AS "totalWithdrawal",
  (SELECT count(*)::integer FROM product_purchases p WHERE p.user_id = ${alias}.id AND p.status = 'COMPLETED') AS "productsPurchased"`;
const lastSessionSql = (column: string) => `(SELECT s.${column} FROM auth_sessions s WHERE s.user_id = u.id ORDER BY s.last_seen_at DESC LIMIT 1)`;
const referredBySql = `coalesce((SELECT sponsor.full_name FROM referral_relationships r JOIN users sponsor ON sponsor.id = r.sponsor_user_id WHERE r.user_id = u.id), (SELECT sponsor.full_name FROM users sponsor WHERE sponsor.id = u.referred_by))`;

function maskPhone(phone: unknown) { const value = String(phone ?? ''); return `${value.slice(0, 4)}****${value.slice(-2)}`; }
function isLive(lastSeen: unknown) { return Boolean(lastSeen) && Date.now() - new Date(String(lastSeen)).getTime() <= 20_000; }
function parseJsonColumn(value: unknown) { if (typeof value !== 'string') return value ?? null; try { return JSON.parse(value); } catch { return value; } }

async function auditAdmin(adminId: string | null, targetUserId: string | null, action: string, previousValue: unknown = null, newValue: unknown = null, metadata: unknown = null) {
  const encode = (value: unknown) => (value === null ? null : JSON.stringify(value));
  await pool.query('INSERT INTO admin_audit_log (id, admin_user_id, target_user_id, action, previous_value, new_value, metadata, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), adminId, targetUserId, action, encode(previousValue), encode(newValue), encode(metadata), now()]);
}

// Plan list queries select a lean column set: image bytes are never sent in JSON. Images are served by /api/plan-image.
const planColumns = "name, description, note, price, deposited, daily_income, duration_days, total_slots, sold_slots, status, position, (image_data IS NOT NULL AND image_data <> '') AS has_image, md5(image_data) AS image_version";

function planImageUrl(row: Record<string, any>) {
  return row.has_image ? `/api/plan-image?name=${encodeURIComponent(row.name)}&v=${row.image_version}` : null;
}

function planView(row: Record<string, any>) {
  const soldSlots = Number(row.sold_slots ?? 0);
  const totalSlots = Number(row.total_slots ?? 0);
  const durationDays = Number(row.duration_days ?? 0);
  const dailyIncome = Number(row.daily_income ?? 0);
  return {
    id: row.name, name: row.name, description: row.description ?? row.note, imageUrl: planImageUrl(row),
    price: Number(row.price ?? 0), deposited: row.deposited, dailyIncome, incomePerDay: dailyIncome, totalIncome: dailyIncome * durationDays,
    durationDays, termDays: durationDays, term: `${durationDays} days`, purchaseBonus: 0, totalSlots, soldSlots,
    remainingSlots: Math.max(0, totalSlots - soldSlots), progressPercent: totalSlots ? Math.min(100, Math.floor((soldSlots / totalSlots) * 100)) : 0,
    soldOut: totalSlots > 0 && soldSlots >= totalSlots, status: row.status, note: row.description ?? row.note, position: row.position,
  };
}

function parsePlan(input: Record<string, unknown>, { keepExistingImage = false }: { keepExistingImage?: boolean } = {}) {
  const name = String(input.name ?? '').trim().slice(0, 100);
  const description = String(input.description ?? '').trim().slice(0, 2000);
  const imageData = input.imageData;
  const price = Number(input.price);
  const dailyIncome = Number(input.dailyIncome);
  const durationDays = Number(input.durationDays);
  const totalSlots = Number(input.totalSlots);
  const status = input.status === 'Ending soon' ? 'Ending soon' : 'Active';
  const position = Number.isSafeInteger(Number(input.position)) ? Number(input.position) : 0;
  if (!name || !description || !Number.isSafeInteger(price) || price <= 0 || !Number.isSafeInteger(dailyIncome) || dailyIncome < 0 || !Number.isSafeInteger(durationDays) || durationDays <= 0 || !Number.isSafeInteger(totalSlots) || totalSlots <= 0) {
    return { error: 'Enter a name, description, positive price and duration, non-negative income, and at least one slot.' };
  }
  const omitImage = keepExistingImage && (imageData === undefined || imageData === null || imageData === '');
  if (!omitImage) {
    const image = typeof imageData === 'string' ? imageData.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/) : null;
    if (!image || Buffer.from(image[2], 'base64').byteLength > 4 * 1024 * 1024) return { error: 'Upload a PNG, JPEG, or WebP product image no larger than 4 MB.' };
  }
  return { value: { name, description, imageData: omitImage ? null : imageData as string, price, dailyIncome, durationDays, totalSlots, status, position } };
}

function transactionView(row: Record<string, any>, currency: { countryCode: string; currencyCode: string; unitsPerRwf: number }) {
  const unitsPerRwf = Number(row.exchange_rate ?? currency.unitsPerRwf);
  return {
    id: row.id, userId: row.user_id, type: row.type, amount: Number(row.amount), withdrawalFee: Number(row.withdrawal_fee ?? 0), amountReceived: Number(row.amount_received ?? 0),
    displayAmount: Number(row.display_amount) || convertRwfToLocal(Number(row.amount), unitsPerRwf),
    displayFee: Number(row.display_fee) || convertRwfToLocal(Number(row.withdrawal_fee ?? 0), unitsPerRwf),
    displayAmountReceived: Number(row.display_amount_received) || convertRwfToLocal(Number(row.amount_received ?? 0), unitsPerRwf),
    countryCode: row.country_code ?? currency.countryCode, currencyCode: row.currency_code ?? currency.currencyCode, exchangeRate: unitsPerRwf,
    commissionAmount: Number(row.commission_amount ?? 0), senderName: row.sender_name, receiverName: row.receiver_name, phoneNumber: maskPhone(row.phone_number),
    paymentMethod: row.payment_method, depositMethodId: row.deposit_method_id ?? null, depositMethodName: row.deposit_method_name ?? null,
    depositReceivingCountryCode: row.deposit_receiving_country_code ?? null, depositReceivingCurrencyCode: row.deposit_receiving_currency_code ?? null,
    depositReceivingExchangeRate: row.deposit_receiving_exchange_rate ?? null, depositPaymentAmount: row.deposit_payment_amount == null ? null : Number(row.deposit_payment_amount),
    cryptoNetwork: row.crypto_network ?? '', cryptoAmount: row.crypto_amount == null ? null : Number(row.crypto_amount),
    cryptoUnitsPerUsdt: row.crypto_units_per_usdt == null ? null : Number(row.crypto_units_per_usdt), cryptoAddress: row.crypto_address ?? null,
    status: row.status, provider: row.provider, providerReference: row.provider_reference, internalReference: row.internal_reference,
    failureReason: row.failure_reason, rejectionReason: row.rejection_reason, approvedBy: row.approved_by, approvedAt: row.approved_at,
    rejectedBy: row.rejected_by, rejectedAt: row.rejected_at, createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at,
  };
}

async function depositMethodView(row: Record<string, any>, currency: { currencyCode: string; unitsPerRwf: number; unitsPerUsdt?: number } | null = null) {
  const countryCode = row.country_code ?? 'RW';
  const receivingCountryCode = row.receiving_country_code ?? countryCode;
  const receivingCurrency = await countrySettings(receivingCountryCode);
  const currencyCode = currency?.currencyCode ?? 'RWF';
  const minimum = Number(row.minimum_amount ?? 0);
  const maximum = Number(row.maximum_amount ?? 0);
  return {
    id: row.code, name: row.name, accountName: row.account_name, accountNumber: row.account_number, instructions: row.instructions, ussdTemplate: row.ussd_template ?? '',
    minimumAmount: currency ? localAmount(minimum, currency.unitsPerRwf) : minimum, maximumAmount: currency ? localAmount(maximum, currency.unitsPerRwf) : maximum,
    countryCode, currencyCode, customerUnitsPerRwf: Number(currency?.unitsPerRwf ?? 1), crossBorderEnabled: Boolean(row.cross_border_enabled), receivingCountryCode,
    cryptoNetwork: row.crypto_network ?? '', unitsPerUsdt: Number(currency?.unitsPerUsdt ?? 0),
    receivingCurrencyCode: receivingCurrency?.currencyCode ?? currencyCode, receivingUnitsPerRwf: Number(receivingCurrency?.unitsPerRwf ?? currency?.unitsPerRwf ?? 1),
    logoData: row.logo_data, enabled: Boolean(row.enabled), position: row.position,
  };
}

async function platformSettings() {
  const result = await pool.query("SELECT key, value FROM support_settings WHERE key IN ('withdrawal_fee_enabled','withdrawal_fee_type','withdrawal_fee_value','welcome_bonus_enabled','welcome_bonus_amount','minimum_withdrawal_amount','usdt_fee_percent')");
  const read = Object.fromEntries(result.rows.map((row) => [row.key, row.value])) as Record<string, string | undefined>;
  const withdrawalFeeType = read.withdrawal_fee_type === 'FIXED' ? 'FIXED' : 'PERCENTAGE';
  return {
    withdrawalFeeEnabled: read.withdrawal_fee_enabled === '1', withdrawalFeeType,
    withdrawalFeeValue: Number(read.withdrawal_fee_value ?? 0), welcomeBonusEnabled: read.welcome_bonus_enabled === '1', welcomeBonusAmount: Number(read.welcome_bonus_amount ?? 0),
    minimumWithdrawal: Number(read.minimum_withdrawal_amount ?? 0),
    usdtFeePercent: Number(read.usdt_fee_percent ?? 0),
  };
}

const withdrawalMethodCodes = ['MTN_MOMO', 'AIRTEL_MONEY', cryptoMethod];
const supportedCountryCodes = ['RW', 'BI', 'UG'];

function positiveInteger(value: unknown) { const amount = Number(value); return Number.isSafeInteger(amount) && amount > 0 ? amount : null; }
function imageDataValid(value: unknown, maxBytes: number) {
  if (typeof value !== 'string') return false;
  const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  return Boolean(match) && Buffer.from(match![2], 'base64').byteLength <= maxBytes;
}

async function withTransaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
class BusinessError extends Error {}

async function walletAudit(client: PoolClient, transactionId: string, actorId: string, action: string, oldStatus: string, newStatus: string, reason: string | null) {
  await client.query('INSERT INTO wallet_audit_logs (id, transaction_id, actor_id, action, details, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), transactionId, actorId, action, JSON.stringify({ oldStatus, newStatus, reason, timestamp: now() }), now()]);
}

async function withdrawalFee(amount: number) {
  const settings = await platformSettings();
  const configured = !settings.withdrawalFeeEnabled ? 0 : settings.withdrawalFeeType === 'FIXED' ? settings.withdrawalFeeValue : Math.ceil(amount * settings.withdrawalFeeValue / 100);
  const fee = Math.min(amount, Math.max(0, Math.floor(configured)));
  return { withdrawalAmount: amount, withdrawalFee: fee, amountReceived: amount - fee };
}

async function withdrawalMethodEnabled(method: string, countryCode: string) {
  const result = await pool.query('SELECT 1 FROM withdrawal_methods m JOIN country_withdrawal_methods c ON c.method_code = m.code WHERE m.code = $1 AND m.enabled::int = 1 AND c.enabled::int = 1 AND c.country_code = $2', [method, countryCode]);
  return Boolean(result.rowCount);
}

async function withdrawalAccountFor(userId: string) {
  const result = await pool.query('SELECT account_holder_name AS "accountHolderName", phone_number AS "phoneNumber", wallet_address AS "walletAddress", payment_method AS "paymentMethod", created_at AS "createdAt", updated_at AS "updatedAt" FROM withdrawal_accounts WHERE user_id = $1', [userId]);
  return result.rows[0] ?? null;
}

async function createCommissions(client: PoolClient, purchase: { id: string; userId: string; productName: string; amount: number }) {
  let current = purchase.userId;
  for (let level = 1; level <= 3; level += 1) {
    const sponsor = await client.query('SELECT sponsor_user_id AS "sponsorUserId" FROM referral_relationships WHERE user_id = $1', [current]);
    if (!sponsor.rows[0]) break;
    const beneficiary = sponsor.rows[0].sponsorUserId as string;
    const setting = await client.query('SELECT percentage FROM referral_settings WHERE level = $1', [level]);
    const percentage = Number(setting.rows[0]?.percentage ?? 0);
    const commission = Math.floor(purchase.amount * percentage / 100);
    const timestamp = now();
    const inserted = await client.query(`INSERT INTO commission_ledger (id, beneficiary_user_id, source_user_id, product_id, purchase_id, referral_level, percentage, qualifying_amount, commission_amount, status, reference, approved_at, credited_at, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'APPROVED',$10,$11,$11,$11) ON CONFLICT DO NOTHING`,
    [randomUUID(), beneficiary, purchase.userId, purchase.productName, purchase.id, level, percentage, purchase.amount, commission, `COM-${purchase.id}-${beneficiary}-${level}`, timestamp]);
    if (inserted.rowCount && commission > 0) await client.query('UPDATE wallet_accounts SET available_balance = available_balance + $1, updated_at = $2 WHERE user_id = $3', [commission, timestamp, beneficiary]);
    current = beneficiary;
  }
}

async function unlockWelcomeBonus(client: PoolClient, userId: string) {
  const bonus = await client.query('SELECT welcome_bonus_amount AS amount FROM users WHERE id = $1 AND welcome_bonus_awarded_at IS NOT NULL AND welcome_bonus_unlocked_at IS NULL', [userId]);
  const amount = Number(bonus.rows[0]?.amount ?? 0);
  if (amount <= 0) return;
  const timestamp = now();
  const updated = await client.query('UPDATE users SET welcome_bonus_unlocked_at = $1 WHERE id = $2 AND welcome_bonus_unlocked_at IS NULL AND welcome_bonus_awarded_at IS NOT NULL', [timestamp, userId]);
  if (updated.rowCount) await client.query('UPDATE wallet_accounts SET available_balance = available_balance + $1, updated_at = $2 WHERE user_id = $3', [amount, timestamp, userId]);
}

async function permanentlyDeleteUsers(userIds: string[]) {
  const targets = [...new Set(userIds)];
  await withTransaction(async (client) => {
    for (const userId of targets) {
      const purchases = await client.query("SELECT coalesce(product_id, product_name) AS \"productId\", count(*)::integer AS count FROM product_purchases WHERE user_id = $1 AND status = 'COMPLETED' GROUP BY coalesce(product_id, product_name)", [userId]);
      for (const purchase of purchases.rows) await client.query('UPDATE plans SET sold_slots = greatest(0, sold_slots - $1) WHERE name = $2', [purchase.count, purchase.productId]);
      await client.query('UPDATE users SET referred_by = NULL WHERE referred_by = $1', [userId]);
      await client.query('DELETE FROM user_message_reads WHERE user_id = $1 OR message_id IN (SELECT id FROM user_messages WHERE sender_user_id = $1 OR recipient_user_id = $1)', [userId]);
      await client.query('DELETE FROM user_messages WHERE sender_user_id = $1 OR recipient_user_id = $1', [userId]);
      await client.query('DELETE FROM support_messages WHERE author_id = $1 OR conversation_id IN (SELECT id FROM support_conversations WHERE user_id = $1)', [userId]);
      await client.query('DELETE FROM support_conversations WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM referral_relationships WHERE user_id = $1 OR sponsor_user_id = $1', [userId]);
      await client.query("UPDATE commission_ledger SET source_user_id = 'DELETED_USER' WHERE source_user_id = $1", [userId]);
      await client.query('DELETE FROM commission_ledger WHERE beneficiary_user_id = $1', [userId]);
      await client.query('DELETE FROM admin_audit_log WHERE target_user_id = $1 OR admin_user_id = $1', [userId]);
      await client.query('DELETE FROM wallet_audit_logs WHERE actor_id = $1 OR transaction_id IN (SELECT id FROM wallet_transactions WHERE user_id = $1)', [userId]);
      await client.query('DELETE FROM wallet_transactions WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM product_purchases WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM wallet_accounts WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM users WHERE id = $1', [userId]);
    }
  });
  return targets.length;
}

async function parseDepositMethod(input: Record<string, unknown>) {
  const name = String(input.name ?? '').trim().slice(0, 80);
  const accountName = String(input.accountName ?? '').trim().slice(0, 120);
  const accountNumber = String(input.accountNumber ?? '').trim().slice(0, 80);
  const cryptoNetwork = String(input.cryptoNetwork ?? '') === cryptoNetworkTrc20 ? cryptoNetworkTrc20 : '';
  const isCrypto = cryptoNetwork === cryptoNetworkTrc20;
  const instructions = String(input.instructions ?? '').trim().slice(0, 1000);
  let ussdTemplate = isCrypto ? '' : String(input.ussdTemplate ?? '').trim().slice(0, 160);
  const minimumAmount = Math.round(Number(input.minimumAmount));
  const maximumAmount = Math.round(Number(input.maximumAmount));
  const enabled = Boolean(input.enabled);
  const countryCode = supportedCountryCodes.includes(String(input.countryCode)) ? String(input.countryCode) : 'RW';
  const crossBorderEnabled = input.crossBorderEnabled === true && !isCrypto;
  const receivingCountryCode = crossBorderEnabled && supportedCountryCodes.includes(String(input.receivingCountryCode)) ? String(input.receivingCountryCode) : countryCode;
  const logoData = input.logoData ? String(input.logoData) : null;
  if (accountNumber && ussdTemplate.includes(accountNumber)) ussdTemplate = ussdTemplate.replace(accountNumber, '{number}');
  if (minimumAmount > 0) ussdTemplate = ussdTemplate.replace(new RegExp(`(?<!\\d)${minimumAmount}(?!\\d)`), '{amount}');
  if (!name) return { error: 'Enter a payment method name.' };
  if (!Number.isSafeInteger(minimumAmount) || minimumAmount < 0) return { error: 'Enter a valid minimum deposit amount (0 or more).' };
  if (!Number.isSafeInteger(maximumAmount) || maximumAmount <= 0) return { error: 'Enter a valid maximum deposit amount (greater than 0).' };
  if (minimumAmount > maximumAmount) return { error: 'Minimum deposit cannot be greater than the maximum deposit.' };
  if (enabled && (!accountName || !accountNumber)) return { error: 'Add an account/merchant name and number before activating this method.' };
  if (isCrypto && accountNumber && !validTronAddress(accountNumber)) return { error: 'Enter a valid TRC20 USDT wallet address (starts with T, 34 characters).' };
  if (isCrypto && enabled && !(Number((await countrySettings(countryCode))?.unitsPerUsdt) > 0)) return { error: 'Set a USDT rate for this country before activating a USDT deposit method.' };
  if (crossBorderEnabled && !supportedCountryCodes.includes(String(input.receivingCountryCode))) return { error: 'Choose a supported receiving country for cross-border deposits.' };
  if (ussdTemplate && (!/(?:\{\{?\s*number\s*\}\}?|\bnumber\b)/i.test(ussdTemplate) || !/^[0-9*#+\s{}A-Za-z_-]+$/.test(ussdTemplate))) return { error: 'USSD template must include the number placeholder and contain only USSD digits, symbols, and placeholders.' };
  if (logoData && !imageDataValid(logoData, 128 * 1024)) return { error: 'Logo must be a PNG, JPEG, or WebP image under 128 KB.' };
  return { value: { name, accountName, accountNumber, instructions, ussdTemplate, minimumAmount, maximumAmount, enabled: enabled ? 1 : 0, countryCode, crossBorderEnabled: crossBorderEnabled ? 1 : 0, receivingCountryCode, cryptoNetwork, logoData, position: Number.isSafeInteger(Number(input.position)) ? Number(input.position) : 0 } };
}

export default {
  async fetch(request: Request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (method === 'OPTIONS') return new Response(null, { status: 204 });

    try {
      if (path === '/api/health' && method === 'GET') {
        await pool.query('SELECT 1');
        return json({ status: 'ok', workflow: 'neon-postgres' });
      }

      if (path === '/api/public/countries' && method === 'GET') {
        const mode = url.searchParams.get('mode');
        const existing = mode === 'login' ? await pool.query(`SELECT DISTINCT u.country_code AS "countryCode"
          FROM users u LEFT JOIN user_access_controls c ON c.user_id = u.id WHERE c.deleted_at IS NULL`) : { rows: [] };
        const countries = await pool.query(`SELECT country_code AS "countryCode", country_name AS "countryName", phone_prefix AS "phonePrefix", currency_code AS "currencyCode", enabled, units_per_rwf AS "unitsPerRwf", units_per_usdt AS "unitsPerUsdt" FROM country_settings`);
        const existingCodes = new Set(existing.rows.map((row) => row.countryCode));
        return json({ countries: countries.rows.map((country) => ({ ...country, enabled: Boolean(country.enabled) })).filter((country) => (country.enabled && Number(country.unitsPerRwf) > 0) || existingCodes.has(country.countryCode)) });
      }

      if (path === '/api/auth/register' && method === 'POST') {
        const input = await readBody(request);
        const fullName = String(input.fullName ?? '').trim();
        const countryCode = String(input.countryCode ?? 'RW').trim().toUpperCase();
        const phone = normalizeCountryPhone(input.phoneNumber, supportedCountries.some((item) => item.countryCode === countryCode) ? countryCode : 'RW');
        const password = String(input.password ?? '');
        const referralCode = String(input.referralCode ?? '').trim().toUpperCase();
        if (fullName.length < 2 || fullName.length > 100) return json({ error: 'Full name must be between 2 and 100 characters.' }, 400);
        if (!phone || phone.countryCode !== countryCode) return json({ error: 'Enter a valid phone number for the selected country.' }, 400);
        const country = await countrySettings(phone.countryCode);
        if (!country?.enabled || Number(country.unitsPerRwf) <= 0) return json({ error: 'Registration is currently unavailable for this country. Contact support.', code: 'COUNTRY_DISABLED', countryCode: phone.countryCode }, 403);
        if (!/^\d{6}$/.test(password)) return json({ error: 'Password must contain exactly 6 digits.' }, 400);

        const client = await pool.connect();
        let userId: string;
        try {
          await client.query('BEGIN');
          const duplicate = await client.query('SELECT id FROM users WHERE phone_number = $1', [phone.phoneNumber]);
          if (duplicate.rowCount) { await client.query('ROLLBACK'); return json({ error: 'An account with this phone number already exists.' }, 409); }
          const sponsorResult = referralCode ? await client.query('SELECT id FROM users WHERE referral_code = $1', [referralCode]) : { rows: [] };
          const sponsorId = sponsorResult.rows[0]?.id ?? null;
          if (referralCode && !sponsorId) { await client.query('ROLLBACK'); return json({ error: 'Referral code is invalid.' }, 400); }
          userId = randomUUID();
          let referral = randomBytes(5).toString('hex').toUpperCase();
          for (let attempt = 0; attempt < 5; attempt += 1) {
            const exists = await client.query('SELECT 1 FROM users WHERE referral_code = $1', [referral]);
            if (!exists.rowCount) break;
            referral = randomBytes(5).toString('hex').toUpperCase();
          }
          const settings = await client.query("SELECT key, value FROM support_settings WHERE key IN ('welcome_bonus_enabled', 'welcome_bonus_amount')");
          const settingMap = Object.fromEntries(settings.rows.map((row) => [row.key, row.value]));
          const bonus = settingMap.welcome_bonus_enabled === '1' ? Number(settingMap.welcome_bonus_amount ?? 0) : 0;
          const awardedAt = bonus > 0 ? now() : null;
          await client.query(`INSERT INTO users (id, full_name, phone_number, password_hash, referral_code, referred_by, country_code, currency_code, welcome_bonus_amount, welcome_bonus_awarded_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [userId, fullName, phone.phoneNumber, passwordHash(password), referral, sponsorId, phone.countryCode, phone.currencyCode, bonus, awardedAt]);
          await client.query('INSERT INTO wallet_accounts (user_id) VALUES ($1)', [userId]);
          if (sponsorId) await client.query('INSERT INTO referral_relationships (user_id, sponsor_user_id) VALUES ($1, $2)', [userId, sponsorId]);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          if ((error as { code?: string }).code === '23505') return json({ error: 'An account with this phone number already exists.' }, 409);
          throw error;
        } finally {
          client.release();
        }
        const user = await pool.query(`SELECT id, full_name AS "fullName", phone_number AS "phoneNumber", referral_code AS "referralCode", role,
          country_code AS "countryCode", currency_code AS "currencyCode", welcome_bonus_amount AS "welcomeBonusAmount",
          welcome_bonus_awarded_at AS "welcomeBonusAwardedAt", welcome_bonus_unlocked_at AS "welcomeBonusUnlockedAt" FROM users WHERE id = $1`, [userId]);
        return json({ user: await publicUser(user.rows[0]) }, 201, { 'set-cookie': await createSession(userId) });
      }

      if (path === '/api/auth/login' && method === 'POST') {
        const input = await readBody(request);
        const countryCode = String(input.countryCode ?? 'RW').trim().toUpperCase();
        const phone = normalizeCountryPhone(input.phoneNumber, countryCode);
        const password = String(input.password ?? '');
        if (!phone || phone.countryCode !== countryCode || !/^\d{6}$/.test(password)) return json({ error: 'Enter a valid phone number and 6-digit password.' }, 400);
        const result = await pool.query(`SELECT id, full_name AS "fullName", phone_number AS "phoneNumber", password_hash AS "passwordHash",
          referral_code AS "referralCode", role, country_code AS "countryCode", currency_code AS "currencyCode",
          welcome_bonus_amount AS "welcomeBonusAmount", welcome_bonus_awarded_at AS "welcomeBonusAwardedAt",
          welcome_bonus_unlocked_at AS "welcomeBonusUnlockedAt" FROM users WHERE phone_number = $1`, [phone.phoneNumber]);
        const user = result.rows[0];
        if (!user || !passwordMatches(password, user.passwordHash)) return json({ error: 'Phone number or password is incorrect.' }, 401);
        return json({ user: await publicUser(user) }, 200, { 'set-cookie': await createSession(user.id) });
      }

      if (path === '/api/auth/me' && method === 'GET') {
        const user = await currentUser(request);
        return json({ user: user ? await publicUser(user) : null });
      }

      if (path === '/api/auth/logout' && method === 'POST') {
        const token = cookieToken(request);
        if (token) await pool.query('DELETE FROM auth_sessions WHERE token_hash = $1', [tokenHash(token)]);
        return json({ ok: true }, 200, { 'set-cookie': 'rw_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure' });
      }

      const user = await currentUser(request);
      if (path.startsWith('/api/') && !user) return json({ error: 'Authentication required.' }, 401);

      if (path === '/api/plan-image' && method === 'GET') {
        const image = await pool.query('SELECT image_data FROM plans WHERE name = $1', [url.searchParams.get('name') ?? '']);
        const match = String(image.rows[0]?.image_data ?? '').match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
        if (!match) return json({ error: 'Image not found.' }, 404);
        return new Response(new Uint8Array(Buffer.from(match[2], 'base64')), { status: 200, headers: { 'content-type': match[1], 'cache-control': 'private, max-age=86400' } });
      }

      if (path === '/api/user/account-state' && method === 'GET') {
        const access = await userAccess(user.id);
        return json({ accountStatus: access.accountStatus, allowDeposits: access.allowDeposits, allowWithdrawals: access.allowWithdrawals, permissions: access.permissions });
      }

      if (path === '/api/presence' && method === 'POST') {
        const input = await readBody(request);
        if (input.leave === true) {
          await pool.query('UPDATE auth_sessions SET last_seen_at = $1, current_page = $2 WHERE token_hash = $3 AND user_id = $4', [new Date(Date.now() - 3_600_000).toISOString(), 'Other', tokenHash(cookieToken(request)), user.id]);
          return json({ ok: true });
        }
        const page = String(input.path ?? '');
        const currentPage = new Map([['/', 'Home'], ['/plans', 'Products'], ['/wallet', 'My Wallet'], ['/deposit', 'Deposit'], ['/withdraw', 'Withdraw'], ['/team', 'My Team'], ['/invite', 'Promotion'], ['/support', 'Support'], ['/messages', 'Messages'], ['/me', 'Profile']]).get(page) ?? 'Other';
        await pool.query('UPDATE auth_sessions SET last_seen_at = $1, current_page = $2 WHERE token_hash = $3 AND user_id = $4 AND expires_at::timestamptz > now()', [now(), currentPage, tokenHash(cookieToken(request)), user.id]);
        return json({ ok: true });
      }

      if (path === '/api/dashboard' && method === 'GET') {
        const currency = await currencyForUser(user.id);
        const access = user.permissions;
        const [metrics, plans, referrals, tools] = await Promise.all([
          access.dashboard ? pool.query('SELECT label, value, detail, tone FROM dashboard_metrics ORDER BY position, label') : { rows: [] },
          access.products && currency.enabled ? pool.query(`SELECT ${planColumns} FROM plans WHERE total_slots > 0 AND status = 'Active' ORDER BY position, name`) : { rows: [] },
          access.myTeam ? pool.query('SELECT person, joined, contribution, commission, status FROM referrals ORDER BY position, person') : { rows: [] },
          access.support ? pool.query('SELECT name, value, state FROM support_tools ORDER BY position, name') : { rows: [] },
        ]);
        const mappedPlans = plans.rows.map((row) => {
          const dailyIncome = Number(row.daily_income ?? 0);
          const durationDays = Number(row.duration_days ?? 0);
          const price = Number(row.price ?? 0);
          const totalSlots = Number(row.total_slots ?? 0);
          const soldSlots = Number(row.sold_slots ?? 0);
          const plan = { id: row.name, name: row.name, description: row.description ?? row.note, imageUrl: planImageUrl(row), price, deposited: row.deposited, dailyIncome, incomePerDay: dailyIncome, totalIncome: dailyIncome * durationDays, durationDays, termDays: durationDays, term: `${durationDays} days`, purchaseBonus: 0, totalSlots, soldSlots, remainingSlots: Math.max(0, totalSlots - soldSlots), progressPercent: totalSlots ? Math.min(100, Math.floor(soldSlots * 100 / totalSlots)) : 0, soldOut: totalSlots > 0 && soldSlots >= totalSlots, status: row.status, note: row.description ?? row.note };
          return { ...plan, displayPrice: localAmount(price, currency.unitsPerRwf), displayDailyIncome: localAmount(dailyIncome, currency.unitsPerRwf), displayTotalIncome: localAmount(plan.totalIncome, currency.unitsPerRwf), currencyCode: currency.currencyCode, countryCode: currency.countryCode };
        });
        return json({ metrics: metrics.rows, plans: mappedPlans, referrals: referrals.rows, tools: tools.rows, countryCode: currency.countryCode, currencyCode: currency.currencyCode, exchangeRate: currency.unitsPerRwf });
      }

      if (path === '/api/admin/overview' && method === 'GET') {
        if (user.role !== 'ADMIN') return json({ error: 'Admin authentication required.' }, 401);
        const [members, pendingDeposits, pendingWithdrawals, plans, totalDeposit, totalWithdrawal, activeUsers, liveUsers, productsSold, referrals, commissions] = await Promise.all([
          pool.query('SELECT count(*)::integer AS count FROM users'),
          pool.query("SELECT count(*)::integer AS count, coalesce(sum(amount),0)::bigint::text AS amount FROM wallet_transactions WHERE type='DEPOSIT' AND status='PENDING'"),
          pool.query("SELECT count(*)::integer AS count, coalesce(sum(amount),0)::bigint::text AS amount FROM wallet_transactions WHERE type='WITHDRAWAL' AND status='PENDING'"),
          pool.query('SELECT count(*)::integer AS count FROM plans'),
          pool.query("SELECT coalesce(sum(amount),0)::bigint::text AS amount FROM wallet_transactions WHERE type='DEPOSIT' AND status='SUCCESS'"),
          pool.query("SELECT coalesce(sum(amount),0)::bigint::text AS amount FROM wallet_transactions WHERE type='WITHDRAWAL' AND status IN ('APPROVED','AWAITING_PAYOUT','PROCESSING','SUCCESS')"),
          pool.query("SELECT count(DISTINCT user_id)::integer AS count FROM product_purchases WHERE status='COMPLETED'"),
          pool.query("SELECT count(DISTINCT user_id)::integer AS count FROM auth_sessions WHERE expires_at::timestamptz > now() AND last_seen_at::timestamptz >= now() - interval '20 seconds'"),
          pool.query("SELECT count(*)::integer AS count FROM product_purchases WHERE status='COMPLETED'"),
          pool.query('SELECT count(*)::integer AS count FROM referral_relationships'),
          pool.query("SELECT coalesce(sum(commission_amount),0)::bigint::text AS amount FROM commission_ledger WHERE status='APPROVED'"),
        ]);
        const summary = { totalUsers: members.rows[0].count, activeUsers: activeUsers.rows[0].count, liveUsers: liveUsers.rows[0].count, totalDeposit: Number(totalDeposit.rows[0].amount), totalWithdrawal: Number(totalWithdrawal.rows[0].amount), totalProductsSold: productsSold.rows[0].count, totalReferrals: referrals.rows[0].count, totalReferralCommissions: Number(commissions.rows[0].amount) };
        return json({ members: members.rows[0].count, pendingDeposits: { count: pendingDeposits.rows[0].count, amount: Number(pendingDeposits.rows[0].amount) }, pendingWithdrawals: { count: pendingWithdrawals.rows[0].count, amount: Number(pendingWithdrawals.rows[0].amount) }, plans: plans.rows[0].count, liveUsers: liveUsers.rows[0].count, completedDeposits: summary.totalDeposit, completedWithdrawals: summary.totalWithdrawal, productsSold: productsSold.rows[0].count, referrals: referrals.rows[0].count, summary });
      }

      if (path === '/api/wallet/balance' && method === 'GET') {
        await settleDueIncome(user.id);
        return json(await balanceView(user.id));
      }

      if (path === '/api/wallet/products' && method === 'GET') {
        await settleDueIncome(user.id);
        const currency = await currencyForUser(user.id);
        const result = await pool.query(`SELECT p.id, p.product_name AS name, p.qualifying_amount AS amount, p.display_amount AS "displayAmount",
          p.currency_code AS "currencyCode", p.status, p.reference, coalesce(p.approved_at, p.created_at) AS "purchasedAt",
          p.daily_income_snapshot AS "dailyIncome", p.duration_days_snapshot AS "durationDays", count(i.income_day)::integer AS "incomePaidDays",
          CASE WHEN p.daily_income_snapshot > 0 AND count(i.income_day) < p.duration_days_snapshot
            THEN (coalesce(p.approved_at, p.created_at)::timestamptz + (count(i.income_day) + 1) * interval '1 day')::text ELSE NULL END AS "nextIncomeAt"
          FROM product_purchases p LEFT JOIN product_income_ledger i ON i.purchase_id = p.id
          WHERE p.user_id = $1 AND p.status = 'COMPLETED' GROUP BY p.id ORDER BY coalesce(p.approved_at, p.created_at) DESC`, [user.id]);
        return json({ products: result.rows.map((product) => ({ ...product, amount: Number(product.amount), displayAmount: Number(product.displayAmount || localAmount(product.amount, currency.unitsPerRwf)), currencyCode: product.currencyCode || currency.currencyCode, dailyIncome: Number(product.dailyIncome), displayDailyIncome: localAmount(Number(product.dailyIncome), currency.unitsPerRwf), durationDays: Number(product.durationDays), incomePaidDays: Number(product.incomePaidDays) })) });
      }

      if (path === '/api/wallet/daily-checkin' && method === 'GET') {
        const today = new Date().toISOString().slice(0, 10);
        const [settings, claim, currency] = await Promise.all([
          pool.query("SELECT key, value FROM support_settings WHERE key IN ('daily_checkin_enabled', 'daily_checkin_reward_amount')"),
          pool.query('SELECT reward_amount AS "rewardAmount", created_at AS "claimedAt" FROM daily_checkins WHERE user_id = $1 AND checkin_date = $2', [user.id, today]),
          currencyForUser(user.id),
        ]);
        const values = Object.fromEntries(settings.rows.map((row) => [row.key, row.value]));
        const rewardAmount = Number(values.daily_checkin_reward_amount ?? 0);
        return json({ enabled: values.daily_checkin_enabled === '1', rewardAmount, displayRewardAmount: localAmount(rewardAmount, currency.unitsPerRwf), currencyCode: currency.currencyCode, claimed: claim.rows.length > 0, claimedAt: claim.rows[0]?.claimedAt ?? null });
      }

      if (path === '/api/wallet/daily-checkin' && method === 'POST') {
        const today = new Date().toISOString().slice(0, 10);
        const settings = await pool.query("SELECT key, value FROM support_settings WHERE key IN ('daily_checkin_enabled', 'daily_checkin_reward_amount')");
        const values = Object.fromEntries(settings.rows.map((row) => [row.key, row.value]));
        const rewardAmount = Number(values.daily_checkin_reward_amount ?? 0);
        if (values.daily_checkin_enabled !== '1' || rewardAmount <= 0) return json({ error: 'Daily check-in is not enabled.' }, 403);
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const claimed = await client.query('INSERT INTO daily_checkins (user_id, checkin_date, reward_amount) VALUES ($1,$2,$3) ON CONFLICT (user_id, checkin_date) DO NOTHING RETURNING user_id', [user.id, today, rewardAmount]);
          if (!claimed.rowCount) { await client.query('ROLLBACK'); return json({ error: 'Daily check-in has already been claimed today.' }, 409); }
          await client.query('UPDATE wallet_accounts SET available_balance = available_balance + $1, updated_at = $2 WHERE user_id = $3', [rewardAmount, now(), user.id]);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
        const currency = await currencyForUser(user.id);
        return json({ claimed: true, rewardAmount, displayRewardAmount: localAmount(rewardAmount, currency.unitsPerRwf), currencyCode: currency.currencyCode, checkinDate: today, balance: await balanceView(user.id) }, 201);
      }

      if (path === '/api/support/settings' && method === 'GET') {
        const result = await pool.query("SELECT key, value FROM support_settings WHERE key IN ('telegram_url', 'telegram_popup_message', 'support_email', 'live_chat_enabled')");
        const values = Object.fromEntries(result.rows.map((row) => [row.key, row.value]));
        const canUseTelegram = Boolean(user.permissions.telegram);
        return json({ telegramUrl: canUseTelegram ? values.telegram_url ?? '' : '', telegramPopupMessage: canUseTelegram ? values.telegram_popup_message ?? '' : '', supportEmail: values.support_email ?? '', liveChatEnabled: values.live_chat_enabled === '1' });
      }

      if (path === '/api/admin/support/settings' && method === 'GET') {
        if (user.role !== 'ADMIN') return json({ error: 'Admin authentication required.' }, 401);
        const result = await pool.query("SELECT key, value FROM support_settings WHERE key IN ('telegram_url', 'telegram_popup_message', 'support_email', 'live_chat_enabled')");
        const values = Object.fromEntries(result.rows.map((row) => [row.key, row.value]));
        return json({ telegramUrl: values.telegram_url ?? '', telegramPopupMessage: values.telegram_popup_message ?? '', supportEmail: values.support_email ?? '', liveChatEnabled: values.live_chat_enabled === '1' });
      }

      if (path === '/api/admin/support/settings' && method === 'PUT') {
        if (user.role !== 'ADMIN') return json({ error: 'Admin authentication required.' }, 401);
        const input = await readBody(request);
        const telegramUrl = String(input.telegramUrl ?? '').trim();
        const telegramPopupMessage = String(input.telegramPopupMessage ?? '').trim();
        const supportEmail = String(input.supportEmail ?? '').trim();
        if (telegramUrl) {
          try {
            const parsed = new URL(telegramUrl);
            if (parsed.protocol !== 'https:' || !['t.me', 'telegram.me'].includes(parsed.hostname) || parsed.pathname === '/') throw new Error();
          } catch { return json({ error: 'Enter a valid HTTPS Telegram group link.' }, 400); }
        }
        if (supportEmail && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail) || supportEmail.length > 200)) return json({ error: 'Enter a valid support email address.' }, 400);
        if (telegramPopupMessage.length > 600) return json({ error: 'Telegram popup message must be 600 characters or fewer.' }, 400);
        const settings = {
          telegram_url: telegramUrl,
          telegram_popup_message: telegramPopupMessage,
          support_email: supportEmail,
          live_chat_enabled: input.liveChatEnabled ? '1' : '0',
        };
        for (const [key, value] of Object.entries(settings)) {
          await pool.query('INSERT INTO support_settings (key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at', [key, value, now()]);
        }
        return json({ telegramUrl: settings.telegram_url, telegramPopupMessage: settings.telegram_popup_message, supportEmail: settings.support_email, liveChatEnabled: settings.live_chat_enabled === '1' });
      }

      if (path === '/api/admin/countries' && method === 'GET') {
        if (user.role !== 'ADMIN') return json({ error: 'Admin authentication required.' }, 401);
        const countries = await pool.query('SELECT country_code AS "countryCode", country_name AS "countryName", phone_prefix AS "phonePrefix", currency_code AS "currencyCode", enabled, units_per_rwf AS "unitsPerRwf", units_per_usdt AS "unitsPerUsdt" FROM country_settings ORDER BY country_code');
        const [withdrawal, deposit] = await Promise.all([
          pool.query('SELECT m.code, m.name, c.country_code AS "countryCode", coalesce(c.enabled, 0) AS enabled FROM withdrawal_methods m LEFT JOIN country_withdrawal_methods c ON c.method_code = m.code ORDER BY m.name'),
          pool.query('SELECT code, name, enabled, country_code AS "countryCode" FROM deposit_methods ORDER BY position, name'),
        ]);
        return json({ countries: countries.rows.map((country) => ({
          ...country, enabled: Boolean(country.enabled), unitsPerRwf: Number(country.unitsPerRwf ?? 1),
          withdrawalMethods: [...new Map(withdrawal.rows.map((method) => [method.code, method])).values()].map((method) => ({ code: method.code, name: method.name, enabled: Boolean(withdrawal.rows.find((row) => row.code === method.code && row.countryCode === country.countryCode)?.enabled) })),
          depositMethods: deposit.rows.filter((method) => method.countryCode === country.countryCode).map((method) => ({ code: method.code, name: method.name, enabled: Boolean(method.enabled) })),
        })) });
      }

      if (path === '/api/admin/daily-checkin' && method === 'GET') {
        if (user.role !== 'ADMIN') return json({ error: 'Admin authentication required.' }, 401);
        const values = await pool.query("SELECT key, value FROM support_settings WHERE key IN ('daily_checkin_enabled','daily_checkin_reward_amount')");
        const settingMap = Object.fromEntries(values.rows.map((row) => [row.key, row.value]));
        return json({ enabled: settingMap.daily_checkin_enabled === '1', rewardAmount: Number(settingMap.daily_checkin_reward_amount ?? 0) });
      }

      if (path === '/api/admin/daily-checkin' && method === 'PUT') {
        if (user.role !== 'ADMIN') return json({ error: 'Admin authentication required.' }, 401);
        const input = await readBody(request);
        const enabled = Boolean(input.enabled);
        const rewardAmount = Number(input.rewardAmount ?? 0);
        await pool.query('INSERT INTO support_settings (key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at', ['daily_checkin_enabled', enabled ? '1' : '0', now()]);
        await pool.query('INSERT INTO support_settings (key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at', ['daily_checkin_reward_amount', String(Number.isFinite(rewardAmount) ? rewardAmount : 0), now()]);
        return json({ enabled, rewardAmount: Number.isFinite(rewardAmount) ? rewardAmount : 0 });
      }

      if (path === '/api/admin/referral-settings' && method === 'GET') {
        if (user.role !== 'ADMIN') return json({ error: 'Admin authentication required.' }, 401);
        const result = await pool.query('SELECT level, percentage FROM referral_settings ORDER BY level');
        return json({ settings: result.rows });
      }

      if (path === '/api/admin/referral-settings' && method === 'POST') {
        if (user.role !== 'ADMIN') return json({ error: 'Admin authentication required.' }, 401);
        const input = await readBody(request);
        const level = Number(input.level ?? 1);
        const percentage = Number(input.percentage ?? 0);
        await pool.query('UPDATE referral_settings SET percentage = $1, updated_at = $2 WHERE level = $3', [percentage, now(), level]);
        return json({ settings: (await pool.query('SELECT level, percentage FROM referral_settings ORDER BY level')).rows });
      }

      if (path === '/api/admin/messages/private' && method === 'POST') {
        if (user.role !== 'ADMIN') return json({ error: 'Admin authentication required.' }, 401);
        const input = await readBody(request);
        const recipientId = String(input.userId ?? '');
        const title = String(input.title ?? '').slice(0, 160);
        const body = String(input.body ?? '').trim();
        if (!recipientId || !body) return json({ error: 'Recipient and message body are required.' }, 400);
        const msg = await pool.query('INSERT INTO user_messages (id, sender_user_id, recipient_user_id, kind, title, body, notification_type, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *', [randomUUID(), user.id, recipientId, 'PRIVATE', title, body, String(input.notificationType ?? 'INFO'), now()]);
        return json({ message: msg.rows[0] }, 201);
      }

      if (path === '/api/admin/messages/broadcast' && method === 'POST') {
        if (user.role !== 'ADMIN') return json({ error: 'Admin authentication required.' }, 401);
        const input = await readBody(request);
        const body = String(input.body ?? '').trim();
        if (!body) return json({ error: 'Broadcast message cannot be empty.' }, 400);
        const msg = await pool.query('INSERT INTO user_messages (id, sender_user_id, recipient_user_id, kind, title, body, notification_type, created_at) VALUES ($1, $2, NULL, $3, $4, $5, $6, $7) RETURNING *', [randomUUID(), user.id, 'BROADCAST', String(input.title ?? '').slice(0, 160), body, String(input.notificationType ?? 'INFO'), now()]);
        return json({ broadcast: msg.rows[0] }, 201);
      }

      if (path === '/api/admin/support/conversations' && method === 'GET') {
        if (user.role !== 'ADMIN') return json({ error: 'Admin authentication required.' }, 401);
        const result = await pool.query('SELECT * FROM support_conversations ORDER BY updated_at DESC');
        return json({ conversations: result.rows });
      }

      const adminConversationMessagesRoute = path.match(/^\/api\/admin\/support\/conversations\/([^/]+)\/messages$/);
      if (adminConversationMessagesRoute) {
        const conversationId = decodeURIComponent(adminConversationMessagesRoute[1]);
        if (method === 'GET') {
          if (user.role !== 'ADMIN') return json({ error: 'Admin authentication required.' }, 401);
          const result = await pool.query('SELECT * FROM support_messages WHERE conversation_id = $1 ORDER BY created_at ASC', [conversationId]);
          return json({ messages: result.rows });
        }
        if (method === 'POST') {
          if (user.role !== 'ADMIN') return json({ error: 'Admin authentication required.' }, 401);
          const input = await readBody(request);
          const body = String(input.body ?? '').trim();
          if (!body) return json({ error: 'Reply cannot be empty.' }, 400);
          const result = await pool.query('INSERT INTO support_messages (id, conversation_id, author_id, body, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING *', [randomUUID(), conversationId, user.id, body, now()]);
          await pool.query('UPDATE support_conversations SET updated_at = $1 WHERE id = $2', [now(), conversationId]);
          return json({ message: result.rows[0] }, 201);
        }
      }

      if (path === '/api/user/messages' && method === 'GET') {
        const result = await pool.query(`SELECT m.id, m.kind, m.title, m.body, m.notification_type AS "notificationType", m.created_at AS "createdAt", CASE WHEN r.message_id IS NULL THEN 0 ELSE 1 END AS "isRead" FROM user_messages m LEFT JOIN user_message_reads r ON r.message_id = m.id AND r.user_id = $1 WHERE (m.recipient_user_id = $1 OR m.kind = 'BROADCAST') ORDER BY m.created_at DESC LIMIT 50`, [user.id]);
        return json({ messages: result.rows.map((row) => ({ ...row, isRead: Boolean(row.isRead) })), unreadCount: result.rows.filter((row) => !row.isRead).length });
      }

      const userMessageReadRoute = path.match(/^\/api\/user\/messages\/([^/]+)\/read$/);
      if (userMessageReadRoute && method === 'PATCH') {
        const messageId = decodeURIComponent(userMessageReadRoute[1]);
        await pool.query('INSERT INTO user_message_reads (message_id, user_id) VALUES ($1, $2) ON CONFLICT (message_id, user_id) DO NOTHING', [messageId, user.id]);
        return json({ read: true });
      }

      if (path === '/api/support/conversations' && method === 'GET') {
        const result = await pool.query('SELECT * FROM support_conversations WHERE user_id = $1 ORDER BY updated_at DESC', [user.id]);
        return json({ conversations: result.rows });
      }

      if (path === '/api/support/conversations' && method === 'POST') {
        const existing = await pool.query('SELECT * FROM support_conversations WHERE user_id = $1 AND status = $2 ORDER BY updated_at DESC LIMIT 1', [user.id, 'OPEN']);
        if (existing.rowCount) return json({ conversation: existing.rows[0] }, 200);
        const result = await pool.query('INSERT INTO support_conversations (id, user_id, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $4) RETURNING *', [randomUUID(), user.id, 'OPEN', now()]);
        return json({ conversation: result.rows[0] }, 201);
      }

      const supportConversationMessagesRoute = path.match(/^\/api\/support\/conversations\/([^/]+)\/messages$/);
      if (supportConversationMessagesRoute) {
        const conversationId = decodeURIComponent(supportConversationMessagesRoute[1]);
        if (method === 'GET') {
          const result = await pool.query('SELECT * FROM support_messages WHERE conversation_id = $1 ORDER BY created_at ASC', [conversationId]);
          return json({ messages: result.rows });
        }
        if (method === 'POST') {
          const input = await readBody(request);
          const body = String(input.body ?? '').trim();
          if (!body) return json({ error: 'Message body is required.' }, 400);
          const result = await pool.query('INSERT INTO support_messages (id, conversation_id, author_id, body, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING *', [randomUUID(), conversationId, user.id, body, now()]);
          await pool.query('UPDATE support_conversations SET updated_at = $1 WHERE id = $2', [now(), conversationId]);
          return json({ message: result.rows[0] }, 201);
        }
      }

      const isAdminUser = user.role === 'ADMIN';
      const adminDenied = () => json({ error: 'Sign in with an Admin account to manage users.' }, 401);

      if (path === '/api/admin/users' && method === 'GET') {
        if (!isAdminUser) return adminDenied();
        const search = String(url.searchParams.get('search') ?? '').trim().slice(0, 100);
        const requestedStatus = url.searchParams.get('status') ?? 'ALL';
        const statusFilter = accountStatuses.includes(requestedStatus) ? requestedStatus : 'ALL';
        const activeOnly = url.searchParams.get('active') === '1' ? 1 : 0;
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
        const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
        const filter = `c.deleted_at IS NULL AND ($1::text = '' OR u.full_name ILIKE '%' || $1::text || '%' OR u.phone_number ILIKE '%' || $1::text || '%')
          AND ($2::text = 'ALL' OR coalesce(c.account_status, 'ACTIVE') = $2::text)
          AND ($3::int = 0 OR EXISTS (SELECT 1 FROM product_purchases p WHERE p.user_id = u.id AND p.status = 'COMPLETED'))`;
        const [rows, total] = await Promise.all([
          pool.query(`SELECT u.id, u.full_name AS "fullName", u.phone_number AS "phoneNumber", u.referral_code AS "referralCode", u.role, u.country_code AS "countryCode", u.currency_code AS "currencyCode", u.created_at AS "createdAt",
            (SELECT max(s.last_seen_at) FROM auth_sessions s WHERE s.user_id = u.id) AS "lastActivity",
            ${lastSessionSql('last_seen_at')} AS "lastSeen", ${lastSessionSql('current_page')} AS "lastPage",
            ${totalsSql('u')}, ${referredBySql} AS "referredBy",
            u.welcome_bonus_amount AS "welcomeBonusAmount", u.welcome_bonus_awarded_at AS "welcomeBonusAwardedAt", u.welcome_bonus_unlocked_at AS "welcomeBonusUnlockedAt",
            coalesce(c.account_status, 'ACTIVE') AS "accountStatus", c.allow_deposits AS "allowDeposits", c.allow_withdrawals AS "allowWithdrawals",
            (SELECT status FROM wallet_transactions t WHERE t.user_id = u.id AND t.type = 'DEPOSIT' ORDER BY t.created_at DESC LIMIT 1) AS "lastDepositStatus",
            (SELECT status FROM wallet_transactions t WHERE t.user_id = u.id AND t.type = 'WITHDRAWAL' ORDER BY t.created_at DESC LIMIT 1) AS "lastWithdrawalStatus"
            FROM users u LEFT JOIN user_access_controls c ON c.user_id = u.id WHERE ${filter} ORDER BY u.created_at DESC LIMIT $4 OFFSET $5`, [search, statusFilter, activeOnly, limit, offset]),
          pool.query(`SELECT count(*)::integer AS count FROM users u LEFT JOIN user_access_controls c ON c.user_id = u.id WHERE ${filter}`, [search, statusFilter, activeOnly]),
        ]);
        const users = await Promise.all(rows.rows.map(async (row) => {
          const [wallet, currency] = await Promise.all([balanceView(row.id), currencyForUser(row.id)]);
          const live = isLive(row.lastSeen);
          const { lastSeen, lastPage, ...rest } = row;
          return {
            ...rest, isLive: live ? 1 : 0, currentPage: live ? lastPage : null,
            totalDeposit: Number(row.totalDeposit), totalWithdrawal: Number(row.totalWithdrawal),
            availableBalance: wallet.availableBalance, displayAvailableBalance: wallet.displayAvailableBalance,
            displayTotalDeposit: localAmount(Number(row.totalDeposit), currency.unitsPerRwf), displayTotalWithdrawal: localAmount(Number(row.totalWithdrawal), currency.unitsPerRwf),
            displayWelcomeBonusAmount: wallet.displayWelcomeBonusAmount, welcomeBonusUnlockedAt: wallet.welcomeBonusUnlockedAt,
            allowDeposits: row.allowDeposits === null ? true : Boolean(row.allowDeposits), allowWithdrawals: row.allowWithdrawals === null ? true : Boolean(row.allowWithdrawals),
          };
        }));
        return json({ users, total: total.rows[0].count, limit, offset });
      }

      const adminUserRoute = path.match(/^\/api\/admin\/users\/([^/]+)$/);
      if (adminUserRoute && method === 'GET') {
        if (!isAdminUser) return adminDenied();
        const targetId = decodeURIComponent(adminUserRoute[1]);
        const targetResult = await pool.query(`SELECT u.id, u.full_name AS "fullName", u.phone_number AS "phoneNumber", u.referral_code AS "referralCode", u.role, u.country_code AS "countryCode", u.currency_code AS "currencyCode", u.created_at AS "createdAt",
          (SELECT max(s.last_seen_at) FROM auth_sessions s WHERE s.user_id = u.id) AS "lastActivity",
          ${lastSessionSql('last_seen_at')} AS "lastSeen", ${lastSessionSql('current_page')} AS "lastPage", ${referredBySql} AS "referredBy",
          u.welcome_bonus_amount AS "welcomeBonusAmount", u.welcome_bonus_awarded_at AS "welcomeBonusAwardedAt"
          FROM users u WHERE u.id = $1`, [targetId]);
        const target = targetResult.rows[0];
        if (!target) return json({ error: 'User not found.' }, 404);
        const [controls, wallet, currency, totals, commission, transactions, messages, audit] = await Promise.all([
          userAccess(targetId), balanceView(targetId), currencyForUser(targetId),
          pool.query(`SELECT ${totalsSql('u')} FROM users u WHERE u.id = $1`, [targetId]),
          pool.query("SELECT coalesce(sum(commission_amount), 0)::bigint::text AS amount FROM commission_ledger WHERE beneficiary_user_id = $1 AND status IN ('PENDING','APPROVED')", [targetId]),
          pool.query('SELECT * FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [targetId]),
          pool.query(`SELECT m.id, m.kind, m.title, m.body, m.notification_type AS "notificationType", m.created_at AS "createdAt", CASE WHEN r.message_id IS NULL THEN 0 ELSE 1 END AS "isRead"
            FROM user_messages m LEFT JOIN user_message_reads r ON r.message_id = m.id AND r.user_id = $1 WHERE m.recipient_user_id = $1 OR m.kind = 'BROADCAST' ORDER BY m.created_at DESC LIMIT 50`, [targetId]),
          pool.query('SELECT id, action, previous_value AS "previousValue", new_value AS "newValue", metadata, created_at AS "createdAt" FROM admin_audit_log WHERE target_user_id = $1 ORDER BY created_at DESC LIMIT 50', [targetId]),
        ]);
        const live = isLive(target.lastSeen);
        const { lastSeen, lastPage, ...rest } = target;
        const financial = { totalDeposit: Number(totals.rows[0].totalDeposit), totalWithdrawal: Number(totals.rows[0].totalWithdrawal), productsPurchased: totals.rows[0].productsPurchased, referralCommissionEarned: Number(commission.rows[0].amount) };
        return json({
          user: {
            ...rest, isLive: live ? 1 : 0, currentPage: live ? lastPage : null, ...controls, ...wallet, ...financial,
            displayTotalDeposit: localAmount(financial.totalDeposit, currency.unitsPerRwf), displayTotalWithdrawal: localAmount(financial.totalWithdrawal, currency.unitsPerRwf),
            displayReferralCommissionEarned: localAmount(financial.referralCommissionEarned, currency.unitsPerRwf),
          },
          transactions: transactions.rows.map((row) => transactionView(row, currency)),
          messages: messages.rows.map((message) => ({ ...message, isRead: Boolean(message.isRead) })),
          audit: audit.rows,
        });
      }

      if (adminUserRoute && method === 'PATCH') {
        if (!isAdminUser) return adminDenied();
        const targetId = decodeURIComponent(adminUserRoute[1]);
        const targetResult = await pool.query('SELECT id, full_name AS "fullName", role FROM users WHERE id = $1', [targetId]);
        const target = targetResult.rows[0];
        if (!target) return json({ error: 'User not found.' }, 404);
        const input = await readBody(request);
        if (targetId === user.id && ['role', 'permissions', 'accountStatus', 'allowDeposits', 'allowWithdrawals'].some((field) => input[field] !== undefined)) return json({ error: 'You cannot change your own Admin role, status or permissions.' }, 403);
        if (input.role !== undefined && !['USER', 'ADMIN'].includes(String(input.role))) return json({ error: 'Role must be USER or ADMIN.' }, 400);
        const fullName = input.fullName === undefined ? undefined : String(input.fullName).trim();
        if (fullName !== undefined && (fullName.length < 2 || fullName.length > 100)) return json({ error: 'Name must be between 2 and 100 characters.' }, 400);
        if (['allowDeposits', 'allowWithdrawals'].some((field) => input[field] !== undefined && typeof input[field] !== 'boolean')) return json({ error: 'Deposit and withdrawal access values must be true or false.' }, 400);
        if (input.accountStatus !== undefined && !accountStatuses.includes(String(input.accountStatus))) return json({ error: 'Invalid account status.' }, 400);
        const permissionsInput = input.permissions;
        if (permissionsInput !== undefined && (!permissionsInput || typeof permissionsInput !== 'object' || Array.isArray(permissionsInput))) return json({ error: 'Feature permissions must be an object.' }, 400);
        const permissions = (permissionsInput ?? {}) as Record<string, unknown>;
        if (Object.entries(permissions).some(([feature, enabled]) => !userFeatures.includes(feature) || typeof enabled !== 'boolean')) return json({ error: 'One or more feature permissions are invalid.' }, 400);

        if (input.role !== undefined && input.role !== target.role) {
          if (target.role === 'ADMIN' && input.role === 'USER') {
            const admins = await pool.query("SELECT count(*)::integer AS count FROM users WHERE role = 'ADMIN'");
            if (admins.rows[0].count <= 1) return json({ error: 'The last Admin account cannot be demoted.' }, 409);
            await pool.query('DELETE FROM auth_sessions WHERE user_id = $1', [targetId]);
          }
          await pool.query('UPDATE users SET role = $1, updated_at = $2 WHERE id = $3', [input.role, now(), targetId]);
          await auditAdmin(user.id, targetId, 'USER_ROLE_UPDATED', { role: target.role }, { role: input.role });
        }
        if (fullName !== undefined) {
          await pool.query('UPDATE users SET full_name = $1, updated_at = $2 WHERE id = $3', [fullName, now(), targetId]);
          await auditAdmin(user.id, targetId, 'USER_UPDATED', { fullName: target.fullName }, { fullName });
        }
        const hasControls = input.accountStatus !== undefined || input.allowDeposits !== undefined || input.allowWithdrawals !== undefined;
        if (hasControls || Object.keys(permissions).length) {
          const before = await userAccess(targetId);
          const status = input.accountStatus !== undefined ? String(input.accountStatus) : before.accountStatus;
          const allowDeposits = typeof input.allowDeposits === 'boolean' ? input.allowDeposits : before.allowDeposits;
          const allowWithdrawals = typeof input.allowWithdrawals === 'boolean' ? input.allowWithdrawals : before.allowWithdrawals;
          await pool.query(`INSERT INTO user_access_controls (user_id, account_status, allow_deposits, allow_withdrawals, deleted_at, updated_by, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)
            ON CONFLICT (user_id) DO UPDATE SET account_status = EXCLUDED.account_status, allow_deposits = EXCLUDED.allow_deposits, allow_withdrawals = EXCLUDED.allow_withdrawals, deleted_at = EXCLUDED.deleted_at, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
          [targetId, status, allowDeposits ? 1 : 0, allowWithdrawals ? 1 : 0, status === 'SUSPENDED' ? before.deletedAt ?? now() : null, user.id, now()]);
          for (const [feature, enabled] of Object.entries(permissions)) {
            await pool.query(`INSERT INTO user_permissions (user_id, feature, enabled, updated_by, updated_at) VALUES ($1,$2,$3,$4,$5)
              ON CONFLICT (user_id, feature) DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`, [targetId, feature, enabled ? 1 : 0, user.id, now()]);
            if (before.permissions[feature] !== enabled) await auditAdmin(user.id, targetId, 'PERMISSION_CHANGED', { feature, enabled: before.permissions[feature] }, { feature, enabled });
          }
          if (before.accountStatus !== status) await auditAdmin(user.id, targetId, `USER_STATUS_${status}`, { accountStatus: before.accountStatus }, { accountStatus: status });
          if (before.allowWithdrawals !== allowWithdrawals) await auditAdmin(user.id, targetId, allowWithdrawals ? 'WITHDRAW_ENABLED' : 'WITHDRAW_DISABLED', { allowWithdrawals: before.allowWithdrawals }, { allowWithdrawals });
          if (before.allowDeposits !== allowDeposits) await auditAdmin(user.id, targetId, allowDeposits ? 'DEPOSIT_ENABLED' : 'DEPOSIT_DISABLED', { allowDeposits: before.allowDeposits }, { allowDeposits });
          if (status === 'SUSPENDED') await pool.query('DELETE FROM auth_sessions WHERE user_id = $1', [targetId]);
        }
        const refreshed = await pool.query('SELECT id, full_name AS "fullName", phone_number AS "phoneNumber", referral_code AS "referralCode", role FROM users WHERE id = $1', [targetId]);
        return json({ user: { ...refreshed.rows[0], ...(await userAccess(targetId)) } });
      }

      const passwordResetRoute = path.match(/^\/api\/admin\/users\/([^/]+)\/reset-password$/);
      if (passwordResetRoute && method === 'POST') {
        if (!isAdminUser) return adminDenied();
        const targetId = decodeURIComponent(passwordResetRoute[1]);
        const targetResult = await pool.query('SELECT id, role FROM users WHERE id = $1', [targetId]);
        const target = targetResult.rows[0];
        if (!target) return json({ error: 'User not found.' }, 404);
        if (target.role === 'ADMIN' && user.id !== targetId) return json({ error: 'An Admin cannot reset another Admin password.' }, 403);
        const temporaryPassword = String(randomInt(0, 1000000)).padStart(6, '0');
        await pool.query('UPDATE users SET password_hash = $1, updated_at = $2 WHERE id = $3', [passwordHash(temporaryPassword), now(), targetId]);
        await pool.query('DELETE FROM auth_sessions WHERE user_id = $1', [targetId]);
        await auditAdmin(user.id, targetId, 'PASSWORD_RESET', null, { sessionsInvalidated: true });
        return json({ temporaryPassword });
      }

      if (path === '/api/admin/live-users' && method === 'GET') {
        if (!isAdminUser) return adminDenied();
        const search = String(url.searchParams.get('search') ?? '').trim().slice(0, 100);
        const page = String(url.searchParams.get('page') ?? 'ALL').trim().slice(0, 40);
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 25));
        const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
        const filter = `s.expires_at::timestamptz > now() AND s.last_seen_at::timestamptz >= now() - ${liveWindowSql}
          AND ($1::text = '' OR u.full_name ILIKE '%' || $1::text || '%' OR u.phone_number ILIKE '%' || $1::text || '%') AND ($2::text = 'ALL' OR s.current_page = $2::text)`;
        const [sessions, total] = await Promise.all([
          pool.query(`SELECT s.id AS "sessionId", s.user_id AS "userId", u.full_name AS "fullName", u.phone_number AS "phoneNumber", u.country_code AS "countryCode", u.currency_code AS "currencyCode",
            s.current_page AS "currentPage", s.last_seen_at AS "lastActive", s.created_at AS "loginAt", ${totalsSql('u')}, coalesce(w.available_balance, 0)::bigint::text AS "currentBalance", ${referredBySql} AS "promoterName"
            FROM auth_sessions s JOIN users u ON u.id = s.user_id LEFT JOIN wallet_accounts w ON w.user_id = u.id WHERE ${filter} ORDER BY s.last_seen_at DESC LIMIT $3 OFFSET $4`, [search, page, limit, offset]),
          pool.query(`SELECT count(*)::integer AS count FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE ${filter}`, [search, page]),
        ]);
        const users = await Promise.all(sessions.rows.map(async (session) => {
          const [currency, wallet] = await Promise.all([currencyForUser(session.userId), balanceView(session.userId)]);
          return {
            ...session, lastSeenAt: session.lastActive, totalDeposit: Number(session.totalDeposit), totalWithdrawal: Number(session.totalWithdrawal), currentBalance: Number(session.currentBalance),
            displayTotalDeposit: localAmount(Number(session.totalDeposit), currency.unitsPerRwf), displayTotalWithdrawal: localAmount(Number(session.totalWithdrawal), currency.unitsPerRwf),
            displayCurrentBalance: wallet.displayAvailableBalance, currencyCode: currency.currencyCode, active: session.productsPurchased > 0,
          };
        }));
        return json({ users, total: total.rows[0].count, limit, offset, onlineWindowSeconds: 20 });
      }

      if (path === '/api/admin/members' && method === 'GET') {
        if (!isAdminUser) return json({ error: 'Admin authentication required.' }, 401);
        const members = await pool.query('SELECT u.id, u.full_name AS "fullName", u.phone_number AS "phoneNumber", u.referral_code AS "referralCode", u.role, u.created_at AS "createdAt", coalesce(w.available_balance, 0)::bigint::text AS "availableBalance" FROM users u LEFT JOIN wallet_accounts w ON w.user_id = u.id ORDER BY u.created_at DESC LIMIT 500');
        return json({ members: members.rows.map((member) => ({ ...member, availableBalance: Number(member.availableBalance) })) });
      }

      if (path === '/api/admin/plans' && method === 'GET') {
        if (!isAdminUser) return json({ error: 'Admin authentication required.' }, 401);
        const plans = await pool.query(`SELECT ${planColumns} FROM plans ORDER BY position, name`);
        return json({ plans: plans.rows.map(planView) });
      }

      if (path === '/api/admin/plans' && method === 'POST') {
        if (!isAdminUser) return json({ error: 'Admin authentication required.' }, 401);
        const parsed = parsePlan(await readBody(request));
        if ('error' in parsed) return json({ error: parsed.error }, 400);
        const plan = parsed.value;
        try {
          await pool.query('INSERT INTO plans (name, deposited, income_per_day, term, status, note, position, description, image_data, price, daily_income, duration_days, purchase_bonus, total_slots, sold_slots) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,0)',
            [plan.name, String(plan.price), String(plan.dailyIncome), `${plan.durationDays} days`, plan.status, plan.description, plan.position, plan.description, plan.imageData, plan.price, plan.dailyIncome, plan.durationDays, 0, plan.totalSlots]);
        } catch (error) {
          if ((error as { code?: string }).code === '23505') return json({ error: 'A product with that name already exists.' }, 409);
          throw error;
        }
        return json({ plan: planView((await pool.query(`SELECT ${planColumns} FROM plans WHERE name = $1`, [plan.name])).rows[0]) }, 201);
      }

      const adminPlanRoute = path.match(/^\/api\/admin\/plans\/([^/]+)$/);
      if (adminPlanRoute && method === 'PUT') {
        if (!isAdminUser) return json({ error: 'Admin authentication required.' }, 401);
        const name = decodeURIComponent(adminPlanRoute[1]);
        const parsed = parsePlan({ ...(await readBody(request)), name }, { keepExistingImage: true });
        if ('error' in parsed) return json({ error: parsed.error }, 400);
        const plan = parsed.value;
        const current = await pool.query('SELECT sold_slots FROM plans WHERE name = $1', [name]);
        if (!current.rows[0]) return json({ error: 'Product not found.' }, 404);
        if (plan.totalSlots < Number(current.rows[0].sold_slots)) return json({ error: `Total slots cannot be less than ${current.rows[0].sold_slots} slots already sold.` }, 400);
        await pool.query('UPDATE plans SET deposited = $1, income_per_day = $2, term = $3, status = $4, note = $5, position = $6, description = $7, image_data = COALESCE($8::text, image_data), price = $9, daily_income = $10, duration_days = $11, purchase_bonus = 0, total_slots = $12 WHERE name = $13',
          [String(plan.price), String(plan.dailyIncome), `${plan.durationDays} days`, plan.status, plan.description, plan.position, plan.description, plan.imageData, plan.price, plan.dailyIncome, plan.durationDays, plan.totalSlots, name]);
        return json({ plan: planView((await pool.query(`SELECT ${planColumns} FROM plans WHERE name = $1`, [name])).rows[0]) });
      }

      if (adminPlanRoute && method === 'DELETE') {
        if (!isAdminUser) return json({ error: 'Admin authentication required.' }, 401);
        const name = decodeURIComponent(adminPlanRoute[1]);
        const used = await pool.query('SELECT id FROM product_purchases WHERE product_name = $1 LIMIT 1', [name]);
        if (used.rowCount) return json({ error: 'Products with purchase history cannot be deleted.' }, 409);
        const deleted = await pool.query('DELETE FROM plans WHERE name = $1', [name]);
        if (!deleted.rowCount) return json({ error: 'Plan not found.' }, 404);
        return json({ deleted: true });
      }

      if (path === '/api/admin/audit-log' && method === 'GET') {
        if (!isAdminUser) return json({ error: 'Admin authentication required.' }, 401);
        const [walletEntries, accountEntries] = await Promise.all([
          pool.query('SELECT id, transaction_id AS "targetUserId", actor_id AS "adminUserId", action, details AS metadata, created_at AS "createdAt" FROM wallet_audit_logs ORDER BY created_at DESC LIMIT 200'),
          pool.query('SELECT id, target_user_id AS "targetUserId", admin_user_id AS "adminUserId", action, metadata, created_at AS "createdAt" FROM admin_audit_log ORDER BY created_at DESC LIMIT 200'),
        ]);
        const entries = [...walletEntries.rows, ...accountEntries.rows].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt))).slice(0, 200);
        return json({ entries });
      }

      if (path === '/api/admin/platform-settings' && method === 'GET') {
        if (!isAdminUser) return json({ error: 'Admin authentication required.' }, 401);
        return json(await platformSettings());
      }

      if (path === '/api/admin/platform-settings' && method === 'PUT') {
        if (!isAdminUser) return json({ error: 'Admin authentication required.' }, 401);
        const input = await readBody(request);
        const feeType = input.withdrawalFeeType;
        const feeValue = Number(input.withdrawalFeeValue);
        const welcomeAmount = Number(input.welcomeBonusAmount);
        const minimumWithdrawal = Number(input.minimumWithdrawal ?? 0);
        if (!Number.isSafeInteger(minimumWithdrawal) || minimumWithdrawal < 0) return json({ error: 'Enter a valid minimum withdrawal amount.' }, 400);
        const usdtFeePercent = Number(input.usdtFeePercent);
        if (!Number.isFinite(usdtFeePercent) || usdtFeePercent < 0 || usdtFeePercent >= 100) return json({ error: 'Enter a valid USDT fee percentage (0 to 99.99).' }, 400);
        if (typeof input.withdrawalFeeEnabled !== 'boolean' || !['PERCENTAGE', 'FIXED'].includes(String(feeType)) || !Number.isFinite(feeValue) || feeValue < 0 || (feeType === 'PERCENTAGE' && feeValue > 100) || (feeType === 'FIXED' && !Number.isSafeInteger(feeValue))) return json({ error: 'Enter a valid withdrawal fee type and value.' }, 400);
        if (typeof input.welcomeBonusEnabled !== 'boolean' || !Number.isSafeInteger(welcomeAmount) || welcomeAmount < 0) return json({ error: 'Enter a valid welcome bonus amount.' }, 400);
        const values = { withdrawal_fee_enabled: input.withdrawalFeeEnabled ? '1' : '0', withdrawal_fee_type: String(feeType), withdrawal_fee_value: String(feeValue), welcome_bonus_enabled: input.welcomeBonusEnabled ? '1' : '0', welcome_bonus_amount: String(welcomeAmount), minimum_withdrawal_amount: String(minimumWithdrawal), usdt_fee_percent: String(usdtFeePercent) };
        for (const [key, value] of Object.entries(values)) {
          await pool.query('INSERT INTO support_settings (key, value, updated_at) VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at', [key, value, now()]);
        }
        return json(await platformSettings());
      }

      const depositMethodFilter = "d.enabled::int = 1 AND trim(d.account_name) <> '' AND trim(d.account_number) <> ''";
      if (path === '/api/admin/deposit-methods' && method === 'GET') {
        if (!isAdminUser) return json({ error: 'Admin authentication required.' }, 401);
        const rows = await pool.query('SELECT * FROM deposit_methods ORDER BY position, name');
        return json({ methods: await Promise.all(rows.rows.map((row) => depositMethodView(row))), maximumMethods: 10 });
      }

      if ((path === '/api/deposit-methods' || path === '/api/wallet/deposit/methods') && method === 'GET') {
        const currency = await currencyForUser(user.id);
        const rows = await pool.query(`SELECT d.* FROM deposit_methods d WHERE d.country_code = $1 AND ${depositMethodFilter} ORDER BY d.position, d.name`, [currency.countryCode]);
        const { usdtFeePercent } = await platformSettings();
        return json({ methods: await Promise.all(rows.rows.map(async (row) => ({ ...(await depositMethodView(row, currency)), usdtFeePercent }))), currencyCode: currency.currencyCode });
      }

      if (path === '/api/wallet/withdraw/methods' && method === 'GET') {
        const currency = await currencyForUser(user.id);
        const rows = await pool.query('SELECT m.code, m.name FROM withdrawal_methods m JOIN country_withdrawal_methods c ON c.method_code = m.code WHERE m.enabled::int = 1 AND c.enabled::int = 1 AND c.country_code = $1 ORDER BY m.name', [currency.countryCode]);
        return json({ methods: rows.rows });
      }

      if (path === '/api/wallet/withdraw/account' && method === 'GET') {
        const account = await withdrawalAccountFor(user.id);
        return json({ account });
      }

      if (path === '/api/wallet/transactions' && method === 'GET') {
        const [rows, currency] = await Promise.all([pool.query('SELECT * FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100', [user.id]), currencyForUser(user.id)]);
        return json({ transactions: rows.rows.map((row) => transactionView(row, currency)) });
      }

      if (path === '/api/admin/transactions' && method === 'GET') {
        if (!isAdminUser) return json({ error: 'Admin authentication required.' }, 401);
        const rows = await pool.query('SELECT t.*, u.full_name AS user_name FROM wallet_transactions t LEFT JOIN users u ON u.id = t.user_id ORDER BY t.created_at DESC LIMIT 200');
        const fallback = { countryCode: 'RW', currencyCode: 'RWF', unitsPerRwf: 1 };
        return json({ transactions: rows.rows.map((row) => ({ ...transactionView(row, fallback), userName: row.user_name ?? 'Account holder', phoneNumber: row.phone_number })) });
      }

      if (path === '/api/team' && method === 'GET') {
        const [currency, memberRows, commissionRows, summaryRows, usageRows, settingRows] = await Promise.all([
          currencyForUser(user.id),
          pool.query(`WITH RECURSIVE team(user_id, sponsor_user_id, level, joined_at) AS (
            SELECT r.user_id, r.sponsor_user_id, 1, r.created_at FROM referral_relationships r WHERE r.sponsor_user_id = $1
            UNION ALL
            SELECT r.user_id, r.sponsor_user_id, team.level + 1, r.created_at FROM referral_relationships r JOIN team ON r.sponsor_user_id = team.user_id WHERE team.level < 3
          )
          SELECT team.user_id AS "userId", team.sponsor_user_id AS "sponsorUserId", team.joined_at AS "joinedAt", team.level, u.full_name AS "displayName", u.phone_number AS "phoneNumber",
            (SELECT count(*)::integer FROM product_purchases p WHERE p.user_id = team.user_id AND p.status = 'COMPLETED') AS "qualifyingProducts",
            (SELECT coalesce(sum(c.commission_amount), 0)::bigint::text FROM commission_ledger c WHERE c.beneficiary_user_id = $1 AND c.source_user_id = team.user_id AND c.status = 'APPROVED') AS "commissionEarned"
          FROM team JOIN users u ON u.id = team.user_id ORDER BY team.level, team.joined_at DESC`, [user.id]),
          pool.query(`SELECT c.id, c.source_user_id AS "sourceUserId", source.full_name AS "sourceUserName", c.product_id AS "productId", c.purchase_id AS "purchaseId", c.referral_level AS "referralLevel", c.percentage,
            c.qualifying_amount AS "qualifyingAmount", c.commission_amount AS "commissionAmount", c.status, c.created_at AS "createdAt", c.approved_at AS "approvedAt", c.reference
            FROM commission_ledger c JOIN users source ON source.id = c.source_user_id WHERE c.beneficiary_user_id = $1 ORDER BY c.created_at DESC`, [user.id]),
          pool.query(`SELECT coalesce(sum(CASE WHEN status = 'PENDING' THEN commission_amount ELSE 0 END), 0)::bigint::text AS "pendingCommission",
            coalesce(sum(CASE WHEN status = 'APPROVED' AND credited_at IS NOT NULL THEN commission_amount ELSE 0 END), 0)::bigint::text AS "creditedCommission" FROM commission_ledger WHERE beneficiary_user_id = $1`, [user.id]),
          pool.query(`SELECT coalesce(sum(CASE WHEN status = 'SUCCESS' THEN commission_amount ELSE 0 END), 0)::bigint::text AS "withdrawnCommission",
            coalesce(sum(CASE WHEN status NOT IN ('REJECTED','FAILED','CANCELLED','SUCCESS') THEN commission_amount ELSE 0 END), 0)::bigint::text AS "reservedCommission" FROM wallet_transactions WHERE user_id = $1 AND type = 'WITHDRAWAL'`, [user.id]),
          pool.query('SELECT level, percentage FROM referral_settings ORDER BY level'),
        ]);
        const rate = currency.unitsPerRwf;
        const pending = Number(summaryRows.rows[0].pendingCommission);
        const credited = Number(summaryRows.rows[0].creditedCommission);
        const withdrawn = Number(usageRows.rows[0].withdrawnCommission);
        const reserved = Number(usageRows.rows[0].reservedCommission);
        const available = Math.max(0, credited - withdrawn - reserved);
        const levels = memberRows.rows.map((member) => ({ ...member, commissionEarned: Number(member.commissionEarned), activeReferral: member.qualifyingProducts > 0, displayCommissionEarned: localAmount(Number(member.commissionEarned), rate), currencyCode: currency.currencyCode }));
        const commissions = commissionRows.rows.map((item) => ({ ...item, displayQualifyingAmount: localAmount(Number(item.qualifyingAmount), rate), displayCommissionAmount: localAmount(Number(item.commissionAmount), rate), currencyCode: currency.currencyCode }));
        const host = request.headers.get('x-forwarded-host') ?? url.host;
        const protocol = request.headers.get('x-forwarded-proto') ?? 'https';
        return json({
          referralCode: user.referralCode, referralLink: `${protocol}://${host}/register?ref=${encodeURIComponent(user.referralCode)}`, levels, settings: settingRows.rows, commissions,
          activeReferrals: levels.filter((member) => member.activeReferral).length, pendingCommission: pending, displayPendingCommission: localAmount(pending, rate),
          availableCommission: available, displayAvailableCommission: localAmount(available, rate), withdrawnCommission: withdrawn, displayWithdrawnCommission: localAmount(withdrawn, rate),
          earnings: credited + pending, displayEarnings: localAmount(credited + pending, rate), countryCode: currency.countryCode, currencyCode: currency.currencyCode, exchangeRate: rate,
        });
      }

      const featureGuard = (feature: 'deposit' | 'withdraw' | 'products') => {
        if (!user.enabled || user.unitsPerRwf <= 0) return json({ error: 'Payments are disabled for this country. Contact support.', code: 'COUNTRY_DISABLED', countryCode: user.countryCode }, 403);
        if (user.accountStatus === 'FROZEN' || user.accountStatus === 'SUSPENDED') return json({ error: user.accountStatus === 'FROZEN' ? 'Your account is frozen. Contact support for assistance.' : 'Your account is suspended. Contact support for assistance.', code: `ACCOUNT_${user.accountStatus}` }, 403);
        if (user.accountStatus === 'RESTRICTED' && feature !== 'products') return json({ error: 'Deposits and withdrawals are restricted on this account. Contact support.', code: 'ACCOUNT_RESTRICTED' }, 403);
        if (!user.permissions[feature]) return json({ error: `Access to ${feature} is disabled for this account. Contact support.`, code: 'FEATURE_DISABLED', feature }, 403);
        if (feature === 'deposit' && !user.allowDeposits) return json({ error: 'Deposit access is disabled for this account. Contact support.', code: 'DEPOSIT_DISABLED' }, 403);
        if (feature === 'withdraw' && !user.allowWithdrawals) return json({ error: 'Withdrawal access is disabled for this account. Contact support.', code: 'WITHDRAWAL_DISABLED' }, 403);
        return null;
      };

      if (path === '/api/wallet/withdraw/account' && method === 'PUT') {
        const blocked = featureGuard('withdraw'); if (blocked) return blocked;
        const input = await readBody(request);
        const accountHolderName = String(input.accountHolderName ?? '').trim().slice(0, 120);
        const paymentMethod = String(input.paymentMethod ?? '');
        const isCrypto = paymentMethod === cryptoMethod;
        const walletAddress = isCrypto ? String(input.walletAddress ?? '').trim() : '';
        const phoneNumber = isCrypto ? '' : String(input.phoneNumber ?? '').replace(/[\s-]/g, '');
        const detailsValid = isCrypto ? validTronAddress(walletAddress) && Number(user.unitsPerUsdt) > 0 : Boolean(normalizePhone(phoneNumber, user.countryCode));
        if (!accountHolderName || !detailsValid || !withdrawalMethodCodes.includes(paymentMethod) || !(await withdrawalMethodEnabled(paymentMethod, user.countryCode))) {
          return json({ error: 'Choose a payment method enabled for your country and enter a valid phone number.' }, 400);
        }
        await pool.query(`INSERT INTO withdrawal_accounts (user_id, account_holder_name, phone_number, wallet_address, payment_method, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$6)
          ON CONFLICT (user_id) DO UPDATE SET account_holder_name = EXCLUDED.account_holder_name, phone_number = EXCLUDED.phone_number, wallet_address = EXCLUDED.wallet_address, payment_method = EXCLUDED.payment_method, updated_at = EXCLUDED.updated_at`, [user.id, accountHolderName, phoneNumber, walletAddress, paymentMethod, now()]);
        return json({ account: await withdrawalAccountFor(user.id) });
      }

      if (path === '/api/wallet/deposit' || path === '/api/deposits') {
        if (method !== 'POST') return json({ error: 'Not found' }, 404);
        const blocked = featureGuard('deposit'); if (blocked) return blocked;
        const input = await readBody(request);
        const displayAmount = positiveInteger(input.amount);
        const amount = displayAmount ? convertLocalToRwf(displayAmount, user.unitsPerRwf) : null;
        const phoneNumber = String(input.phoneNumber ?? '').replace(/[\s-]/g, '');
        const senderName = String(input.senderName ?? '').trim().slice(0, 120);
        const depositMethodId = String(input.depositMethodId ?? '').trim();
        const screenshotData = input.screenshotData;
        const methodResult = depositMethodId ? await pool.query('SELECT * FROM deposit_methods WHERE code = $1 AND country_code = $2 AND enabled::int = 1', [depositMethodId, user.countryCode]) : { rows: [] as Record<string, any>[] };
        const depositMethod = methodResult.rows[0];
        if (!amount || !displayAmount || !normalizePhone(phoneNumber, user.countryCode) || !senderName || !depositMethod || !String(depositMethod.account_name ?? '').trim() || !String(depositMethod.account_number ?? '').trim() || !imageDataValid(screenshotData, 4 * 1024 * 1024)) {
          return json({ error: 'Choose an active payment method for your country, enter a valid amount, phone number and payer name, and attach a PNG, JPEG, or WebP payment screenshot (max 4 MB).' }, 400);
        }
        const minimum = Number(depositMethod.minimum_amount);
        const maximum = Number(depositMethod.maximum_amount);
        if (amount < minimum || amount > maximum) return json({ error: `Amount must be between ${localAmount(minimum, user.unitsPerRwf).toLocaleString()} and ${localAmount(maximum, user.unitsPerRwf).toLocaleString()} ${user.currencyCode} for ${depositMethod.name}.` }, 400);
        const isCrypto = depositMethod.crypto_network === cryptoNetworkTrc20;
        const receiving = isCrypto ? { countryCode: user.countryCode, currencyCode: 'USDT' } : await countrySettings(depositMethod.receiving_country_code ?? user.countryCode);
        const receivingRate = isCrypto ? Number(user.unitsPerUsdt) : Number(receiving?.unitsPerRwf);
        const usdtFeePercent = isCrypto ? (await platformSettings()).usdtFeePercent : 0;
        const paymentAmount = receiving && receivingRate > 0 ? (isCrypto ? usdtWithFee(usdtAmount(amount, user.unitsPerRwf, receivingRate), usdtFeePercent, 'deposit') : localAmount(amount, receivingRate)) : 0;
        if (!receiving || receivingRate <= 0 || paymentAmount <= 0) return json({ error: 'The receiving payment account does not have a valid exchange rate.' }, 400);
        const id = randomUUID();
        const timestamp = now();
        const inserted = await pool.query(`INSERT INTO wallet_transactions (id, user_id, type, amount, sender_name, receiver_name, phone_number, payment_method, deposit_method_id, deposit_method_name, screenshot_data, status, provider, internal_reference,
          deposit_receiving_country_code, deposit_receiving_currency_code, deposit_receiving_exchange_rate, deposit_payment_amount, crypto_network, crypto_amount, crypto_units_per_usdt, crypto_address, created_at, updated_at)
          VALUES ($1,$2,'DEPOSIT',$3,$4,'',$5,$6,$7,$8,$9,'PENDING','ADMIN_REVIEW',$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19) RETURNING *`,
        [id, user.id, amount, senderName, phoneNumber, depositMethod.name, depositMethod.code, depositMethod.name, screenshotData, `DEP-${randomUUID()}`, receiving.countryCode, receiving.currencyCode, receivingRate, paymentAmount, isCrypto ? cryptoNetworkTrc20 : '', isCrypto ? paymentAmount : null, isCrypto ? receivingRate : null, isCrypto ? depositMethod.account_number : null, timestamp]);
        return json({ transaction: transactionView(inserted.rows[0], user) }, 201);
      }

      const withdrawalRoute = path === '/api/wallet/withdraw/preview' || path === '/api/withdrawals/preview' ? 'preview' : path === '/api/wallet/withdraw' || path === '/api/withdrawals' ? 'create' : null;
      if (withdrawalRoute && method === 'POST') {
        const blocked = featureGuard('withdraw'); if (blocked) return blocked;
        const input = await readBody(request);
        const displayAmount = positiveInteger(input.amount);
        const amount = displayAmount ? convertLocalToRwf(displayAmount, user.unitsPerRwf) : null;
        const account = await withdrawalAccountFor(user.id);
        if (!account) return json({ error: withdrawalRoute === 'preview' ? 'Bind a withdrawal account before continuing.' : 'Bind a withdrawal account before requesting a withdrawal.' }, 400);
        const isCrypto = account.paymentMethod === cryptoMethod;
        const detailsValid = isCrypto ? validTronAddress(account.walletAddress) && Number(user.unitsPerUsdt) > 0 : Boolean(normalizePhone(account.phoneNumber, user.countryCode));
        if (!amount || !displayAmount || !detailsValid || !withdrawalMethodCodes.includes(account.paymentMethod) || !(await withdrawalMethodEnabled(account.paymentMethod, user.countryCode))) {
          return json({ error: 'Your bound withdrawal account is invalid or its provider is unavailable in your country.' }, 400);
        }
        const calculation = await withdrawalFee(amount);
        const usdtFeePercent = isCrypto ? (await platformSettings()).usdtFeePercent : 0;
        const cryptoWithdrawalAmount = isCrypto ? usdtWithFee(usdtAmount(calculation.amountReceived, user.unitsPerRwf, Number(user.unitsPerUsdt)), usdtFeePercent, 'withdrawal') : null;
        const minimumWithdrawal = (await platformSettings()).minimumWithdrawal;
        if (amount < minimumWithdrawal) return json({ error: `Minimum withdrawal is ${localAmount(minimumWithdrawal, user.unitsPerRwf).toLocaleString()} ${user.currencyCode}.` }, 400);
        const balance = await balanceView(user.id);
        if (amount > balance.availableBalance) return json({ error: 'Withdrawal amount exceeds available balance.' }, 400);
        if (withdrawalRoute === 'preview') {
          return json({
            channel: isCrypto ? 'USDT (TRC20)' : account.paymentMethod === 'AIRTEL_MONEY' ? 'Airtel Money' : 'MTN MoMo', receiverName: account.accountHolderName, phoneNumber: account.phoneNumber, paymentMethod: account.paymentMethod, walletAddress: account.walletAddress ?? '', cryptoAmount: cryptoWithdrawalAmount, cryptoUnitsPerUsdt: isCrypto ? Number(user.unitsPerUsdt) : null,
            availableBalance: balance.availableBalance, displayAvailableBalance: balance.displayAvailableBalance, displayWithdrawalAmount: displayAmount,
            displayWithdrawalFee: localAmount(calculation.withdrawalFee, user.unitsPerRwf), displayAmountReceived: localAmount(calculation.amountReceived, user.unitsPerRwf), currencyCode: user.currencyCode, ...calculation,
          });
        }
        const id = randomUUID();
        await withTransaction(async (client) => {
          const wallet = await client.query('SELECT available_balance FROM wallet_accounts WHERE user_id = $1 FOR UPDATE', [user.id]);
          if (!wallet.rows[0] || amount > Number(wallet.rows[0].available_balance)) throw new BusinessError('Withdrawal amount exceeds available balance.');
          const totals = await client.query(`SELECT
            (SELECT coalesce(sum(commission_amount), 0)::bigint::text FROM commission_ledger WHERE beneficiary_user_id = $1 AND status = 'APPROVED' AND credited_at IS NOT NULL) AS credited,
            (SELECT coalesce(sum(commission_amount), 0)::bigint::text FROM wallet_transactions WHERE user_id = $1 AND type = 'WITHDRAWAL' AND status NOT IN ('REJECTED','FAILED','CANCELLED')) AS allocated`, [user.id]);
          const commissionAmount = Math.min(amount, Math.max(0, Number(totals.rows[0].credited) - Number(totals.rows[0].allocated)));
          const timestamp = now();
          await client.query('UPDATE wallet_accounts SET available_balance = available_balance - $1, reserved_balance = reserved_balance + $1, updated_at = $2 WHERE user_id = $3', [amount, timestamp, user.id]);
          await client.query(`INSERT INTO wallet_transactions (id, user_id, type, amount, withdrawal_fee, amount_received, reserved_amount, commission_amount, sender_name, receiver_name, phone_number, payment_method, status, provider, internal_reference, crypto_network, crypto_amount, crypto_units_per_usdt, crypto_address, created_at, updated_at)
            VALUES ($1,$2,'WITHDRAWAL',$3,$4,$5,$6,$7,'',$8,$9,$10,'PENDING','ADMIN_REVIEW',$11,$12,$13,$14,$15,$16,$16)`,
          [id, user.id, amount, calculation.withdrawalFee, calculation.amountReceived, amount, commissionAmount, account.accountHolderName, account.phoneNumber, account.paymentMethod, `WDR-${randomUUID()}`, isCrypto ? cryptoNetworkTrc20 : '', cryptoWithdrawalAmount, isCrypto ? Number(user.unitsPerUsdt) : null, isCrypto ? account.walletAddress : null, timestamp]);
        });
        const created = await pool.query('SELECT * FROM wallet_transactions WHERE id = $1', [id]);
        return json({ transaction: transactionView(created.rows[0], user) }, 201);
      }

      if (path === '/api/purchases' && method === 'POST') {
        const blocked = featureGuard('products'); if (blocked) return blocked;
        const input = await readBody(request);
        const productId = String(input.productId ?? '').trim();
        if (!productId) return json({ error: 'Choose a product to purchase.' }, 400);
        const idempotencyKey = String(input.idempotencyKey ?? request.headers.get('idempotency-key') ?? '').trim();
        if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) return json({ error: 'A valid purchase idempotency key is required.' }, 400);
        const purchaseId = randomUUID();
        const outcome = await withTransaction(async (client) => {
          const existing = await client.query('SELECT * FROM product_purchases WHERE user_id = $1 AND idempotency_key = $2', [user.id, idempotencyKey]);
          if (existing.rows[0]) {
            if (existing.rows[0].product_name !== productId) throw new BusinessError('This idempotency key was already used for another product.');
            return { replay: existing.rows[0] };
          }
          const duplicate = await client.query("SELECT id FROM product_purchases WHERE user_id = $1 AND product_name = $2 AND status IN ('PENDING','APPROVED','COMPLETED') LIMIT 1", [user.id, productId]);
          if (duplicate.rowCount) throw new BusinessError('You already purchased this product. Choose a different product.');
          const productResult = await client.query('SELECT * FROM plans WHERE name = $1 FOR UPDATE', [productId]);
          const product = productResult.rows[0];
          if (!product || Number(product.total_slots) <= 0) throw new BusinessError('Product is not available.');
          if (product.status !== 'Active') throw new BusinessError('This product is not currently available for purchase.');
          if (Number(product.sold_slots) >= Number(product.total_slots)) throw new BusinessError('This product is sold out.');
          const price = Number(product.price);
          const balance = await balanceView(user.id);
          if (balance.availableBalance < price) throw new BusinessError('Insufficient available balance for this product.');
          const timestamp = now();
          const charge = await client.query('UPDATE wallet_accounts SET available_balance = available_balance - $1, updated_at = $2 WHERE user_id = $3 AND available_balance >= $1', [price, timestamp, user.id]);
          if (!charge.rowCount) throw new BusinessError('Insufficient available balance for this product.');
          await client.query(`INSERT INTO product_purchases (id, user_id, product_name, qualifying_amount, status, reference, product_id, description_snapshot, image_snapshot, daily_income_snapshot, duration_days_snapshot, purchase_bonus_snapshot, total_slots_snapshot, idempotency_key, country_code, currency_code, exchange_rate, display_amount, created_at)
            VALUES ($1,$2,$3,$4,'COMPLETED',$5,$3,$6,$7,$8,$9,0,$10,$11,$12,$13,$14,$15,$16)`,
          [purchaseId, user.id, product.name, price, `PUR-${randomUUID()}`, product.description, product.image_data, Number(product.daily_income), Number(product.duration_days), Number(product.total_slots), idempotencyKey, user.countryCode, user.currencyCode, user.unitsPerRwf, localAmount(price, user.unitsPerRwf), timestamp]);
          await client.query('UPDATE plans SET sold_slots = sold_slots + 1 WHERE name = $1', [product.name]);
          await createCommissions(client, { id: purchaseId, userId: user.id, productName: product.name, amount: price });
          await unlockWelcomeBonus(client, user.id);
          return { created: purchaseId, productName: product.name as string };
        });
        if ('replay' in outcome) {
          const plan = await pool.query('SELECT * FROM plans WHERE name = $1', [outcome.replay.product_name]);
          return json({ purchase: outcome.replay, product: plan.rows[0] ? { ...planView(plan.rows[0]), displayPrice: localAmount(Number(plan.rows[0].price), user.unitsPerRwf), currencyCode: user.currencyCode } : null, balance: await balanceView(user.id), idempotentReplay: true });
        }
        const [purchase, plan] = await Promise.all([pool.query('SELECT * FROM product_purchases WHERE id = $1', [outcome.created]), pool.query('SELECT * FROM plans WHERE name = $1', [outcome.productName])]);
        const view = planView(plan.rows[0]);
        return json({ purchase: purchase.rows[0], product: { ...view, displayPrice: localAmount(view.price, user.unitsPerRwf), displayDailyIncome: localAmount(view.dailyIncome, user.unitsPerRwf), displayTotalIncome: localAmount(view.totalIncome, user.unitsPerRwf), currencyCode: user.currencyCode, countryCode: user.countryCode }, balance: await balanceView(user.id) }, 201);
      }

      const transactionProofRoute = path.match(/^\/api\/admin\/transactions\/([^/]+)\/proof$/);
      if (transactionProofRoute && method === 'GET') {
        if (!isAdminUser) return json({ error: 'Admin authentication required.' }, 401);
        const proof = await pool.query("SELECT screenshot_data AS \"screenshotData\" FROM wallet_transactions WHERE id = $1 AND type = 'DEPOSIT'", [transactionProofRoute[1]]);
        if (!proof.rows[0]?.screenshotData) return json({ error: 'Payment screenshot not found.' }, 404);
        return json({ screenshotData: proof.rows[0].screenshotData });
      }

      const transactionReviewRoute = path.match(/^\/api\/admin\/transactions\/([^/]+)\/(approve|reject)$/);
      if (transactionReviewRoute && method === 'POST') {
        if (!isAdminUser) return json({ error: 'Admin authentication required.' }, 401);
        const input = await readBody(request);
        const approve = transactionReviewRoute[2] === 'approve';
        const reason = String(input.reason ?? '').trim();
        if (!approve && !reason) return json({ error: 'A rejection reason is required.' }, 400);
        const transactionId = transactionReviewRoute[1];
        const updated = await withTransaction(async (client) => {
          const found = await client.query('SELECT * FROM wallet_transactions WHERE id = $1 FOR UPDATE', [transactionId]);
          const row = found.rows[0];
          if (!row) return null;
          if (row.status !== 'PENDING') return row;
          const timestamp = now();
          if (row.type === 'DEPOSIT') {
            const nextStatus = approve ? 'SUCCESS' : 'REJECTED';
            await client.query('UPDATE wallet_transactions SET status = $1, approved_by = $2, approved_at = $3, rejected_by = $4, rejected_at = $5, rejection_reason = $6, updated_at = $7, completed_at = $7 WHERE id = $8',
              [nextStatus, approve ? user.id : null, approve ? timestamp : null, approve ? null : user.id, approve ? null : timestamp, approve ? null : reason, timestamp, transactionId]);
            if (approve) await client.query('UPDATE wallet_accounts SET available_balance = available_balance + $1, updated_at = $2 WHERE user_id = $3', [Number(row.amount), timestamp, row.user_id]);
            await walletAudit(client, transactionId, user.id, approve ? 'DEPOSIT_APPROVED' : 'DEPOSIT_REJECTED', 'PENDING', nextStatus, reason || null);
          } else {
            const reserved = Number(row.reserved_amount) || Number(row.amount) + Number(row.withdrawal_fee ?? 0);
            const nextStatus = approve ? 'SUCCESS' : 'REJECTED';
            await client.query('UPDATE wallet_transactions SET status = $1, approved_by = $2, approved_at = $3, rejected_by = $4, rejected_at = $5, rejection_reason = $6, updated_at = $7, completed_at = $9 WHERE id = $8',
              [nextStatus, approve ? user.id : null, approve ? timestamp : null, approve ? null : user.id, approve ? null : timestamp, approve ? null : reason, timestamp, transactionId, approve ? timestamp : null]);
            if (approve) await client.query('UPDATE wallet_accounts SET reserved_balance = reserved_balance - $1, updated_at = $2 WHERE user_id = $3 AND reserved_balance >= $1', [reserved, timestamp, row.user_id]);
            if (!approve) await client.query('UPDATE wallet_accounts SET reserved_balance = reserved_balance - $1, available_balance = available_balance + $1, updated_at = $2 WHERE user_id = $3 AND reserved_balance >= $1', [reserved, timestamp, row.user_id]);
            await walletAudit(client, transactionId, user.id, approve ? 'WITHDRAWAL_APPROVED' : 'WITHDRAWAL_REJECTED', 'PENDING', nextStatus, reason || null);
          }
          return (await client.query('SELECT * FROM wallet_transactions WHERE id = $1', [transactionId])).rows[0];
        });
        if (!updated) return json({ error: 'Transaction not found.' }, 404);
        return json({ transaction: transactionView(updated, await currencyForUser(updated.user_id)) });
      }

      const adminBalanceRoute = path.match(/^\/api\/admin\/users\/([^/]+)\/balance$/);
      if (adminBalanceRoute && method === 'POST') {
        if (!isAdminUser) return json({ error: 'Sign in with an Admin account to adjust balances.' }, 401);
        const targetId = decodeURIComponent(adminBalanceRoute[1]);
        const input = await readBody(request);
        const amount = Number(input.amount);
        const reason = String(input.reason ?? '').trim().slice(0, 250);
        if (!Number.isSafeInteger(amount) || amount === 0 || !reason) return json({ error: 'Enter a non-zero whole RWF amount and a reason.' }, 400);
        const wallet = await pool.query('SELECT 1 FROM wallet_accounts WHERE user_id = $1', [targetId]);
        if (!wallet.rowCount) return json({ error: 'User wallet not found.' }, 404);
        const previous = (await balanceView(targetId)).availableBalance;
        if (previous + amount < 0) return json({ error: 'Adjustment cannot make the available balance negative.' }, 400);
        await pool.query('UPDATE wallet_accounts SET available_balance = available_balance + $1, updated_at = $2 WHERE user_id = $3', [amount, now(), targetId]);
        await auditAdmin(user.id, targetId, 'WALLET_BALANCE_ADJUSTED', { availableBalance: previous }, { availableBalance: previous + amount }, { amount, reason });
        return json({ balance: await balanceView(targetId) });
      }

      if (path === '/api/admin/users' && method === 'DELETE') {
        if (!isAdminUser) return adminDenied();
        const targets = await pool.query("SELECT id FROM users WHERE role <> 'ADMIN'");
        const deleted = await permanentlyDeleteUsers(targets.rows.map((row) => row.id));
        return json({ deleted, permanentlyDeleted: true });
      }

      const adminUserDeleteRoute = path.match(/^\/api\/admin\/users\/([^/]+)$/);
      if (adminUserDeleteRoute && method === 'DELETE') {
        if (!isAdminUser) return adminDenied();
        const targetId = decodeURIComponent(adminUserDeleteRoute[1]);
        const target = (await pool.query('SELECT id, role FROM users WHERE id = $1', [targetId])).rows[0];
        if (!target) return json({ error: 'User not found.' }, 404);
        if (target.role === 'ADMIN') return json({ error: 'Admin accounts cannot be deleted from user management.' }, 403);
        if (user.id === targetId) return json({ error: 'You cannot delete your own account.' }, 400);
        await permanentlyDeleteUsers([targetId]);
        return json({ deleted: true, permanentlyDeleted: true });
      }

      if (path === '/api/admin/deposit-methods' && method === 'POST') {
        if (!isAdminUser) return json({ error: 'Admin authentication required.' }, 401);
        const parsed = await parseDepositMethod(await readBody(request));
        if ('error' in parsed) return json({ error: parsed.error }, 400);
        const item = parsed.value;
        const count = await pool.query('SELECT count(*)::integer AS count FROM deposit_methods WHERE country_code = $1', [item.countryCode]);
        if (count.rows[0].count >= 10) return json({ error: `You can configure up to 10 deposit methods for ${item.countryCode}.` }, 409);
        const id = `DEP-${randomUUID()}`;
        await pool.query(`INSERT INTO deposit_methods (code, name, enabled, provider, account_name, account_number, instructions, ussd_template, minimum_amount, maximum_amount, logo_data, position, updated_at, country_code, cross_border_enabled, receiving_country_code, crypto_network)
          VALUES ($1,$2,$3,'ADMIN_REVIEW',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [id, item.name, item.enabled, item.accountName, item.accountNumber, item.instructions, item.ussdTemplate, item.minimumAmount, item.maximumAmount, item.logoData, item.position, now(), item.countryCode, item.crossBorderEnabled, item.receivingCountryCode, item.cryptoNetwork]);
        return json({ method: await depositMethodView((await pool.query('SELECT * FROM deposit_methods WHERE code = $1', [id])).rows[0]) }, 201);
      }

      const adminDepositMethodRoute = path.match(/^\/api\/admin\/deposit-methods\/([^/]+)$/);
      if (adminDepositMethodRoute && method === 'PUT') {
        if (!isAdminUser) return json({ error: 'Admin authentication required.' }, 401);
        const code = decodeURIComponent(adminDepositMethodRoute[1]);
        if (!(await pool.query('SELECT 1 FROM deposit_methods WHERE code = $1', [code])).rowCount) return json({ error: 'Deposit method not found.' }, 404);
        const parsed = await parseDepositMethod(await readBody(request));
        if ('error' in parsed) return json({ error: parsed.error }, 400);
        const item = parsed.value;
        const count = await pool.query('SELECT count(*)::integer AS count FROM deposit_methods WHERE country_code = $1 AND code <> $2', [item.countryCode, code]);
        if (count.rows[0].count >= 10) return json({ error: `You can configure up to 10 deposit methods for ${item.countryCode}.` }, 409);
        await pool.query('UPDATE deposit_methods SET name = $1, enabled = $2, account_name = $3, account_number = $4, instructions = $5, ussd_template = $6, minimum_amount = $7, maximum_amount = $8, logo_data = $9, position = $10, updated_at = $11, country_code = $12, cross_border_enabled = $13, receiving_country_code = $14, crypto_network = $15 WHERE code = $16',
          [item.name, item.enabled, item.accountName, item.accountNumber, item.instructions, item.ussdTemplate, item.minimumAmount, item.maximumAmount, item.logoData, item.position, now(), item.countryCode, item.crossBorderEnabled, item.receivingCountryCode, item.cryptoNetwork, code]);
        return json({ method: await depositMethodView((await pool.query('SELECT * FROM deposit_methods WHERE code = $1', [code])).rows[0]) });
      }

      if (adminDepositMethodRoute && method === 'DELETE') {
        if (!isAdminUser) return json({ error: 'Admin authentication required.' }, 401);
        const deleted = await pool.query('DELETE FROM deposit_methods WHERE code = $1', [decodeURIComponent(adminDepositMethodRoute[1])]);
        if (!deleted.rowCount) return json({ error: 'Deposit method not found.' }, 404);
        return json({ deleted: true });
      }

      const adminCountryRoute = path.match(/^\/api\/admin\/countries\/([A-Z]{2})$/);
      if (adminCountryRoute && method === 'PUT') {
        if (!isAdminUser) return json({ error: 'Admin authentication required.' }, 401);
        const countryCode = adminCountryRoute[1];
        const current = await countrySettings(countryCode);
        if (!current) return json({ error: 'Supported country not found.' }, 404);
        const input = await readBody(request);
        const enabled = input.enabled;
        const unitsPerRwf = Number(input.unitsPerRwf);
        if (typeof enabled !== 'boolean' || !Number.isFinite(unitsPerRwf) || unitsPerRwf < 0 || (enabled && unitsPerRwf <= 0) || (countryCode === 'RW' && unitsPerRwf !== 1)) {
          return json({ error: countryCode === 'RW' ? 'Rwanda must remain enabled at exactly 1 RWF per RWF.' : 'Enter a positive exchange rate before enabling this country.' }, 400);
        }
        const selected = input.withdrawalMethods;
        if (selected !== undefined && (!Array.isArray(selected) || selected.some((code) => !withdrawalMethodCodes.includes(String(code))))) return json({ error: 'Choose valid withdrawal methods.' }, 400);
        const unitsPerUsdt = input.unitsPerUsdt === undefined ? Number(current.unitsPerUsdt) || 0 : Number(input.unitsPerUsdt);
        if (!Number.isFinite(unitsPerUsdt) || unitsPerUsdt < 0) return json({ error: 'Enter a valid USDT rate (0 or more).' }, 400);
        if (Array.isArray(selected) && selected.includes(cryptoMethod) && unitsPerUsdt <= 0) return json({ error: 'Enter a USDT rate before enabling USDT withdrawals.' }, 400);
        await withTransaction(async (client) => {
          await client.query('UPDATE country_settings SET enabled = $1, units_per_rwf = $2, units_per_usdt = $3, updated_at = $4 WHERE country_code = $5', [enabled ? 1 : 0, unitsPerRwf, unitsPerUsdt, now(), countryCode]);
          if (Array.isArray(selected)) {
            const all = await client.query('SELECT code FROM withdrawal_methods');
            for (const row of all.rows) {
              await client.query(`INSERT INTO country_withdrawal_methods (country_code, method_code, enabled, updated_at) VALUES ($1,$2,$3,$4)
                ON CONFLICT (country_code, method_code) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = EXCLUDED.updated_at`, [countryCode, row.code, selected.includes(row.code) ? 1 : 0, now()]);
            }
          }
        });
        await auditAdmin(user.id, null, 'COUNTRY_CURRENCY_UPDATED', { enabled: Boolean(current.enabled), unitsPerRwf: Number(current.unitsPerRwf), unitsPerUsdt: Number(current.unitsPerUsdt) || 0 }, { enabled, unitsPerRwf, unitsPerUsdt, withdrawalMethods: selected ?? null });
        const updated = await countrySettings(countryCode);
        return json({ ...updated, enabled: Boolean(updated?.enabled), unitsPerRwf: Number(updated?.unitsPerRwf ?? 1), unitsPerUsdt: Number(updated?.unitsPerUsdt ?? 0) });
      }

      const edgesCte = `WITH RECURSIVE referral_edges(user_id, sponsor_user_id, created_at) AS (
        SELECT user_id, sponsor_user_id, created_at FROM referral_relationships
        UNION ALL
        SELECT u.id, u.referred_by, u.created_at FROM users u
        WHERE u.referred_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM referral_relationships r WHERE r.user_id = u.id)
      )`;
      const promoterTeamCte = `${edgesCte}, team(user_id, level) AS (
        SELECT user_id, 1 FROM referral_edges WHERE sponsor_user_id = $1
        UNION ALL
        SELECT edge.user_id, team.level + 1 FROM referral_edges edge JOIN team ON edge.sponsor_user_id = team.user_id WHERE team.level < 3
      )`;
      const activePurchaseSql = (column: string) => `EXISTS (SELECT 1 FROM product_purchases p WHERE p.user_id = ${column} AND p.status = 'COMPLETED')`;

      if (path === '/api/admin/promoters' && method === 'GET') {
        if (!isAdminUser) return json({ error: 'Admin authentication required.' }, 401);
        const search = String(url.searchParams.get('search') ?? '').trim().slice(0, 100);
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 25));
        const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
        const searchFilter = "($1::text = '' OR u.full_name ILIKE '%' || $1::text || '%' OR u.phone_number ILIKE '%' || $1::text || '%')";
        const [promoters, total] = await Promise.all([
          pool.query(`${edgesCte} SELECT u.id AS "userId", u.full_name AS "fullName", u.phone_number AS "phoneNumber", u.created_at AS "createdAt",
            count(edge.user_id)::integer AS "totalReferred", sum(CASE WHEN ${activePurchaseSql('edge.user_id')} THEN 1 ELSE 0 END)::integer AS "activeMembers"
            FROM users u JOIN referral_edges edge ON edge.sponsor_user_id = u.id WHERE ${searchFilter}
            GROUP BY u.id, u.full_name, u.phone_number, u.created_at ORDER BY "totalReferred" DESC, u.created_at DESC LIMIT $2 OFFSET $3`, [search, limit, offset]),
          pool.query(`${edgesCte} SELECT count(*)::integer AS count FROM (SELECT u.id FROM users u JOIN referral_edges edge ON edge.sponsor_user_id = u.id WHERE ${searchFilter} GROUP BY u.id) grouped`, [search]),
        ]);
        return json({ promoters: promoters.rows.map((row) => ({ ...row, activeMembers: Number(row.activeMembers ?? 0) })), total: total.rows[0].count, limit, offset });
      }

      const adminPromoterRoute = path.match(/^\/api\/admin\/promoters\/([^/]+)$/);
      if (adminPromoterRoute && method === 'GET') {
        if (!isAdminUser) return json({ error: 'Admin authentication required.' }, 401);
        const promoterId = decodeURIComponent(adminPromoterRoute[1]);
        const promoterResult = await pool.query('SELECT id AS "userId", full_name AS "fullName", phone_number AS "phoneNumber", created_at AS "createdAt" FROM users WHERE id = $1', [promoterId]);
        if (!promoterResult.rows[0]) return json({ error: 'Promoter not found.' }, 404);
        const requestedLevel = Number(url.searchParams.get('level')) || 0;
        const level = requestedLevel >= 1 && requestedLevel <= 3 ? requestedLevel : 0;
        const search = String(url.searchParams.get('search') ?? '').trim().slice(0, 100);
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 25));
        const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
        const memberFilter = "($2::int = 0 OR team.level = $2::int) AND ($3::text = '' OR u.full_name ILIKE '%' || $3::text || '%' OR u.phone_number ILIKE '%' || $3::text || '%')";
        const [levels, aggregates, direct, commissions, filteredCount, members] = await Promise.all([
          pool.query(`${promoterTeamCte} SELECT team.level, count(*)::integer AS total, sum(CASE WHEN ${activePurchaseSql('team.user_id')} THEN 1 ELSE 0 END)::integer AS active FROM team GROUP BY team.level ORDER BY team.level`, [promoterId]),
          pool.query(`${promoterTeamCte} SELECT count(*)::integer AS "totalReferred",
            coalesce(sum((SELECT coalesce(sum(t.amount), 0) FROM wallet_transactions t WHERE t.user_id = team.user_id AND t.type = 'DEPOSIT' AND t.status = 'SUCCESS')), 0)::bigint::text AS "totalDeposit",
            coalesce(sum((SELECT coalesce(sum(t.amount), 0) FROM wallet_transactions t WHERE t.user_id = team.user_id AND t.type = 'WITHDRAWAL' AND t.status IN ('APPROVED','AWAITING_PAYOUT','PROCESSING','SUCCESS'))), 0)::bigint::text AS "totalWithdrawal",
            coalesce(sum((SELECT count(*) FROM product_purchases p WHERE p.user_id = team.user_id AND p.status = 'COMPLETED')), 0)::integer AS "totalProductsPurchased" FROM team`, [promoterId]),
          pool.query(`${promoterTeamCte} SELECT count(*)::integer AS "totalReferred", coalesce(sum(CASE WHEN ${activePurchaseSql('team.user_id')} THEN 1 ELSE 0 END), 0)::integer AS "activeMembers" FROM team WHERE level = 1`, [promoterId]),
          pool.query(`SELECT c.id, c.beneficiary_user_id AS "referrerUserId", referrer.full_name AS "referrerName", c.source_user_id AS "referredUserId", referred.full_name AS "referredUserName", c.product_id AS "productId",
            c.qualifying_amount AS "purchaseAmount", c.referral_level AS "commissionLevel", c.percentage AS "commissionPercentage", c.commission_amount AS "commissionAmount", c.status, c.created_at AS date, c.reference
            FROM commission_ledger c JOIN users referrer ON referrer.id = c.beneficiary_user_id JOIN users referred ON referred.id = c.source_user_id WHERE c.beneficiary_user_id = $1 ORDER BY c.created_at DESC LIMIT 200`, [promoterId]),
          pool.query(`${promoterTeamCte} SELECT count(*)::integer AS count FROM team JOIN users u ON u.id = team.user_id WHERE ${memberFilter}`, [promoterId, level, search]),
          pool.query(`${promoterTeamCte} SELECT u.id AS "userId", u.full_name AS "fullName", u.phone_number AS "phoneNumber", u.role, u.created_at AS "createdAt", team.level,
            (SELECT count(*)::integer FROM product_purchases p WHERE p.user_id = u.id AND p.status = 'COMPLETED') AS "productsPurchased",
            (SELECT coalesce(sum(t.amount), 0)::bigint::text FROM wallet_transactions t WHERE t.user_id = u.id AND t.type = 'DEPOSIT' AND t.status = 'SUCCESS') AS "totalDeposit",
            (SELECT coalesce(sum(t.amount), 0)::bigint::text FROM wallet_transactions t WHERE t.user_id = u.id AND t.type = 'WITHDRAWAL' AND t.status IN ('APPROVED','AWAITING_PAYOUT','PROCESSING','SUCCESS')) AS "totalWithdrawal",
            coalesce(w.available_balance, 0)::bigint::text AS "currentBalance",
            (SELECT max(s.last_seen_at) FROM auth_sessions s WHERE s.user_id = u.id) AS "lastActive",
            (SELECT s.current_page FROM auth_sessions s WHERE s.user_id = u.id AND s.last_seen_at::timestamptz >= now() - ${liveWindowSql} ORDER BY s.last_seen_at DESC LIMIT 1) AS "currentPage",
            (SELECT s.created_at FROM auth_sessions s WHERE s.user_id = u.id ORDER BY s.last_seen_at DESC LIMIT 1) AS "loginAt"
            FROM team JOIN users u ON u.id = team.user_id LEFT JOIN wallet_accounts w ON w.user_id = u.id WHERE ${memberFilter} ORDER BY team.level, u.created_at DESC LIMIT $4 OFFSET $5`, [promoterId, level, search, limit, offset]),
        ]);
        const directTotals = direct.rows[0];
        return json({
          promoter: promoterResult.rows[0],
          totals: { totalReferred: directTotals.totalReferred, activeMembers: directTotals.activeMembers, inactiveMembers: directTotals.totalReferred - directTotals.activeMembers },
          teamTotals: { totalDeposit: Number(aggregates.rows[0].totalDeposit), totalWithdrawal: Number(aggregates.rows[0].totalWithdrawal), totalProductsPurchased: aggregates.rows[0].totalProductsPurchased },
          levels: levels.rows,
          members: members.rows.map((member) => ({ ...member, totalDeposit: Number(member.totalDeposit), totalWithdrawal: Number(member.totalWithdrawal), currentBalance: Number(member.currentBalance), activityStatus: member.productsPurchased > 0 ? 'ACTIVE' : 'INACTIVE' })),
          commissions: commissions.rows, total: filteredCount.rows[0].count, limit, offset,
        });
      }

      return json({ error: 'Not found' }, 404);
    } catch (error) {
      console.error('Account API request failed:', error);
      if (error instanceof BusinessError) return json({ error: error.message }, 400);
      const status = Number((error as { status?: number }).status) || 500;
      return json({ error: status >= 500 ? 'The account service could not complete the request.' : (error as Error).message }, status);
    }
  },
};
