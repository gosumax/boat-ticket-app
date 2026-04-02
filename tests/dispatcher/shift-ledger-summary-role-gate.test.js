import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { makeApp } from '../_helpers/makeApp.js';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';

let app;
let db;
let sellerToken;
let dispatcherToken;
let ownerToken;

function signToken({ id, username, role }) {
  return jwt.sign({ id, username, role }, JWT_SECRET, { expiresIn: '24h' });
}

beforeAll(async () => {
  resetTestDb();
  app = await makeApp();
  db = getTestDb();
  const seedData = await seedBasicData(db);

  sellerToken = signToken({
    id: Number(seedData.users.sellerA.id),
    username: seedData.users.sellerA.username,
    role: 'seller',
  });

  dispatcherToken = signToken({
    id: Number(seedData.users.dispatcher.id),
    username: seedData.users.dispatcher.username,
    role: 'dispatcher',
  });

  const ownerInsert = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'owner', 1)
  `).run('owner_shift_summary_gate', 'test-password-hash');

  ownerToken = signToken({
    id: Number(ownerInsert.lastInsertRowid),
    username: 'owner_shift_summary_gate',
    role: 'owner',
  });
});

describe('dispatcher summary role gate', () => {
  it('rejects seller for both summary mounts', async () => {
    const endpoints = [
      '/api/dispatcher/summary?business_day=2099-10-01',
      '/api/dispatcher/shift-ledger/summary?business_day=2099-10-01',
    ];

    for (const endpoint of endpoints) {
      const res = await request(app)
        .get(endpoint)
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(403);
    }
  });

  it('allows dispatcher and owner for summary endpoint', async () => {
    const dispatcherRes = await request(app)
      .get('/api/dispatcher/summary?business_day=2099-10-02')
      .set('Authorization', `Bearer ${dispatcherToken}`);
    expect(dispatcherRes.status).toBe(200);
    expect(dispatcherRes.body.ok).toBe(true);

    const ownerRes = await request(app)
      .get('/api/dispatcher/summary?business_day=2099-10-02')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(ownerRes.status).toBe(200);
    expect(ownerRes.body.ok).toBe(true);
  });
});
