import express from 'express';
import db from './db.js';
import { authenticateToken } from './auth.js';

const router = express.Router();

// POST /api/dispatcher/shift/deposit
router.post('/deposit', authenticateToken, (req, res) => {
  try {
    const { type, amount } = req.body;

    if (!type || !amount || Number(amount) <= 0) {
      return res.status(400).json({ ok: false, error: 'Некорректные данные' });
    }

    const allowedTypes = [
      'DEPOSIT_TO_OWNER_CASH',
      'DEPOSIT_TO_OWNER_TERMINAL',
      'SALARY_PAYOUT_CASH',
    ];

    if (!allowedTypes.includes(type)) {
      return res.status(400).json({ ok: false, error: 'Недопустимый type' });
    }

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'Требуется авторизация' });
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
        date('now','localtime'),
        date('now','localtime')
      )
    `).run(type, amount, userId);

    res.json({ ok: true });
  } catch (e) {
    console.error('[DISPATCHER SHIFT DEPOSIT ERROR]', e);
    res.status(500).json({ ok: false, error: 'Ошибка сервера' });
  }
});

export default router;
