import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { resetTestDb, getTestDb } from './dbReset.js';
import { seedBasicData } from './seedBasic.js';
import { makeApp } from './makeApp.js';

let app;
let db;

describe('LOGIN DIAGNOSTIC: isolated test database', () => {
  beforeAll(async () => {
    resetTestDb();
    app = await makeApp();
    db = getTestDb();
    await seedBasicData(db);
  });

  it('logs in against the dedicated test DB instead of database.sqlite', async () => {
    expect(String(process.env.DB_FILE || '')).toContain('_testdata');
    expect(String(process.env.DB_FILE || '')).not.toMatch(/database\.sqlite$/);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'sellerA', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body?.token).toBeTruthy();
  });
});
