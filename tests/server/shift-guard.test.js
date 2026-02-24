import { beforeEach, describe, expect, it } from 'vitest';
import db from '../../server/db.js';
import { assertShiftOpen, SHIFT_CLOSED_CODE } from '../../server/shift-guard.mjs';

describe('shift-guard assertShiftOpen(business_day)', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM shift_closures').run();
  });

  it('passes when business_day is not closed', () => {
    const day = '2099-06-01';
    const result = assertShiftOpen(day);
    expect(result).toMatchObject({
      ok: true,
      business_day: day,
      is_closed: false,
    });
  });

  it('throws uniform 409 SHIFT_CLOSED when business_day is closed', () => {
    const day = '2099-06-02';
    db.prepare('INSERT INTO shift_closures (business_day, closed_by) VALUES (?, ?)').run(day, 1);

    try {
      assertShiftOpen(day);
      throw new Error('expected assertShiftOpen to throw');
    } catch (e) {
      expect(e.status).toBe(409);
      expect(e.code).toBe(SHIFT_CLOSED_CODE);
      expect(e.payload).toMatchObject({
        ok: false,
        code: SHIFT_CLOSED_CODE,
        business_day: day,
      });
    }
  });
});

