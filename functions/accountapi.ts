import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { Pool } from 'pg';
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

async function countrySettings(countryCode: string) {
  const result = await pool.query(
    'SELECT country_code AS "countryCode", country_name AS "countryName", phone_prefix AS "phonePrefix", currency_code AS "currencyCode", enabled, units_per_rwf AS "unitsPerRwf" FROM country_settings WHERE country_code = $1',
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
        const countries = await pool.query(`SELECT country_code AS "countryCode", country_name AS "countryName", phone_prefix AS "phonePrefix", currency_code AS "currencyCode", enabled, units_per_rwf AS "unitsPerRwf" FROM country_settings`);
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

      if (path === '/api/user/account-state' && method === 'GET') {
        const access = await userAccess(user.id);
        return json({ accountStatus: access.accountStatus, allowDeposits: access.allowDeposits, allowWithdrawals: access.allowWithdrawals, permissions: access.permissions });
      }

      if (path === '/api/presence' && method === 'POST') {
        const input = await readBody(request);
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
          access.products && currency.enabled ? pool.query("SELECT * FROM plans WHERE total_slots > 0 AND status = 'Active' ORDER BY position, name") : { rows: [] },
          access.myTeam ? pool.query('SELECT person, joined, contribution, commission, status FROM referrals ORDER BY position, person') : { rows: [] },
          access.support ? pool.query('SELECT name, value, state FROM support_tools ORDER BY position, name') : { rows: [] },
        ]);
        const mappedPlans = plans.rows.map((row) => {
          const dailyIncome = Number(row.daily_income ?? 0);
          const durationDays = Number(row.duration_days ?? 0);
          const price = Number(row.price ?? 0);
          const totalSlots = Number(row.total_slots ?? 0);
          const soldSlots = Number(row.sold_slots ?? 0);
          const plan = { id: row.name, name: row.name, description: row.description ?? row.note, imageData: row.image_data ?? null, price, deposited: row.deposited, dailyIncome, incomePerDay: dailyIncome, totalIncome: dailyIncome * durationDays, durationDays, termDays: durationDays, term: `${durationDays} days`, purchaseBonus: 0, totalSlots, soldSlots, remainingSlots: Math.max(0, totalSlots - soldSlots), progressPercent: totalSlots ? Math.min(100, Math.floor(soldSlots * 100 / totalSlots)) : 0, soldOut: totalSlots > 0 && soldSlots >= totalSlots, status: row.status, note: row.description ?? row.note };
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
          pool.query("SELECT count(DISTINCT user_id)::integer AS count FROM auth_sessions WHERE expires_at::timestamptz > now() AND last_seen_at::timestamptz >= now() - interval '60 seconds'"),
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
        return json({ telegramUrl: values.telegram_url ?? '', telegramPopupMessage: values.telegram_popup_message ?? '', supportEmail: values.support_email ?? '', liveChatEnabled: values.live_chat_enabled === '1' });
      }

      return json({ error: 'Not found' }, 404);
    } catch (error) {
      console.error('Account API request failed:', error);
      const status = Number((error as { status?: number }).status) || 500;
      return json({ error: status >= 500 ? 'The account service could not complete the request.' : (error as Error).message }, status);
    }
  },
};
