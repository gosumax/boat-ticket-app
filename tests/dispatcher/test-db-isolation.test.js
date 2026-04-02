import path from 'path';
import { fileURLToPath } from 'url';
import { beforeAll, describe, expect, it } from 'vitest';
import { resetTestDb } from '../_helpers/dbReset.js';
import { makeApp } from '../_helpers/makeApp.js';

let getDatabaseFilePath;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..', '..');
const mainDbPath = path.join(repoRoot, 'database.sqlite');
const expectedTestDbPath = path.join(repoRoot, '_testdata', 'test.sqlite');

describe('test DB isolation', () => {
  beforeAll(async () => {
    resetTestDb();
    await makeApp();
    ({ getDatabaseFilePath } = await import('../../server/db.js'));
  });

  it('uses the dedicated test database instead of the main database.sqlite', () => {
    const actualDbPath = path.resolve(String(getDatabaseFilePath?.() || process.env.DB_FILE || ''));

    expect(actualDbPath).toBe(path.resolve(expectedTestDbPath));
    expect(actualDbPath).not.toBe(path.resolve(mainDbPath));
    expect(path.basename(actualDbPath)).toBe('test.sqlite');
  });
});
