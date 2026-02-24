import { describe, it, expect } from 'vitest';
import {
  getSeasonConfigUiState,
  getSeasonDisplayWarnings,
  resolveSeasonBoundaries,
  validateSeasonBoundaryPair,
} from '../../src/utils/seasonBoundaries.js';

describe('Owner motivation season boundaries UI fallback', () => {
  it('uses saved MM-DD boundaries when both values are valid', () => {
    const result = resolveSeasonBoundaries({
      season_start_mmdd: '05-01',
      season_end_mmdd: '10-15',
    });

    expect(result).toEqual({ start: '05-01', end: '10-15' });
  });

  it('falls back to 01-01 ... 12-31 when values are absent', () => {
    const result = resolveSeasonBoundaries({});
    expect(result).toEqual({ start: '01-01', end: '12-31' });
  });

  it('falls back to 01-01 ... 12-31 when format is invalid', () => {
    const result = resolveSeasonBoundaries({
      season_start_mmdd: '5-01',
      season_end_mmdd: '10-15',
    });

    expect(result).toEqual({ start: '01-01', end: '12-31' });
  });

  it('falls back to 01-01 ... 12-31 when range crosses year boundary', () => {
    const result = resolveSeasonBoundaries({
      season_start_mmdd: '11-01',
      season_end_mmdd: '03-31',
    });

    expect(result).toEqual({ start: '01-01', end: '12-31' });
  });
});

describe('Owner settings season MM-DD UI validation', () => {
  it('rejects cross-year range with Russian message', () => {
    const validation = validateSeasonBoundaryPair('11-01', '03-31');
    expect(validation.ok).toBe(false);
    expect(validation.error).toContain('внутри одного года');
  });

  it('accepts valid inclusive range', () => {
    const validation = validateSeasonBoundaryPair('05-01', '10-15');
    expect(validation.ok).toBe(true);
    expect(validation.start).toBe('05-01');
    expect(validation.end).toBe('10-15');
  });
});

describe('Owner season config status and badge UI', () => {
  it('shows whole-year status for default boundaries', () => {
    const ui = getSeasonConfigUiState({});
    expect(ui.start).toBe('01-01');
    expect(ui.end).toBe('12-31');
    expect(ui.isCustom).toBe(false);
    expect(ui.statusLabel).toBe('Сезон: весь год');
    expect(ui.badgeLabel).toBe('');
  });

  it('shows custom status and badge for custom boundaries', () => {
    const ui = getSeasonConfigUiState({
      season_start_mmdd: '05-01',
      season_end_mmdd: '10-15',
    });
    expect(ui.start).toBe('05-01');
    expect(ui.end).toBe('10-15');
    expect(ui.isCustom).toBe(true);
    expect(ui.statusLabel).toBe('Используется кастомный сезон');
    expect(ui.badgeLabel).toBe('Кастомный диапазон');
  });
});

describe('Owner motivation season UI warnings', () => {
  it('shows warning for short season range', () => {
    const warnings = getSeasonDisplayWarnings({
      seasonFrom: '2032-05-10',
      seasonTo: '2032-05-12',
      seasonPoolTotalLedger: 100,
      seasonPoolTotalDailySum: 100,
      totalPoints: 1000,
    });

    expect(warnings.some((w) => String(w).includes('Короткий диапазон'))).toBe(true);
  });

  it('shows warning for empty season data', () => {
    const warnings = getSeasonDisplayWarnings({
      seasonFrom: '2032-05-10',
      seasonTo: '2032-05-20',
      seasonPoolTotalLedger: 0,
      seasonPoolTotalDailySum: 0,
      totalPoints: 0,
    });

    expect(warnings.some((w) => String(w).includes('нет данных фонда и очков'))).toBe(true);
  });
});
