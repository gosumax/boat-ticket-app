import db from './db.js';

export const SHIFT_CLOSED_CODE = 'SHIFT_CLOSED';
const SHIFT_CLOSED_MESSAGE = 'Нельзя выполнить операцию: смена за этот день уже закрыта. Обратитесь к owner.';

export function createShiftClosedError(businessDay) {
  const day = String(businessDay || '').trim();
  const err = new Error(SHIFT_CLOSED_MESSAGE);
  err.status = 409;
  err.code = SHIFT_CLOSED_CODE;
  err.business_day = day;
  err.payload = {
    ok: false,
    code: SHIFT_CLOSED_CODE,
    business_day: day,
    message: SHIFT_CLOSED_MESSAGE,
  };
  return err;
}

export function assertShiftOpen(businessDay) {
  const day = String(businessDay || '').trim();

  const closed = db
    .prepare('SELECT 1 FROM shift_closures WHERE business_day = ? LIMIT 1')
    .get(day);

  if (closed) {
    throw createShiftClosedError(day);
  }

  return { ok: true, business_day: day, is_closed: false };
}
