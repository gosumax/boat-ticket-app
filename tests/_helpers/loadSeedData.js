// loadSeedData.js — Load seed data from global setup
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function loadSeedData() {
  const seedDbPathFile = path.join(__dirname, '..', '..', '_testdata', 'seedDbPath.txt');
  if (fs.existsSync(seedDbPathFile)) {
    const seedDbPath = String(fs.readFileSync(seedDbPathFile, 'utf8') || '').trim();
    if (seedDbPath) {
      process.env.TEST_DB_FILE = seedDbPath;
      process.env.DB_FILE = seedDbPath;
    }
  }

  const seedDataPath = path.join(__dirname, '..', '..', '_testdata', 'seedData.json');
  if (!fs.existsSync(seedDataPath)) {
    throw new Error('[TEST] seedData.json not found. Global setup may have failed.');
  }
  return JSON.parse(fs.readFileSync(seedDataPath, 'utf8'));
}
