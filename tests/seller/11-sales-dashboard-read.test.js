import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { makeApp } from '../_helpers/makeApp.js';

let app;
let db;
let seedData;
let sellerAToken;
let sellerBToken;
let dispatcherToken;

beforeAll(async () => {
  resetTestDb();
  db = getTestDb();
  seedData = await seedBasicData(db);
  app = await makeApp();

  sellerAToken = (
    await request(app).post('/api/auth/login').send({ username: 'sellerA', password: 'password123' })
  ).body.token;
  sellerBToken = (
    await request(app).post('/api/auth/login').send({ username: 'sellerB', password: 'password123' })
  ).body.token;
  dispatcherToken = (
    await request(app).post('/api/auth/login').send({ username: 'dispatcher1', password: 'password123' })
  ).body.token;

  await request(app)
    .post('/api/selling/presales')
    .set('Authorization', `Bearer ${sellerAToken}`)
    .send({
      slotUid: `manual:${seedData.slots.manual.slot7}`,
      customerName: 'Seller A sale',
      customerPhone: '+79990000001',
      numberOfSeats: 2,
      prepaymentAmount: 1000,
    })
    .expect(201);

  await request(app)
    .post('/api/selling/presales')
    .set('Authorization', `Bearer ${sellerBToken}`)
    .send({
      slotUid: `generated:${seedData.slots.generated.genSlot1}`,
      customerName: 'Seller B sale',
      customerPhone: '+79990000002',
      numberOfSeats: 1,
      prepaymentAmount: 500,
      tripDate: seedData.slots.generated.tomorrow,
    })
    .expect(201);
});

