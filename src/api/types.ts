export type PlanStatus = 'Active' | 'Ending soon';
export type ReferralStatus = 'Active' | 'Pending';
export type CountryCode = 'RW' | 'BI' | 'UG';
export type CurrencyCode = 'RWF' | 'BIF' | 'UGX';
export interface AuthCountryOption { countryCode: CountryCode; countryName: string; phonePrefix: string; currencyCode: CurrencyCode; enabled: boolean; }
export type AccountStatus = 'ACTIVE' | 'FROZEN' | 'RESTRICTED' | 'SUSPENDED';
export type UserFeature = 'dashboard' | 'products' | 'wallet' | 'deposit' | 'withdraw' | 'myTeam' | 'support' | 'telegram' | 'messages';
export type UserPermissions = Record<UserFeature, boolean>;

export interface Metric {
  label: string;
  value: string;
  detail: string;
  tone: 'primary' | 'accent' | 'success';
}

export interface Plan {
  id?: string;
  name: string;
  description?: string;
  imageData?: string | null;
  image?: string;
  price: number;
  displayPrice?: number;
  deposited: string;
  incomePerDay: number;
  dailyIncome: number;
  displayDailyIncome?: number;
  totalIncome: number;
  displayTotalIncome?: number;
  currencyCode?: 'RWF' | 'BIF' | 'UGX';
  countryCode?: 'RW' | 'BI' | 'UG';
  purchaseBonus: number;
  totalSlots: number;
  soldSlots: number;
  remainingSlots: number;
  progressPercent: number;
  soldOut: boolean;
  durationDays: number;
  termDays?: number;
  startDate?: string;
  endDate?: string;
  term: string;
  status: PlanStatus;
  note: string;
}

export interface WalletProduct { id: string; name: string; amount: number; displayAmount?: number; currencyCode?: 'RWF' | 'BIF' | 'UGX'; status: 'COMPLETED'; reference: string; purchasedAt: string; dailyIncome: number; displayDailyIncome: number; durationDays: number; incomePaidDays: number; nextIncomeAt: string | null; }
export interface UserMessage { id: string; kind: 'PRIVATE' | 'BROADCAST'; title: string; body: string; notificationType: 'INFO' | 'SUCCESS' | 'WARNING'; createdAt: string; senderName: string | null; isRead: boolean; }

export interface Referral {
  person: string;
  joined: string;
  contribution: string;
  commission: string;
  status: ReferralStatus;
}

export interface SupportTool {
  name: string;
  value: string;
  state: string;
}

export interface DashboardData {
  metrics: Metric[];
  plans: Plan[];
  referrals: Referral[];
  tools: SupportTool[];
  countryCode?: 'RW' | 'BI' | 'UG';
  currencyCode?: 'RWF' | 'BIF' | 'UGX';
  exchangeRate?: number;
}

export interface DailyCheckinStatus { enabled: boolean; rewardAmount: number; displayRewardAmount?: number; currencyCode?: 'RWF' | 'BIF' | 'UGX'; claimed: boolean; claimedAt: string | null; }
export interface DailyCheckinClaim { claimed: true; rewardAmount: number; displayRewardAmount?: number; currencyCode?: 'RWF' | 'BIF' | 'UGX'; checkinDate: string; balance: WalletBalance; }

export interface ApiClient {
  getCurrentUser(): Promise<{ user: AuthUser | null }>;
  getUserAccountState(): Promise<Pick<AuthUser, 'accountStatus' | 'allowDeposits' | 'allowWithdrawals' | 'permissions'>>;
  register(input: RegisterRequest): Promise<{ user: AuthUser }>;
  login(input: LoginRequest): Promise<{ user: AuthUser }>;
  logout(): Promise<{ ok: boolean }>;
  getDashboard(): Promise<DashboardData>;
  getAdminPlans(): Promise<{ plans: Plan[] }>;
  createAdminPlan(input: AdminPlanInput): Promise<{ plan: Plan }>;
  updateAdminPlan(name: string, input: AdminPlanInput): Promise<{ plan: Plan }>;
  deleteAdminPlan(name: string): Promise<{ deleted: boolean }>;
  getBalance(): Promise<WalletBalance>;
  getWalletProducts(): Promise<{ products: WalletProduct[] }>;
  getUserMessages(): Promise<{ messages: UserMessage[]; unreadCount: number }>;
  markUserMessageRead(messageId: string): Promise<{ read: boolean }>;
  getDailyCheckin(): Promise<DailyCheckinStatus>;
  claimDailyCheckin(): Promise<DailyCheckinClaim>;
  getDepositMethods(): Promise<{ methods: DepositPaymentMethod[] }>;
  createDeposit(input: DepositRequest): Promise<WalletTransactionResponse>;
  createWithdrawal(input: WalletRequest): Promise<WalletTransactionResponse>;
  previewWithdrawal(input: WalletRequest): Promise<WithdrawalPreview>;
  getWithdrawalAccount(): Promise<{ account: WithdrawalAccount | null }>;
  saveWithdrawalAccount(input: WithdrawalAccountInput): Promise<{ account: WithdrawalAccount }>;
  getTransactions(): Promise<{ transactions: WalletTransaction[] }>;
  getPaymentMethods(type: 'deposit' | 'withdrawal'): Promise<{ methods: { code: PaymentMethod; name: string }[] }>;
  createPurchase(input: { productId: string; idempotencyKey: string }): Promise<{ purchase: { id: string; status: string; reference: string }; product: Plan; balance: WalletBalance; idempotentReplay?: boolean }>;
}

