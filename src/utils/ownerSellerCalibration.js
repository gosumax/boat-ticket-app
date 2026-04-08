function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function extractSellerCalibrationState(row) {
  const nested = row?.seller_calibration_state && typeof row.seller_calibration_state === 'object'
    ? row.seller_calibration_state
    : {};

  return {
    calibration_status: String(
      nested.calibration_status ??
      row?.calibration_status ??
      'uncalibrated'
    ),
    effective_level: nested.effective_level ?? row?.effective_level ?? null,
    pending_next_week_level: nested.pending_next_week_level ?? row?.pending_next_week_level ?? null,
    streak_days: Math.max(0, safeNumber(nested.streak_days, 0)),
    streak_multiplier: safeNumber(
      nested.streak_multiplier ?? row?.streak_multiplier,
      1
    ),
    effective_week_id: nested.effective_week_id ?? row?.effective_week_id ?? null,
    pending_week_id: nested.pending_week_id ?? row?.pending_week_id ?? null,
  };
}

export function formatSellerCalibrationStatusLabel(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'calibrated') return 'Откалиброван';
  if (normalized === 'insufficient_data') return 'Недостаточно данных';
  return 'Не откалиброван';
}

export default {
  extractSellerCalibrationState,
  formatSellerCalibrationStatusLabel,
};
