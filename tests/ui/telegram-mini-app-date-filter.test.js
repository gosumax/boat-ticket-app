import { describe, expect, it } from 'vitest';
import {
  createCatalogDatePresets,
  resolveDefaultCatalogDate,
} from '../../src/telegram/TelegramMiniApp.jsx';

describe('telegram mini app date filter presets', () => {
  it('defaults catalog date to today in local input format', () => {
    const referenceDate = new Date(2026, 3, 17, 14, 30, 0);

    expect(resolveDefaultCatalogDate(referenceDate)).toBe('2026-04-17');
  });

  it('builds russian quick presets for today, tomorrow, and day after tomorrow', () => {
    const referenceDate = new Date(2026, 3, 17, 14, 30, 0);

    expect(createCatalogDatePresets(referenceDate)).toEqual([
      {
        key: 'today',
        label: 'Сегодня',
        value: '2026-04-17',
      },
      {
        key: 'tomorrow',
        label: 'Завтра',
        value: '2026-04-18',
      },
      {
        key: 'day-after-tomorrow',
        label: 'Послезавтра',
        value: '2026-04-19',
      },
    ]);
  });

  it('keeps preset dates correct across month boundaries', () => {
    const referenceDate = new Date(2026, 0, 31, 23, 45, 0);

    expect(createCatalogDatePresets(referenceDate).map((preset) => preset.value)).toEqual([
      '2026-01-31',
      '2026-02-01',
      '2026-02-02',
    ]);
  });
});