describe('SELLER SALES DASHBOARD READ MODEL', () => {
  it('GET /api/selling/presales returns only current seller presales for seller role', async () => {
    const res = await request(app)
      .get('/api/selling/presales')
      .set('Authorization', `Bearer ${sellerAToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].customer_name).toBe('Seller A sale');
    expect(res.body[0]).toHaveProperty('slot_trip_date');
  });

  it('GET /api/selling/presales includes dispatcher-created sales attributed to the current seller', async () => {
    const createRes = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        slotUid: `generated:${seedData.slots.generated.genSlot2}`,
        customerName: 'Dispatcher for Seller A',
        customerPhone: '+79990000003',
        numberOfSeats: 1,
        sellerId: seedData.users.sellerA.id,
        tripDate: seedData.slots.generated.tomorrow,
      });

    expect(createRes.status).toBe(201);

    const acceptRes = await request(app)
      .patch(`/api/selling/presales/${createRes.body.presale.id}/accept-payment`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ payment_method: 'CASH' });

    expect(acceptRes.status).toBe(200);

    const sellerARes = await request(app)
      .get('/api/selling/presales')
      .set('Authorization', `Bearer ${sellerAToken}`);

    expect(sellerARes.status).toBe(200);
    expect(sellerARes.body.map((row) => row.customer_name)).toEqual(
      expect.arrayContaining(['Seller A sale', 'Dispatcher for Seller A'])
    );

    const dispatcherAttributedSale = sellerARes.body.find((row) => row.customer_name === 'Dispatcher for Seller A');
    expect(dispatcherAttributedSale).toBeDefined();
    expect(dispatcherAttributedSale.slot_trip_date).toBe(seedData.slots.generated.tomorrow);
    expect(Number(dispatcherAttributedSale.prepayment_amount || 0)).toBeGreaterThan(0);

    const sellerBRes = await request(app)
      .get('/api/selling/presales')
      .set('Authorization', `Bearer ${sellerBToken}`);

    expect(sellerBRes.status).toBe(200);
    expect(sellerBRes.body.map((row) => row.customer_name)).not.toContain('Dispatcher for Seller A');
  });

  it('GET /api/selling/presales preserves dispatcher visibility across sellers', async () => {
    const res = await request(app)
      .get('/api/selling/presales')
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    expect(res.body.map((row) => row.customer_name)).toEqual(
      expect.arrayContaining(['Seller A sale', 'Seller B sale'])
    );
  });

  it('GET /api/selling/presales keeps raw created_at contract so seller UI can normalize UTC timestamps consistently', async () => {
    const sellerARow = db.prepare(`SELECT id FROM presales WHERE customer_name = ?`).get('Seller A sale');
    expect(Number(sellerARow?.id || 0)).toBeGreaterThan(0);

    db.prepare(`
      UPDATE presales
      SET created_at = ?, updated_at = ?
      WHERE id = ?
    `).run('2026-04-08 14:22:00', '2026-04-08 14:22:00', sellerARow.id);

    const res = await request(app)
      .get('/api/selling/presales')
      .set('Authorization', `Bearer ${sellerAToken}`);

    expect(res.status).toBe(200);
    const sale = res.body.find((row) => row.customer_name === 'Seller A sale');
    expect(sale).toBeDefined();
    expect(sale.created_at).toBe('2026-04-08 14:22:00');
  });

  it('GET /api/selling/seller-dashboard returns seller-only metrics from existing backend sources', async () => {
    await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${sellerAToken}`)
      .send({
        slotUid: `manual:${seedData.slots.manual.slot7}`,
        customerName: 'Seller A card prepayment',
        customerPhone: '+79990000004',
        numberOfSeats: 1,
        prepaymentAmount: 700,
        payment_method: 'CARD',
      })
      .expect(201);

    const res = await request(app)
      .get('/api/selling/seller-dashboard')
      .set('Authorization', `Bearer ${sellerAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data?.dates?.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.data?.dates?.tomorrow).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.data?.earnings?.available).toBe(true);
    expect(res.body.data?.points).toHaveProperty('today');
    expect(res.body.data?.prepayments_today).toMatchObject({
      available: true,
      cash: 1000,
      card: 700,
      total: 1700,
    });
    expect(res.body.data?.week?.total_sellers).toBeGreaterThanOrEqual(1);
    expect(res.body.data?.season).toHaveProperty('total_sellers');
    expect(res.body.data?.week).toHaveProperty('current_payout');
    expect(Array.isArray(res.body.data?.week?.prizes)).toBe(true);
    expect(res.body.data?.season).toHaveProperty('current_payout');
    expect(res.body.data?.season?.worked_days_required).toBe(75);
    expect(res.body.data?.season?.worked_days_sep_required).toBe(20);
    expect(res.body.data?.season?.worked_days_end_sep_required).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS c FROM motivation_day_settings').get().c).toBe(0);
  });

  it('GET /api/selling/seller-dashboard/weekly returns seller-friendly weekly leaderboard with current seller highlight', async () => {
    const res = await request(app)
      .get('/api/selling/seller-dashboard/weekly')
      .set('Authorization', `Bearer ${sellerAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data?.week_id).toMatch(/^\d{4}-W\d{2}$/);
    expect(Array.isArray(res.body.data?.prizes)).toBe(true);
    expect(Array.isArray(res.body.data?.sellers)).toBe(true);
    expect(res.body.data?.total_sellers).toBeGreaterThanOrEqual(1);
    expect(res.body.data?.sellers).toHaveLength(res.body.data?.total_sellers);
    expect(Number(res.body.data?.current_seller?.user_id || 0)).toBe(seedData.users.sellerA.id);
    expect(res.body.data?.current_seller?.is_current_seller).toBe(true);
    expect(res.body.data.sellers.map((row) => Number(row.user_id))).toEqual(
      expect.arrayContaining([seedData.users.sellerA.id, seedData.users.sellerB.id])
    );
    expect(
      res.body.data.sellers.some((row) => Number(row.user_id) === seedData.users.sellerA.id && row.is_current_seller === true)
    ).toBe(true);
  });

  it('GET /api/selling/seller-dashboard/season returns seller-friendly season progress and payout state', async () => {
    const res = await request(app)
      .get('/api/selling/seller-dashboard/season')
      .set('Authorization', `Bearer ${sellerAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data?.season_id).toMatch(/^\d{4}$/);
    expect(res.body.data?.eligibility_rules?.min_worked_days_season).toBe(75);
    expect(res.body.data?.eligibility_rules?.min_worked_days_sep).toBe(20);
    expect(res.body.data?.eligibility_rules?.min_worked_days_end_sep).toBe(1);
    expect(Array.isArray(res.body.data?.sellers)).toBe(true);
    expect(res.body.data?.sellers.length).toBeGreaterThanOrEqual(res.body.data?.total_sellers || 0);
    expect(Number(res.body.data?.current_seller?.user_id || 0)).toBe(seedData.users.sellerA.id);
    expect(res.body.data?.current_seller?.is_current_seller).toBe(true);
    expect(res.body.data?.current_seller).toHaveProperty('worked_days_season');
    expect(res.body.data?.current_seller).toHaveProperty('remaining_days_season');
    expect(res.body.data?.current_seller).toHaveProperty('season_payout_recipient');
  });

  it('GET /api/selling/seller-dashboard rejects dispatcher role to keep seller scope explicit', async () => {
    const res = await request(app)
      .get('/api/selling/seller-dashboard')
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
  });
});
