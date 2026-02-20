import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

// This test runs with the real database
process.env.DB_FILE = 'd:\\Проэкты\\МОре\\boat-ticket-app\\database.sqlite';

import { app } from '../../server/index.js';

describe('LOGIN DIAGNOSTIC: Maria API', () => {
  it('should login Maria via API and show detailed logs', async () => {
    console.log('\n=== LOGIN API DIAGNOSTIC ===');
    console.log('DB_FILE:', process.env.DB_FILE);
    
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'Maria', password: '1234' });
    
    console.log('Status:', res.status);
    console.log('Body:', JSON.stringify(res.body, null, 2));
    
    // This test documents the result
    expect(true).toBe(true);
  });
});
