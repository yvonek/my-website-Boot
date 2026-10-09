import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { AdminUsersPage } from '../pages/AdminUsersPage';
import { LoginPage } from '../pages/AuthPages';
import { PlanCard } from '../components/PlanCard';
import { PlansPage } from '../pages/PlansPage';
import { WalletPage } from '../pages/WalletPage';

afterEach(() => vi.unstubAllGlobals());

describe('dashboard', () => {
  it('loads the dashboard once for an authenticated session', async () => {
    window.history.replaceState({}, '', '/');
    const user = { id: 'user-1', fullName: 'Test User', phoneNumber: '+250780000001', referralCode: 'ABC123', role: 'USER' as const };
    const plan = { id: 'starter-cctv', name: 'Starter CCTV', description: 'A catalog product.', imageData: 'data:image/png;base64,test', price: 10000, deposited: '10000', incomePerDay: 500, dailyIncome: 500, totalIncome: 20000, purchaseBonus: 1000, totalSlots: 500, soldSlots: 125, remainingSlots: 375, progressPercent: 25, soldOut: false, durationDays: 40, termDays: 40, term: '40 days', status: 'Active' as const, note: 'A catalog product.' };
    const fetchRequest = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), window.location.href).pathname;
      const body = path === '/api/auth/me'
        ? { user }
        : path === '/api/wallet/balance'
          ? { userId: user.id, availableBalance: 0, reservedBalance: 0, lockedWelcomeBonus: 7000, welcomeBonusAmount: 7000, welcomeBonusStatus: 'LOCKED', paymentMode: 'admin-review' }
          : { metrics: [], plans: [plan], referrals: [], tools: [] };
      return { ok: true, json: async () => body } as Response;
    });
    vi.stubGlobal('fetch', fetchRequest);

    render(<App />);
    expect(await screen.findByRole('region', { name: 'Wallet balance' })).toBeInTheDocument();
    expect(screen.getByText('7,000 RWF')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Available products' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Starter CCTV' })).toHaveAttribute('src', plan.imageData);
    expect(screen.getByText('125 / 500 slots sold')).toBeInTheDocument();
    expect(screen.getByText('375 remaining')).toBeInTheDocument();
    expect(screen.getByText('25% filled')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'BUY NOW' })).toBeInTheDocument();
    expect(fetchRequest.mock.calls.map(([input]) => String(input))).toContain('/api/dashboard');
    expect(fetchRequest.mock.calls.filter(([input]) => String(input) === '/api/dashboard')).toHaveLength(1);
  });

  it('requires a session before rendering the protected Withdraw page', async () => {
    window.history.replaceState({}, '', '/withdraw');
    const fetchRequest = vi.fn(async () => ({ ok: true, json: async () => ({ user: null }) }) as Response);
    vi.stubGlobal('fetch', fetchRequest);

    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Welcome Back' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Withdraw' })).not.toBeInTheDocument();
    expect(fetchRequest).toHaveBeenCalledTimes(1);
  });

  it('renders the Admin Console for an authenticated ADMIN account', async () => {
    window.history.replaceState({}, '', '/admin');
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    const user = { id: 'admin-1', fullName: 'Admin User', phoneNumber: '+250780000002', referralCode: 'ADMIN1', role: 'ADMIN' as const };
    const fetchRequest = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), window.location.href).pathname;
      const body = path === '/api/auth/me'
        ? { user }
        : path === '/api/admin/overview'
          ? { members: 0, pendingDeposits: { count: 0, amount: 0 }, pendingWithdrawals: { count: 0, amount: 0 }, plans: 0, completedDeposits: 170000, completedWithdrawals: 31900, summary: { totalUsers: 3, activeUsers: 1, liveUsers: 0, totalDeposit: 170000, totalWithdrawal: 31900, totalProductsSold: 0, totalReferrals: 0, totalReferralCommissions: 0 } }
          : path === '/api/admin/users' && init?.method === 'DELETE'
            ? { deleted: 1, softDeleted: true }
            : path === '/api/admin/users'
              ? { users: [{ id: 'member-1', fullName: 'Member One', phoneNumber: '+250780000003', referralCode: 'MEMBER1', role: 'USER', createdAt: '2026-10-01T00:00:00Z', lastActivity: null, isLive: false, currentPage: null, availableBalance: 0, totalDeposit: 50000, totalWithdrawal: 20000, productsPurchased: 0, referredBy: null, accountStatus: 'ACTIVE', allowDeposits: true, allowWithdrawals: true, lastDepositStatus: null, lastWithdrawalStatus: null }], total: 1, limit: 25, offset: 0 }
              : path === '/api/admin/users/member-1'
                ? { user: { id: 'member-1', fullName: 'Member One', phoneNumber: '+250780000003', referralCode: 'MEMBER1', role: 'USER', createdAt: '2026-10-01T00:00:00Z', lastActivity: null, isLive: false, availableBalance: 0, reservedBalance: 0, totalDeposit: 50000, totalWithdrawal: 20000, productsPurchased: 0, referredBy: null, referralCommissionEarned: 0, welcomeBonusAmount: 7000, welcomeBonusUnlockedAt: null, accountStatus: 'ACTIVE', allowDeposits: true, allowWithdrawals: true, permissions: { dashboard: true, products: true, wallet: true, deposit: true, withdraw: true, myTeam: true, support: true, telegram: true, messages: true }, lastDepositStatus: null, lastWithdrawalStatus: null }, transactions: [], messages: [], audit: [] }
              : path === '/api/admin/live-users'
                ? { users: [], total: 0, limit: 25, offset: 0, onlineWindowSeconds: 60 }
              : path === '/api/admin/referral-settings'
                ? { settings: [{ level: 1, percentage: 0 }, { level: 2, percentage: 0 }, { level: 3, percentage: 0 }] }
          : path === '/api/admin/members'
            ? { members: [] }
            : path === '/api/admin/plans'
              ? { plans: [] }
              : path === '/api/admin/audit-log'
                ? { entries: [] }
                : {};
      return { ok: true, json: async () => body } as Response;
    });
    vi.stubGlobal('fetch', fetchRequest);

    render(<App />);
    expect(await screen.findByRole('navigation', { name: 'Admin sections' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByText('Users')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'User app' })).toHaveAttribute('href', '/');
    expect(await screen.findByRole('button', { name: /Total deposits 170,000 RWF/ })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Total withdrawals 31,900 RWF/ })).toBeInTheDocument();
    expect(document.querySelectorAll('.admin-overview-grid .admin-overview-card')).toHaveLength(9);
    fireEvent.click(screen.getByRole('button', { name: /Total users/ }));
    expect(window.location.pathname).toBe('/admin/users');
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    expect(window.location.pathname).toBe('/admin');
    fireEvent.click(screen.getByRole('button', { name: /Active users/ }));
    expect(window.location.pathname).toBe('/admin/active-users');
    expect(screen.getByText('COMPLETED PURCHASERS')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Users' }));
    expect(window.location.pathname).toBe('/admin/users');
    expect(screen.getByText('ACCOUNT ACCESS')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Live users' }));
    expect(window.location.pathname).toBe('/admin/live-users');
    expect(screen.getByText('SESSION PRESENCE · 60 SECOND WINDOW')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Users' }));
    expect(window.location.pathname).toBe('/admin/users');
    expect(await screen.findByText('Member One')).toBeInTheDocument();
    expect(screen.getByText('50,000 RWF')).toBeInTheDocument();
    expect(screen.getByText('20,000 RWF')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Member One/ }));
    expect(await screen.findByRole('button', { name: 'Make Admin' })).toBeInTheDocument();
    expect(screen.getByLabelText('Adjustment amount in RWF')).toBeInTheDocument();
    expect(screen.getByLabelText('Balance adjustment reason')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete all users' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete all users?' });
    const confirmDelete = within(dialog).getByRole('button', { name: 'Delete all users' });
    expect(confirmDelete).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Type DELETE ALL USERS to confirm'), { target: { value: 'DELETE ALL USERS' } });
    expect(confirmDelete).toBeEnabled();
    fireEvent.click(confirmDelete);
    await waitFor(() => expect(fetchRequest).toHaveBeenCalledWith('/api/admin/users', expect.objectContaining({ method: 'DELETE' })));
  });
});