export interface AdminPlanInput { name: string; description: string; imageData: string; price: number; dailyIncome: number; durationDays: number; purchaseBonus: number; totalSlots: number; status: PlanStatus; position: number; }

export type TransactionType = 'DEPOSIT' | 'WITHDRAWAL';
export type TransactionStatus = 'PENDING' | 'APPROVED' | 'AWAITING_PAYOUT' | 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'REJECTED' | 'CANCELLED';
export type PaymentMethod = 'MTN_MOMO' | 'AIRTEL_MONEY';
export interface DepositPaymentMethod { id: string; name: string; accountName: string; accountNumber: string; instructions: string; ussdTemplate: string; minimumAmount: number; maximumAmount: number; countryCode?: 'RW' | 'BI' | 'UG'; currencyCode?: 'RWF' | 'BIF' | 'UGX'; customerUnitsPerRwf?: number; crossBorderEnabled?: boolean; receivingCountryCode?: 'RW' | 'BI' | 'UG'; receivingCurrencyCode?: 'RWF' | 'BIF' | 'UGX'; receivingUnitsPerRwf?: number; logoData: string | null; enabled: boolean; position: number; }
export interface WalletBalance { userId: string; availableBalance: number; reservedBalance: number; displayAvailableBalance?: number; displayReservedBalance?: number; lockedWelcomeBonus?: number; displayLockedWelcomeBonus?: number; welcomeBonusAmount?: number; displayWelcomeBonusAmount?: number; countryCode?: 'RW' | 'BI' | 'UG'; currencyCode?: 'RWF' | 'BIF' | 'UGX'; exchangeRate?: number; paymentMode: string; welcomeBonusStatus?: 'NONE' | 'LOCKED' | 'UNLOCKED'; welcomeBonusAwardedAt?: string | null; welcomeBonusUnlockedAt?: string | null; }
export interface WalletRequest { amount: number; phoneNumber: string; paymentMethod: PaymentMethod; senderName?: string; receiverName?: string; }
export interface DepositRequest { amount: number; phoneNumber: string; senderName: string; depositMethodId: string; screenshotData: string; }
export interface WithdrawalPreview { channel: string; phoneNumber: string; receiverName: string; paymentMethod: string; availableBalance: number; displayAvailableBalance?: number; withdrawalAmount: number; displayWithdrawalAmount?: number; withdrawalFee: number; displayWithdrawalFee?: number; amountReceived: number; displayAmountReceived?: number; currencyCode?: 'RWF' | 'BIF' | 'UGX'; }
export interface WithdrawalAccount { accountHolderName: string; phoneNumber: string; paymentMethod: PaymentMethod; createdAt: string; updatedAt: string; }
export interface WithdrawalAccountInput { accountHolderName: string; phoneNumber: string; paymentMethod: PaymentMethod; }
export interface WalletTransaction { id: string; userId: string; userName?: string; type: TransactionType; amount: number; displayAmount?: number; withdrawalFee: number; displayFee?: number; amountReceived: number; displayAmountReceived?: number; countryCode?: 'RW' | 'BI' | 'UG'; currencyCode?: 'RWF' | 'BIF' | 'UGX'; exchangeRate?: number; depositReceivingCountryCode?: 'RW' | 'BI' | 'UG' | null; depositReceivingCurrencyCode?: 'RWF' | 'BIF' | 'UGX' | null; depositReceivingExchangeRate?: number | null; depositPaymentAmount?: number | null; senderName: string; receiverName: string; phoneNumber: string; paymentMethod: string; depositMethodId?: string | null; depositMethodName?: string | null; screenshotData?: string | null; status: TransactionStatus; provider: string; providerReference: string; internalReference: string; failureReason: string | null; rejectionReason: string | null; createdAt: string; updatedAt: string; completedAt: string | null; }
export interface WalletTransactionResponse { transaction: WalletTransaction; }
export interface SupportSettings { telegramUrl: string; telegramPopupMessage: string; supportEmail: string; liveChatEnabled: boolean; }
export interface SupportConversation { id: string; user_id: string; status: 'OPEN' | 'RESOLVED'; }
export interface SupportMessage { id: string; authorId: string; body: string; createdAt: string; }
export interface AuthUser { id: string; fullName: string; phoneNumber: string; referralCode: string; role: 'USER' | 'ADMIN'; countryCode?: 'RW' | 'BI' | 'UG'; currencyCode?: 'RWF' | 'BIF' | 'UGX'; exchangeRate?: number; welcomeBonusAmount?: number; displayWelcomeBonusAmount?: number; welcomeBonusStatus?: 'NONE' | 'LOCKED' | 'UNLOCKED'; welcomeBonusAwardedAt?: string | null; welcomeBonusUnlockedAt?: string | null; accountStatus: AccountStatus; allowDeposits: boolean; allowWithdrawals: boolean; permissions: UserPermissions; }
export interface RegisterRequest { fullName: string; phoneNumber: string; countryCode?: CountryCode; password: string; referralCode?: string; }
export interface LoginRequest { phoneNumber: string; countryCode?: CountryCode; password: string; }
