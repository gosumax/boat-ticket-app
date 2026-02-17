// 02-slots-and-boats.test.js — Boats and slots listing for seller
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { getTestDb } from '../_helpers/dbReset.js';
import { loadSeedData } from '../_helpers/loadSeedData.js';
import { makeApp } from '../_helpers/makeApp.js';
import { httpLog } from '../_helpers/httpLog.js';

let app, db, seedData, token;

beforeAll(async () => {
  httpLog.clear();
  db = getTestDb();
  seedData = loadSeedData();
  app = await makeApp();
  
  // Login sellerA
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ username: 'sellerA', password: 'password123' });
  token = loginRes.body.token;
});

describe('SELLER BOATS & SLOTS', () => {
  it('GET /api/selling/boats - list boats', async () => {
    const start = Date.now();
    const res = await request(app)
      .get('/api/selling/boats')
      .set('Authorization', `Bearer ${token}`);
    const duration = Date.now() - start;
    httpLog.log('GET', '/api/selling/boats', res.status, duration);
    
    console.log('[DEBUG] boats status:', res.status);
    console.log('[DEBUG] boats body:', JSON.stringify(res.body, null, 2));
    
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('name');
    expect(res.body[0]).toHaveProperty('type');
  });
  
  it('GET /api/selling/boats/speed/slots - list speed boat slots', async () => {
    const start = Date.now();
    const res = await request(app)
      .get('/api/selling/boats/speed/slots')
      .set('Authorization', `Bearer ${token}`);
    const duration = Date.now() - start;
    httpLog.log('GET', '/api/selling/boats/speed/slots', res.status, duration);
    
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('slots');
    expect(Array.isArray(res.body.slots)).toBe(true);
    expect(res.body.slots.length).toBeGreaterThan(0);
  });
  
  it('GET /api/selling/boats/cruise/slots - list cruise boat slots', async () => {
    const start = Date.now();
    const res = await request(app)
      .get('/api/selling/boats/cruise/slots')
      .set('Authorization', `Bearer ${token}`);
    const duration = Date.now() - start;
    httpLog.log('GET', '/api/selling/boats/cruise/slots', res.status, duration);
    
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('slots');
    expect(Array.isArray(res.body.slots)).toBe(true);
    // Cruise may have 0 slots if no future generated slots exist
  });
});
