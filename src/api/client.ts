import type { AdminPlanInput, ApiClient, DailyCheckinClaim, DailyCheckinStatus, DashboardData, DepositRequest, LoginRequest, RegisterRequest, UserMessage, WalletProduct, WalletRequest, WalletTransactionResponse, WithdrawalAccountInput, WithdrawalPreview } from './types';

const requestTimeoutMs = 4000;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      controller.abort();
      reject(new Error('The server is taking too long to respond. Please try again.'));
    }, requestTimeoutMs);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...init, credentials: 'same-origin', signal: controller.signal });
        const body = await response.json() as T & { error?: string };
        if (!response.ok) throw new Error(body.error ?? `Request failed with status ${response.status}`);
        return body;
      })(),
      timeout,
    ]);
  } catch (error) {
    throw error;
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

async function getDashboard(): Promise<DashboardData> {
  return request<DashboardData>('/api/dashboard');
}

const createWalletRequest = (path: string, input: WalletRequest | DepositRequest) => request<WalletTransactionResponse>(path, { method: 'POST', body: JSON.stringify(input) });

export const liveClient: ApiClient = {
  getCurrentUser: () => request('/api/auth/me'),
  getUserAccountState: () => request('/api/user/account-state'),
  register: (input: RegisterRequest) => request('/api/auth/register', { method: 'POST', body: JSON.stringify(input) }),
  login: (input: LoginRequest) => request('/api/auth/login', { method: 'POST', body: JSON.stringify(input) }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  getDashboard,
  getAdminPlans: () => request('/api/admin/plans'),
  createAdminPlan: (input: AdminPlanInput) => request('/api/admin/plans', { method: 'POST', body: JSON.stringify(input) }),
  updateAdminPlan: (name: string, input: AdminPlanInput) => request(`/api/admin/plans/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteAdminPlan: (name: string) => request(`/api/admin/plans/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  getBalance: () => request('/api/wallet/balance'),
  getWalletProducts: () => request<{ products: WalletProduct[] }>('/api/wallet/products'),
  getUserMessages: () => request<{ messages: UserMessage[]; unreadCount: number }>('/api/user/messages'),
  markUserMessageRead: (messageId) => request(`/api/user/messages/${encodeURIComponent(messageId)}/read`, { method: 'PATCH', body: JSON.stringify({}) }),
  getDailyCheckin: () => request<DailyCheckinStatus>('/api/wallet/daily-checkin'),
  claimDailyCheckin: () => request<DailyCheckinClaim>('/api/wallet/daily-checkin', { method: 'POST' }),
  getDepositMethods: () => request('/api/deposit-methods'),
  createDeposit: (input) => createWalletRequest('/api/deposits', input),
  createWithdrawal: (input) => createWalletRequest('/api/withdrawals', input),
  previewWithdrawal: (input) => request<WithdrawalPreview>('/api/withdrawals/preview', { method: 'POST', body: JSON.stringify(input) }),
  getWithdrawalAccount: () => request('/api/wallet/withdraw/account'),
  saveWithdrawalAccount: (input: WithdrawalAccountInput) => request('/api/wallet/withdraw/account', { method: 'PUT', body: JSON.stringify(input) }),
  getTransactions: () => request('/api/wallet/transactions'),
  getPaymentMethods: (type) => request(`/api/wallet/${type === 'deposit' ? 'deposit' : 'withdraw'}/methods`),
  createPurchase: (input) => request('/api/purchases', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': input.idempotencyKey }, body: JSON.stringify(input) }),
};
