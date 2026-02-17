import express from 'express';
import db from './db.js';

const router = express.Router();

// Allowed deposit types (strict whitelist)
const ALLOWED_DEPOSIT_TYPES = [
  'DEPOSIT_TO_OWNER_CASH',
  'DEPOSIT_TO_OWNER_CARD',
  'SALARY_PAYOUT_CASH',
  'SALARY_PAYOUT_CARD',
];

// POST /api/dispatcher/shift/deposit
// Auth & role check applied at mount level in index.js
router.post('/deposit', (req, res) => {
  try {
    const { type, amount } = req.body;

    // Strict validation: amount must be positive number
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      return res.status(400).json({ ok: false, error: 'Сумма должна быть положительным числом' });
    }

    // Strict validation: type must be in whitelist
    if (!type || !ALLOWED_DEPOSIT_TYPES.includes(type)) {
      return res.status(400).json({ ok: false, error: 'Недопустимый тип операции' });
    }

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'Требуется авторизация' });
    }

    // Server-calculated business_day (ignore client input if any)
    const businessDay = db.prepare("SELECT DATE('now','localtime') AS d").get()?.d;

    // Protection: check for recent duplicate deposit (same user, type, business_day within last 60 seconds)
    const recentDuplicate = db.prepare(`
      SELECT 1 FROM money_ledger
      WHERE seller_id = ?
        AND type = ?
        AND business_day = ?
        AND kind = 'DISPATCHER_SHIFT'
        AND status = 'POSTED'
        AND datetime(event_time) >= datetime('now', '-60 seconds', 'localtime')
      LIMIT 1
    `).get(userId, type, businessDay);

    if (recentDuplicate) {
      return res.status(409).json({ ok: false, error: 'Дубликат операции: такая запись уже создана менее минуты назад' });
    }

    // IMPORTANT: shift-ledger summary filters by business_day, so we must fill it here
    db.prepare(`
      INSERT INTO money_ledger (
        kind,
        type,
        amount,
        seller_id,
        status,
        event_time,
        business_day,
        trip_day
      ) VALUES (
        'DISPATCHER_SHIFT',
        ?,
        ?,
        ?,
        'POSTED',
        datetime('now','localtime'),
        ?,
        ?
      )
    `).run(type, numAmount, userId, businessDay, businessDay);

    res.json({ ok: true, business_day: businessDay, type, amount: numAmount });
  } catch (e) {
    console.error('[DISPATCHER SHIFT DEPOSIT ERROR]', e);
    res.status(500).json({ ok: false, error: 'Ошибка сервера' });
  }
});

export default router;