describe('login country fallback', () => {
  it('keeps supported country options when the country API returns HTML', async () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    const fetchRequest = vi.fn(async () => new Response('The page could not be found.', { status: 404, headers: { 'Content-Type': 'text/html' } }));
    vi.stubGlobal('fetch', fetchRequest);

    render(<LoginPage onAuthenticated={() => undefined} />);

    expect(await screen.findByRole('option', { name: 'Rwanda (+250)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Burundi (+257)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Uganda (+256)' })).toBeInTheDocument();
    expect(screen.getByText('+250')).toBeInTheDocument();
    expect(await screen.findByText('Live country settings are unavailable. Showing the supported countries.')).toBeInTheDocument();
  });
});

describe('wallet page', () => {
  it('shows the user transaction history', async () => {
    const transaction = {
      id: 'transaction-1', userId: 'user-1', type: 'DEPOSIT', amount: 25000, withdrawalFee: 0, amountReceived: 25000,
      senderName: 'Wallet User', receiverName: '', phoneNumber: '+250780000001', paymentMethod: 'MTN_MOMO',
      depositMethodName: 'MTN MoMo', status: 'SUCCESS', provider: 'ADMIN_REVIEW', providerReference: '',
      internalReference: 'DEP-123', failureReason: null, rejectionReason: null, createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z', completedAt: '2026-10-01T00:00:00Z',
    };
    const fetchRequest = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), window.location.href).pathname;
      const body = path === '/api/wallet/transactions'
        ? { transactions: [transaction] }
        : path === '/api/wallet/products'
          ? { products: [] }
          : path === '/api/wallet/balance'
            ? { userId: 'user-1', availableBalance: 0, reservedBalance: 0, lockedWelcomeBonus: 7000, welcomeBonusAmount: 7000, welcomeBonusStatus: 'LOCKED', paymentMode: 'admin-review' }
            : { enabled: false, rewardAmount: 0, claimed: false };
      return { ok: true, json: async () => body } as Response;
    });
    vi.stubGlobal('fetch', fetchRequest);

    render(<WalletPage data={null} state="data" onRetry={() => undefined} />);

    expect(await screen.findByText('Transaction history')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Filter transaction history' })).not.toBeInTheDocument();
    expect(screen.getByText('LOCKED · Purchase a product to unlock')).toBeInTheDocument();
    expect(await screen.findByText('25,000 RWF')).toBeInTheDocument();
    expect(screen.getByText(/DEP-123/)).toBeInTheDocument();
  });
});

