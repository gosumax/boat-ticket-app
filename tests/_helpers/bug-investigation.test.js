import { describe, it, expect, beforeAll } from 'vitest';
import bcrypt from 'bcrypt';
import { resetTestDb, getTestDb } from './dbReset.js';
import { seedBasicData } from './seedBasic.js';

let db;

describe('Login diagnostic uses isolated test DB state', () => {
  beforeAll(async () => {
    resetTestDb();
    db = getTestDb();
    await seedBasicData(db);
  });

  it('verifies seeded credentials inside the test database only', () => {
    expect(String(process.env.DB_FILE || '')).not.toMatch(/database\.sqlite$/);

    const seller = db.prepare(`
      SELECT username, password_hash
      FROM users
      WHERE username = 'sellerA'
      LIMIT 1
    `).get();

    expect(seller).toBeDefined();
    expect(bcrypt.compareSync('password123', seller.password_hash)).toBe(true);
  });
});
