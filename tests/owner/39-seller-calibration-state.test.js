import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDb, resetTestDb } from '../_helpers/dbReset.js';
import {
  buildInitialSellerCalibrationState,
  getSellerCalibrationState,
  listSellerCalibrationStates,
  upsertSellerCalibrationState,
} from '../../server/motivation/seller-calibration-state.mjs';
import {
  getIsoWeekIdForBusinessDay,
  getIsoWeekRangeLocal,
  getNextIsoWeekId,
} from '../../server/utils/iso-week.mjs';

let db;

function insertSeller(id, username) {
  db.prepare(`
    INSERT INTO users (id, username, password_hash, role, is_active)
    VALUES (?, ?, 'hash', 'seller', 1)
  `).run(id, username);
}

describe('SELLER CALIBRATION STATE', () => {
  beforeAll(() => {
    resetTestDb();
    db = getTestDb();
  });

  beforeEach(() => {
    db.prepare(`DELETE FROM seller_calibration_state`).run();
    db.prepare(`DELETE FROM seller_motivation_state`).run();
    db.prepare(`DELETE FROM users WHERE id IN (7101, 7102)`).run();
  });

  it('writes an uncalibrated state without touching the legacy motivation table', () => {
    insertSeller(7101, 'seller_hidden_calibration');

    const created = upsertSellerCalibrationState(
      db,
      buildInitialSellerCalibrationState({
        sellerId: 7101,
        businessDay: '2026-04-08',
      })
    );

    expect(created).toMatchObject({
      seller_id: 7101,
      calibration_status: 'uncalibrated',
      effective_level: null,
      pending_next_week_level: null,
      streak_days: 0,
      streak_multiplier: 1,
      last_completed_workday: null,
      worked_days_in_week: 0,
      completed_revenue_sum_week: 0,
      effective_week_id: '2026-W15',
      pending_week_id: null,
    });

    expect(db.prepare('SELECT COUNT(*) AS count FROM seller_motivation_state').get().count).toBe(0);
  });

  it('stores pending_next_week_level on the next Monday-Sunday week without replacing the current effective week', () => {
    insertSeller(7101, 'seller_pending_level');

    const state = upsertSellerCalibrationState(db, {
      sellerId: 7101,
      businessDay: '2026-04-12',
      calibrationStatus: 'calibrated',
      effectiveLevel: 'MEDIUM',
      pendingNextWeekLevel: 'STRONG',
      streakDays: 4,
      streakMultiplier: 1.15,
      lastCompletedWorkday: '2026-04-11',
      workedDaysInWeek: 5,
      completedRevenueSumWeek: 260000,
    });

    expect(state).toMatchObject({
      seller_id: 7101,
      calibration_status: 'calibrated',
      effective_level: 'MEDIUM',
      pending_next_week_level: 'STRONG',
      streak_days: 4,
      streak_multiplier: 1.15,
      last_completed_workday: '2026-04-11',
      worked_days_in_week: 5,
      completed_revenue_sum_week: 260000,
      effective_week_id: '2026-W15',
      pending_week_id: '2026-W16',
    });
    expect(state.pending_week_id).not.toBe(state.effective_week_id);

    expect(listSellerCalibrationStates(db, { sellerIds: [7101] })).toHaveLength(1);
  });

  it('uses ISO Monday-Sunday week ids across boundaries', () => {
    expect(getIsoWeekIdForBusinessDay('2025-12-29')).toBe('2026-W01');
    expect(getIsoWeekIdForBusinessDay('2026-01-04')).toBe('2026-W01');
    expect(getIsoWeekIdForBusinessDay('2026-01-05')).toBe('2026-W02');
    expect(getIsoWeekIdForBusinessDay('2026-04-12')).toBe('2026-W15');
    expect(getIsoWeekIdForBusinessDay('2026-04-13')).toBe('2026-W16');
    expect(getNextIsoWeekId('2026-W15')).toBe('2026-W16');
    expect(getIsoWeekRangeLocal('2026-W01')).toEqual({
      week_id: '2026-W01',
      dateFrom: '2025-12-29',
      dateTo: '2026-01-04',
    });
  });

  it('keeps legacy seller_motivation_state rows unchanged when the hidden calibration state is written', () => {
    insertSeller(7102, 'seller_legacy_runtime');

    db.prepare(`
      INSERT INTO seller_motivation_state (
        seller_id,
        calibrated,
        calibration_worked_days,
        calibration_revenue_sum,
        current_level,
        streak_days,
        last_eval_day,
        week_id,
        week_worked_days,
        week_revenue_sum
      )
      VALUES (?, 1, 3, 180000, 'MID', 3, '2026-04-12', '2026-W15', 5, 180000)
    `).run(7102);

    const legacyBefore = db.prepare(`
      SELECT *
      FROM seller_motivation_state
      WHERE seller_id = ?
    `).get(7102);

    upsertSellerCalibrationState(db, {
      sellerId: 7102,
      businessDay: '2026-04-12',
      calibrationStatus: 'calibrated',
      effectiveLevel: 'TOP',
      pendingNextWeekLevel: 'WEAK',
      streakDays: 8,
      streakMultiplier: 1.3,
      lastCompletedWorkday: '2026-04-12',
      workedDaysInWeek: 6,
      completedRevenueSumWeek: 420000,
    });

    const legacyAfter = db.prepare(`
      SELECT *
      FROM seller_motivation_state
      WHERE seller_id = ?
    `).get(7102);

    expect(legacyAfter).toEqual(legacyBefore);
    expect(getSellerCalibrationState(db, 7102)).toMatchObject({
      seller_id: 7102,
      effective_level: 'TOP',
      pending_next_week_level: 'WEAK',
      effective_week_id: '2026-W15',
      pending_week_id: '2026-W16',
    });
  });
});
