import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { DepositPaymentMethod } from '../api/types';
import { DepositPage } from '../pages/DepositPage';

vi.mock('../api', () => ({
  api: {
    getDepositMethods: vi.fn(),
    getTransactions: vi.fn(),
    createDeposit: vi.fn(),
  },
}));

const baseMethod = {
  name: 'USDT',
  accountName: 'KIM-B-SELL',
  instructions: '',
  ussdTemplate: '',
  minimumAmount: 1000,
  maximumAmount: 500000,
  receivingCountryCode: 'UG',
  receivingCurrencyCode: 'UGX',
  receivingUnitsPerRwf: 1,
  logoData: null,
  enabled: true,
  position: 1,
} as const;

const ugUsdtMethod: DepositPaymentMethod = {
  ...baseMethod,
  id: 'DEP-usdt-ug',
  accountNumber: 'TC9HWxxWHz4qhTcMZyBj2F18D4Z81zk1CY',
  countryCode: 'UG',
  currencyCode: 'UGX',
  customerUnitsPerRwf: 1,
  cryptoNetwork: 'TRC20',
  unitsPerUsdt: 3700,
  usdtDepositFeeType: 'PERCENTAGE',
  usdtDepositFeeValue: 15,
};

const ugMomoMethod: DepositPaymentMethod = {
  ...baseMethod,
  id: 'DEP-momo-ug',
  name: 'MTN MoMo',
  accountName: 'Rachel',
  accountNumber: '0793631860',
  countryCode: 'UG',
  currencyCode: 'UGX',
  customerUnitsPerRwf: 1,
  cryptoNetwork: '',
  ussdTemplate: '*165*1*{{number}}*{{amount}}#',
  receivingCurrencyCode: 'UGX',
};

describe('DepositPage merchant details', () => {
  beforeEach(() => {
    vi.mocked(api.getTransactions).mockResolvedValue({ transactions: [] } as never);
  });

  it('shows the merchant number with the wallet for a UG USDT method', async () => {
    vi.mocked(api.getDepositMethods).mockResolvedValue({ methods: [ugUsdtMethod] });

    render(<DepositPage />);

    expect(await screen.findByText('Merchant number (TRC20 USDT wallet)')).toBeInTheDocument();
    expect(screen.getByText('TC9HWxxWHz4qhTcMZyBj2F18D4Z81zk1CY')).toBeInTheDocument();
    expect(screen.getByText('Merchant name')).toBeInTheDocument();
    expect(screen.queryByText('TRC20 USDT wallet address')).not.toBeInTheDocument();
  });

  it('shows the plain merchant number for a UG fiat method', async () => {
    vi.mocked(api.getDepositMethods).mockResolvedValue({ methods: [ugMomoMethod] });

    render(<DepositPage />);

    expect(await screen.findByText('Merchant number')).toBeInTheDocument();
    expect(screen.getByText('0793631860')).toBeInTheDocument();
    expect(screen.queryByText('Merchant number (TRC20 USDT wallet)')).not.toBeInTheDocument();
  });

  it('shows the USDT amount instead of UGX for a UG USDT method', async () => {
    vi.mocked(api.getDepositMethods).mockResolvedValue({ methods: [{ ...ugUsdtMethod, customerUnitsPerRwf: 3.5 }] });

    render(<DepositPage />);

    fireEvent.change(await screen.findByPlaceholderText('1000–500000'), { target: { value: '15000' } });

    expect(await screen.findByText('Amount in USDT')).toBeInTheDocument();
    expect(screen.getByText('16.32 USDT')).toBeInTheDocument();
    expect(screen.queryByText('Amount in UGX')).not.toBeInTheDocument();
  });

  it('shows the UGX equivalent of an RWF amount for a UG fiat method', async () => {
    vi.mocked(api.getDepositMethods).mockResolvedValue({ methods: [{ ...ugMomoMethod, customerUnitsPerRwf: 3.5 }] });

    render(<DepositPage />);

    fireEvent.change(await screen.findByPlaceholderText('1000–500000'), { target: { value: '15000' } });

    expect(await screen.findByText('Amount in UGX')).toBeInTheDocument();
    expect(screen.getByText('52,500 UGX')).toBeInTheDocument();
  });
});
