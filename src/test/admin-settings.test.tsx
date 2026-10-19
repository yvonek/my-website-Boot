import { FluentProvider, createLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminBusinessSettingsPage } from '../pages/AdminBusinessSettingsPage';

const platformSettings = {
  withdrawalFeeEnabled: false,
  withdrawalFeeType: 'PERCENTAGE',
  withdrawalFeeValue: 0,
  welcomeBonusEnabled: false,
  welcomeBonusAmount: 0,
};
const testBrand = { 10: '#2a0710', 20: '#450b18', 30: '#600f20', 40: '#7d1428', 50: '#99192f', 60: '#b31f35', 70: '#c82d42', 80: '#d74355', 90: '#e05d6a', 100: '#e87a83', 110: '#ef999f', 120: '#f4b5b9', 130: '#f8cdd0', 140: '#fbe0e2', 150: '#fdf0f1', 160: '#fff8f8' };

function response(body: unknown) {
  return { ok: true, json: async () => body } as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe('Admin platform settings', () => {
  it('loads, edits and saves the global welcome bonus and withdrawal fee', async () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    const fetchRequest = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), window.location.href).pathname;
      if (path === '/api/admin/referral-settings') return response({ settings: [] });
      if (path === '/api/admin/deposit-methods') return response({ methods: [] });
      if (path === '/api/admin/daily-checkin') return response({ enabled: false, rewardAmount: 0 });
      if (path === '/api/admin/platform-settings') return response(init?.method === 'PUT' ? JSON.parse(String(init.body)) : platformSettings);
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchRequest);

    render(<FluentProvider theme={createLightTheme(testBrand)}><AdminBusinessSettingsPage sessionAdmin section="settings" /></FluentProvider>);
    expect(await screen.findByText('Platform settings', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Welcome bonus', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Withdrawal fee', { exact: true })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Disabled' }));
    fireEvent.change(screen.getByLabelText('Welcome bonus amount (RWF)'), { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Fee disabled' }));
    fireEvent.change(screen.getByLabelText('Fee value (%)'), { target: { value: '5' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save settings' })[0]);

    await waitFor(() => expect(fetchRequest).toHaveBeenCalledWith('/api/admin/platform-settings', expect.objectContaining({ method: 'PUT' })));
    const saveCall = fetchRequest.mock.calls.find(([input, init]) => String(input) === '/api/admin/platform-settings' && init?.method === 'PUT');
    expect(JSON.parse(String(saveCall?.[1]?.body))).toEqual({
      withdrawalFeeEnabled: true,
      withdrawalFeeType: 'PERCENTAGE',
      withdrawalFeeValue: 5,
      welcomeBonusEnabled: true,
      welcomeBonusAmount: 5000,
      minimumWithdrawal: 0,
      usdtFeePercent: 0,
      usdtDepositFeeType: 'PERCENTAGE',
      usdtDepositFeeValue: 0,
    });
  }, 20000);

  it('creates a gift code from the Rewards screen', async () => {
    const fetchRequest = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), window.location.href).pathname;
      if (path === '/api/admin/referral-settings') return response({ settings: [] });
      if (path === '/api/admin/deposit-methods') return response({ methods: [] });
      if (path === '/api/admin/daily-checkin') return response({ enabled: false, rewardAmount: 0 });
      if (path === '/api/admin/gift-codes' && init?.method === 'POST') return response({ code: { id: 'gift-1', code: 'WELCOME-5000', amount: 200, tiers: [{ users: 5, rewardAmount: 200 }, { users: 5, rewardAmount: 150 }], maxUses: 10, expiresAt: null, isActive: true, createdAt: '2026-10-19T00:00:00Z', redemptionCount: 0 } });
      if (path === '/api/admin/gift-codes') return response({ codes: [] });
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchRequest);

    render(<FluentProvider theme={createLightTheme(testBrand)}><AdminBusinessSettingsPage sessionAdmin section="rewards" /></FluentProvider>);
    expect(await screen.findByText('Gift codes', { exact: true })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'welcome-5000' } });
    let userInputs = screen.getAllByRole('spinbutton', { name: 'Users in tier' });
    let rewardInputs = screen.getAllByRole('spinbutton', { name: 'Reward per user (RWF)' });
    fireEvent.change(userInputs[0], { target: { value: '5' } });
    fireEvent.change(rewardInputs[0], { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add tier' }));
    userInputs = screen.getAllByRole('spinbutton', { name: 'Users in tier' });
    rewardInputs = screen.getAllByRole('spinbutton', { name: 'Reward per user (RWF)' });
    fireEvent.change(userInputs[1], { target: { value: '5' } });
    fireEvent.change(rewardInputs[1], { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create gift code' }));

    await waitFor(() => expect(fetchRequest).toHaveBeenCalledWith('/api/admin/gift-codes', expect.objectContaining({ method: 'POST' })));
    const saveCall = fetchRequest.mock.calls.find(([input, init]) => String(input) === '/api/admin/gift-codes' && init?.method === 'POST');
    expect(JSON.parse(String(saveCall?.[1]?.body)).tiers).toEqual([{ users: 5, rewardAmount: 200 }, { users: 5, rewardAmount: 150 }]);
    expect(await screen.findByText('Gift code WELCOME-5000 created.')).toBeInTheDocument();
  });

  it('saves one shared daily check-in reward', async () => {
    const fetchRequest = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), window.location.href).pathname;
      if (path === '/api/admin/referral-settings') return response({ settings: [] });
      if (path === '/api/admin/deposit-methods') return response({ methods: [] });
      if (path === '/api/admin/daily-checkin' && init?.method === 'PUT') return response(JSON.parse(String(init.body)));
      if (path === '/api/admin/daily-checkin') return response({ enabled: true, rewardAmount: 200 });
      if (path === '/api/admin/gift-codes') return response({ codes: [] });
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchRequest);

    render(<FluentProvider theme={createLightTheme(testBrand)}><AdminBusinessSettingsPage sessionAdmin section="rewards" /></FluentProvider>);
    expect(await screen.findByText('Daily check-in', { exact: true })).toBeInTheDocument();
    const rewardInput = screen.getByRole('spinbutton', { name: 'Reward per day (RWF)' });
    expect((rewardInput as HTMLInputElement).value).toBe('200');
    fireEvent.change(rewardInput, { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save check-in' }));

    await waitFor(() => expect(fetchRequest).toHaveBeenCalledWith('/api/admin/daily-checkin', expect.objectContaining({ method: 'PUT' })));
    const saveCall = fetchRequest.mock.calls.find(([input, init]) => String(input) === '/api/admin/daily-checkin' && init?.method === 'PUT');
    expect(JSON.parse(String(saveCall?.[1]?.body))).toEqual({ enabled: true, rewardAmount: 250 });
  });
});
