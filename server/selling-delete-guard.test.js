import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import makeApp from '../tests/_helpers/makeApp.js';
import loadSeedData from '../tests/_helpers/loadSeedData.js';
import dbReset from '../tests/_helpers/dbReset.js';

// Import routes and auth
import sellingRoutes from './selling.mjs';
import authRoutes, { authenticateToken } from './auth.js';

const app = makeApp();

// Setup routes
app.use('/api/auth', authRoutes);
app.use('/api/selling', sellingRoutes);

// Test tokens
let ownerToken, dispatcherToken, sellerToken;

describe('DELETE /api/selling/presales/:id/delete - SHIFT_CLOSED guard', () => {
  beforeAll(async () => {
    // Reset DB and seed
    await dbReset();
    const seed = await loadSeedData();
    
    // Get tokens
    const ownerLogin = await request(app).post('/api/auth/login').send({ username: 'owner', password: 'owner123' });
    ownerToken = ownerLogin.body.token;
    
    const dispatcherLogin = await request(app).post('/api/auth/login').send({ username: 'dispatcher1', password: 'password123' });
    dispatcherToken = dispatcherLogin.body.token;
    
    const sellerLogin = await request(app).post('/api/auth/login').send({ username: 'maxim', password: 'password123' });
    sellerToken = sellerLogin.body.token;
  });
  
  beforeEach(async () => {
    // Clean shift_closures before each test
    const db = (await import('./db.js')).default;
    db.prepare(`DELETE FROM shift_closures`).run();
  });
  
  it('should return 409 SHIFT_CLOSED when trying to delete presale from closed day', async () => {
    const db = (await import('./db.js')).default;
    
    // Find a presale with payments
    const presale = db.prepare(`
      SELECT p.id, p.business_day
      FROM presales p
      JOIN money_ledger ml ON ml.presale_id = p.id
      WHERE p.status = 'ACTIVE' AND ml.status = 'POSTED'
      LIMIT 1
    `).get();
    
    if (!presale) {
      console.log('No presale with payments found, skipping test');
      return;
    }
    
    // Close the shift for this business_day
    db.prepare(`INSERT INTO shift_closures (business_day, closed_at, closed_by, snapshot) VALUES (?, datetime('now'), 1, '{}')`).run(presale.business_day);
    
    // Try to delete - should fail with 409
    const res = await request(app)
      .patch(`/api/selling/presales/${presale.id}/delete`)
      .set('Authorization', `Bearer ${ownerToken}`);
    
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      ok: false,
      code: 'SHIFT_CLOSED'
    });
    expect(res.body.message).toContain('закрыта');
  });
  
  it('should allow delete when shift is NOT closed', async () => {
    const db = (await import('./db.js')).default;
    
    // Find an ACTIVE presale with payments
    const presale = db.prepare(`
      SELECT p.id, p.business_day, p.status
      FROM presales p
      JOIN money_ledger ml ON ml.presale_id = p.id
      WHERE p.status = 'ACTIVE' AND ml.status = 'POSTED'
      LIMIT 1
    `).get();
    
    if (!presale) {
      console.log('No presale with payments found, skipping test');
      return;
    }
    
    // Ensure shift is NOT closed for this day
    db.prepare(`DELETE FROM shift_closures WHERE business_day = ?`).run(presale.business_day);
    
    // Delete should succeed
    const res = await request(app)
      .patch(`/api/selling/presales/${presale.id}/delete`)
      .set('Authorization', `Bearer ${ownerToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      status: 'CANCELLED'
    });
  });
});
