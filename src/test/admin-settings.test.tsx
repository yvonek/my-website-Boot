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
    });
  });
});