describe('Telegram group invitation', () => {
  it('shows the configured popup once and remembers dismissal per user', async () => {
    window.history.replaceState({}, '', '/');
    const user = { id: 'telegram-user', fullName: 'Telegram User', phoneNumber: '+250780000009', referralCode: 'TELEGRAM1', role: 'USER' as const };
    localStorage.removeItem('telegram-invite-dismissed:telegram-user');
    const fetchRequest = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), window.location.href).pathname;
      const body = path === '/api/auth/me'
        ? { user }
        : path === '/api/support/settings'
          ? { telegramUrl: 'https://t.me/example_group', telegramPopupMessage: 'Short community updates.', supportEmail: 'support@example.com', liveChatEnabled: true }
          : path === '/api/wallet/balance'
            ? { userId: user.id, availableBalance: 0, reservedBalance: 0, paymentMode: 'admin-review' }
            : path === '/api/wallet/daily-checkin'
              ? { enabled: false, rewardAmount: 0, claimed: false }
              : { metrics: [{ label: 'Test', value: '0', detail: '', tone: 'primary' }], plans: [], referrals: [], tools: [] };
      return { ok: true, json: async () => body } as Response;
    });
    vi.stubGlobal('fetch', fetchRequest);

    render(<App />);

    expect(await screen.findByRole('dialog', { name: 'Join our Telegram group' })).toBeInTheDocument();
    expect(screen.getByText('Short community updates.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('dialog', { name: 'Join our Telegram group' })).not.toBeInTheDocument();
    expect(localStorage.getItem('telegram-invite-dismissed:telegram-user')).toBe('1');
  });
});

