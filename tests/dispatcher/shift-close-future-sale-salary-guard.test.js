import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { makeApp } from '../_helpers/makeApp.js';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';

const DAY = '2034-02-11';
const NEXT_DAY = '2034-02-12';

let app;
let db;
let dispatcherId;
let dispatcherToken;
let sellerId;

function findParticipant(body, userId) {
  const rows = Array.isArray(body?.sellers) ? body.sellers : [];
  return rows.find((row) => Number(row?.seller_id || 0) === Number(userId)) || null;
}

beforeAll(async () => {
  resetTestDb();
  app = await makeApp();
  db = getTestDb();

  const seedData = await seedBasicData(db);
  sellerId = Number(
    seedData?.users?.sellerA?.id ||
    db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 ORDER BY id ASC LIMIT 1`).get()?.id ||
    0
  );

  const hashedPassword = bcrypt.hashSync('password123', 10);
  const dispatcherRes = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'dispatcher', 1)
  `).run('Maria', hashedPassword);
  dispatcherId = Number(dispatcherRes.lastInsertRowid);
  dispatcherToken = jwt.sign(
    { id: dispatcherId, username: 'Maria', role: 'dispatcher' },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  db.prepare(`INSERT OR IGNORE INTO owner_settings (id, settings_json) VALUES (1, '{}')`).run();
});

beforeEach(() => {
  db.prepare(`DELETE FROM motivation_day_settings WHERE business_day IN (?, ?)`).run(DAY, NEXT_DAY);
  db.prepare(`DELETE FROM money_ledger WHERE business_day IN (?, ?)`).run(DAY, NEXT_DAY);
  db.prepare(`DELETE FROM shift_closures WHERE business_day IN (?, ?)`).run(DAY, NEXT_DAY);

  db.prepare(`UPDATE owner_settings SET settings_json = ? WHERE id = 1`).run(JSON.stringify({
    motivationType: 'team',
    motivation_percent: 0.15,
    team_share: 0.5,
    individual_share: 0.5,
    k_dispatchers: 1,
    teamIncludeSellers: true,
    teamIncludeDispatchers: true,
    dispatcher_withhold_percent_total: 0.004,
    weekly_withhold_percent_total: 0.008,
    season_withhold_percent_total: 0.005,
    viklif_withhold_percent_total: 0,
  }));

  db.prepare(`
    INSERT INTO money_ledger (type, kind, method, amount, status, business_day, trip_day, seller_id)
    VALUES ('SALE_ACCEPTED_CASH', 'SELLER_SHIFT', 'CASH', 60000, 'POSTED', ?, ?, ?)
  `).run(DAY, DAY, sellerId);
  db.prepare(`
    INSERT INTO money_ledger (type, kind, method, amount, status, business_day, trip_day, seller_id)
    VALUES ('SALE_ACCEPTED_CASH', 'DISPATCHER_SHIFT', 'CASH', 40000, 'POSTED', ?, ?, ?)
  `).run(DAY, DAY, dispatcherId);
});

describe('DISPATCHER SHIFT CLOSE FUTURE SALE SALARY GUARD', () => {
  it('future sale increases only reserve and does not change today salary breakdown', async () => {
    const beforeRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${DAY}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(beforeRes.status).toBe(200);
    expect(beforeRes.body.ok).toBe(true);

    const beforeMaria = findParticipant(beforeRes.body, dispatcherId);
    expect(beforeMaria).toBeDefined();
    expect(Number(beforeRes.body.future_trips_reserve_total || 0)).toBe(0);

    db.prepare(`
      INSERT INTO money_ledger (type, kind, method, amount, status, business_day, trip_day, seller_id)
      VALUES ('SALE_ACCEPTED_CASH', 'DISPATCHER_SHIFT', 'CASH', 13200, 'POSTED', ?, ?, ?)
    `).run(DAY, NEXT_DAY, dispatcherId);

    const afterRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${DAY}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(afterRes.status).toBe(200);
    expect(afterRes.body.ok).toBe(true);

    const afterMaria = findParticipant(afterRes.body, dispatcherId);
    expect(afterMaria).toBeDefined();

    expect(Number(afterRes.body.future_trips_reserve_total || 0)).toBe(13200);
    expect(Number(afterRes.body.salary_base || 0)).toBeCloseTo(Number(beforeRes.body.salary_base || 0), 6);
    expect(Number(afterRes.body.salary_due_total || 0)).toBeCloseTo(Number(beforeRes.body.salary_due_total || 0), 6);
    expect(
      Number(afterRes.body.motivation_withhold?.fund_total_original || 0)
    ).toBeCloseTo(Number(beforeRes.body.motivation_withhold?.fund_total_original || 0), 6);

    expect(Number(afterMaria.personal_revenue_day || 0)).toBeCloseTo(Number(beforeMaria.personal_revenue_day || 0), 6);
    expect(Number(afterMaria.team_part || 0)).toBeCloseTo(Number(beforeMaria.team_part || 0), 6);
    expect(Number(afterMaria.individual_part || 0)).toBeCloseTo(Number(beforeMaria.individual_part || 0), 6);
    expect(Number(afterMaria.dispatcher_daily_bonus || 0)).toBeCloseTo(Number(beforeMaria.dispatcher_daily_bonus || 0), 6);
    expect(Number(afterMaria.total_raw || 0)).toBeCloseTo(Number(beforeMaria.total_raw || 0), 6);
    expect(Number(afterMaria.salary_due_total || 0)).toBeCloseTo(Number(beforeMaria.salary_due_total || 0), 6);
  });
});
