// Global test setup — runs ONCE before all tests
// CRITICAL: Set DB_FILE BEFORE any imports
process.env.DB_FILE = ':memory:';
process.env.NODE_ENV = 'test';

import { resetTestDb, getTestDb } from './_helpers/dbReset.js';
import { seedBasicData } from './_helpers/seedBasic.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async function globalSetup() {
  console.log('[GLOBAL SETUP] Initializing test database...');
  console.log('[GLOBAL SETUP] DB_FILE =', process.env.DB_FILE);
  
  resetTestDb();
  const db = getTestDb();
  const seedData = await seedBasicData(db);
  db.close();
  
  // Write seedData to temp file for tests to read
  const seedDataPath = path.join(__dirname, '..', '_testdata', 'seedData.json');
  fs.writeFileSync(seedDataPath, JSON.stringify(seedData, null, 2));
  
  console.log('[GLOBAL SETUP] Test database ready');
}