describe('mobile product purchase', () => {
  it('sends a purchase request when randomUUID is unavailable on a LAN origin', async () => {
    const plan = { id: 'mobile-plan', name: 'Mobile Plan', description: '', imageData: null, price: 20000, deposited: '20000', incomePerDay: 1000, dailyIncome: 1000, totalIncome: 30000, purchaseBonus: 0, totalSlots: 10, soldSlots: 0, remainingSlots: 10, progressPercent: 0, soldOut: false, durationDays: 30, termDays: 30, term: '30 days', status: 'Active' as const, note: '' };
    const fetchRequest = vi.fn(async () => ({ ok: true, json: async () => ({ purchase: { id: 'purchase-1', status: 'COMPLETED', reference: 'PUR-1' }, product: plan, balance: { userId: 'user-1', availableBalance: 0, reservedBalance: 0, paymentMode: 'admin-review' } }) }) as Response);
    vi.stubGlobal('crypto', {});

    render(<PlanCard plan={plan} onPurchased={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'BUY NOW' }));

    expect(await screen.findByText('Purchase completed: PUR-1')).toBeInTheDocument();
    expect(fetchRequest).toHaveBeenCalledWith('/api/purchases', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'Idempotency-Key': expect.stringMatching(/^[A-Za-z0-9._:-]{8,128}$/) }),
    }));
  });

  it('marks an already-owned product as purchased and leaves other products available', async () => {
    const makePlan = (name: string) => ({ id: name, name, description: 'Product', imageData: null, price: 20000, deposited: '20000', incomePerDay: 1000, dailyIncome: 1000, totalIncome: 30000, purchaseBonus: 0, totalSlots: 10, soldSlots: 1, remainingSlots: 9, progressPercent: 10, soldOut: false, durationDays: 30, termDays: 30, term: '30 days', status: 'Active' as const, note: '' });
    const fetchRequest = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), window.location.href).pathname;
      const body = path === '/api/wallet/products'
        ? { products: [{ id: 'purchase-1', name: 'Owned Product', amount: 20000, status: 'COMPLETED', reference: 'PUR-1', purchasedAt: '2026-10-01T00:00:00Z' }] }
        : {};
      return { ok: true, json: async () => body } as Response;
    });
    vi.stubGlobal('fetch', fetchRequest);

    render(<PlansPage data={{ metrics: [], plans: [makePlan('Owned Product'), makePlan('Other Product')], referrals: [], tools: [] }} state="data" onRetry={() => undefined} onPurchased={() => undefined} />);

    expect(await screen.findByRole('button', { name: 'PURCHASED' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'BUY NOW' })).toBeEnabled();
  });
});

describe('Admin user role controls', () => {
  it('offers dismissal for another Admin account', async () => {
    const target = { id: 'admin-target', fullName: 'Other Admin', phoneNumber: '+250780000010', referralCode: 'ADMIN10', role: 'ADMIN', createdAt: '2026-10-01T00:00:00Z', lastActivity: null, isLive: false, availableBalance: 0, reservedBalance: 0, totalDeposit: 0, totalWithdrawal: 0, productsPurchased: 0, referredBy: null, referralCommissionEarned: 0, welcomeBonusAmount: 0, welcomeBonusUnlockedAt: null, accountStatus: 'ACTIVE', allowDeposits: true, allowWithdrawals: true, lastDepositStatus: null, lastWithdrawalStatus: null, permissions: { dashboard: true, products: true, wallet: true, deposit: true, withdraw: true, myTeam: true, support: true, telegram: true, messages: true } };
    const fetchRequest = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), window.location.href).pathname;
      const body = path === '/api/auth/me'
        ? { user: { id: 'current-admin', role: 'ADMIN' } }
        : path === '/api/admin/users'
          ? { users: [target], total: 1, limit: 25, offset: 0 }
          : path === `/api/admin/users/${target.id}`
            ? { user: target, transactions: [], messages: [], audit: [] }
            : {};
      return { ok: true, json: async () => body } as Response;
    });
    vi.stubGlobal('fetch', fetchRequest);

    render(<AdminUsersPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Other Admin/ }));

    expect(await screen.findByRole('button', { name: 'Dismiss Admin' })).toBeInTheDocument();
  });
});
