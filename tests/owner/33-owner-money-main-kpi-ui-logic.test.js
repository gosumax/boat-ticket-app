import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  OWNER_MONEY_MAIN_KPI_FORMULA,
  OWNER_MONEY_MAIN_KPI_TITLE,
  isMainKpiReducedByFunds,
} from '../../src/utils/ownerMoneyKpi.js';

describe('Owner Money: main KPI model and UI labels', () => {
  it('with non-zero funds, main KPI is not equal to cash after reserve', () => {
    expect(
      isMainKpiReducedByFunds({
        ownerAvailableCashAfterReserve: 10000,
        fundsWithholdCashToday: 750,
        cashTakeawayAfterReserveAndFunds: 9250,
      }),
    ).toBe(true);
  });

  it('main KPI title and formula labels are wired in OwnerMoneyView', () => {
    const viewPath = path.resolve(process.cwd(), 'src/views/OwnerMoneyView.jsx');
    const content = fs.readFileSync(viewPath, 'utf8');

    expect(OWNER_MONEY_MAIN_KPI_TITLE).toBe('Можно вынуть из кассы сегодня');
    expect(OWNER_MONEY_MAIN_KPI_FORMULA).toBe('Нал получено − резерв (нал) − фонды (нал) = можно вынуть');
    expect(content).toContain('owner-money-main-kpi-title');
    expect(content).toContain('owner-money-main-kpi-formula');
    expect(content).toContain('OWNER_MONEY_MAIN_KPI_TITLE');
    expect(content).toContain('OWNER_MONEY_MAIN_KPI_FORMULA');
  });
});
