// 01-auth-and-me.test.js — Auth flow for seller
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { getTestDb, getTableCounts } from '../_helpers/dbReset.js';
import { loadSeedData } from '../_helpers/loadSeedData.js';
import { makeApp } from '../_helpers/makeApp.js';
import { httpLog } from '../_helpers/httpLog.js';

let app, db, seedData;

beforeAll(async () => {
  httpLog.clear();
  db = getTestDb(); // Reuse already initialized DB
  seedData = loadSeedData(); // Load seed data from global setup
  app = await makeApp();
});

describe('SELLER AUTH', () => {
  it('POST /api/auth/login - seller login success', async () => {
    const start = Date.now();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'sellerA', password: 'password123' });
    const duration = Date.now() - start;
    httpLog.log('POST', '/api/auth/login', res.status, duration);
    
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('user');
    expect(res.body.user.role).toBe('seller');
    expect(res.body.user.username).toBe('sellerA');
  });
  
  it('POST /api/auth/login - wrong password', async () => {
    const start = Date.now();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'sellerA', password: 'wrongpass' });
    const duration = Date.now() - start;
    httpLog.log('POST', '/api/auth/login', res.status, duration);
    
    expect(res.status).toBe(401);
  });
  
  it('GET /api/auth/me - seller authenticated', async () => {
    // First login
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'sellerA', password: 'password123' });
    
    const token = loginRes.body.token;
    
    const start = Date.now();
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    const duration = Date.now() - start;
    httpLog.log('GET', '/api/auth/me', res.status, duration);
    
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('seller');
    expect(res.body.username).toBe('sellerA');
  });
});
