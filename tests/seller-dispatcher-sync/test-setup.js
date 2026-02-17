/**
 * Test setup for Seller-Dispatcher sync tests
 * Reuses dispatcher test setup logic with in-memory SQLite
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { beforeEach } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Set in-memory DB BEFORE any db.js import
process.env.DB_FILE = ':memory:';
process.env.NODE_ENV = 'test';

// Import helpers from dispatcher tests
import {
  initTestDb, 
  getSeedData,
  generateTestToken, 
  getDb, 
  closeDb
} from '../dispatcher/test-setup.js';

// Import table management functions
import { clearTables, seedTestData } from '../dispatcher/test-setup.js';

// Re-export all helpers for test files
export {
  initTestDb, 
  getSeedData,
  generateTestToken, 
  getDb, 
  closeDb,
  clearTables,
  seedTestData
};

// Global beforeEach for seller-dispatcher-sync tests
beforeEach(() => {
  console.log('[SYNC_TEST_BEFORE_EACH] Starting cleanup and seed...');
  clearTables();
  console.log('[SYNC_TEST_BEFORE_EACH] Clear completed, seeding...');
  const seeded = seedTestData();
  console.log('[SYNC_TEST_BEFORE_EACH] Seed completed with genSlotId1=', seeded.genSlotId1, 'genSlotId2=', seeded.genSlotId2);
  
  // Debug: check actual capacity in DB
  const db = getDb();
  const slot1 = db.prepare('SELECT id, capacity, seats_left FROM generated_slots WHERE id = ?').get(seeded.genSlotId1);
  const slot2 = db.prepare('SELECT id, capacity, seats_left FROM generated_slots WHERE id = ?').get(seeded.genSlotId2);
  console.log('[SYNC_TEST_DEBUG] After seed - genSlotId1:', slot1, 'genSlotId2:', slot2);
});
