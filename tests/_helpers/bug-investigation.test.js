import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import bcrypt from 'bcrypt';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database is in project root
const DB_FILE = path.join(__dirname, '..', '..', 'database.sqlite');

// Check if DB file exists
const dbExists = fs.existsSync(DB_FILE);

// Replicate auth.js getBcrypt function
let _bcryptPromise = null;

async function getBcrypt() {
  if (_bcryptPromise) return _bcryptPromise;

  _bcryptPromise = import('bcrypt')
    .then((m) => m?.default ?? m)
    .catch(() => null)
    .then((mod) => {
      if (mod?.compare) return mod;
      return import('bcryptjs').then((m) => m?.default ?? m).catch(() => null);
    });

  return _bcryptPromise;
}

describe('Login Diagnostic: Maria', () => {
  it('should diagnose Maria login issue', async () => {
    console.log('\n=== LOGIN DIAGNOSTIC: MARIA ===');
    console.log('DB file:', DB_FILE);
    console.log('DB exists:', dbExists);
    
    if (!dbExists) {
      console.log('ERROR: DB file not found');
      expect(true).toBe(true);
      return;
    }
    
    const db = new Database(DB_FILE, { readonly: true });
    
    // STEP 2: DB PATH
    console.log('\n=== STEP 2: DB PATH ===');
    const dbList = db.pragma('database_list');
    console.log('PRAGMA database_list:', JSON.stringify(dbList, null, 2));
    
    // STEP 3: CHECK MARIA IN DB
    console.log('\n=== STEP 3: CHECK MARIA IN DB ===');
    const maria = db.prepare(`select id, username, role, is_active, length(password_hash) as hash_len, substr(password_hash,1,12) as hash_prefix, password_hash from users where username='Maria'`).get();
    console.log('Maria row:', maria ? JSON.stringify({...maria, password_hash: '[HIDDEN]', hash_prefix: maria.hash_prefix}, null, 2) : 'NOT FOUND');
    
    if (!maria) {
      const all = db.prepare('select id, username, role, is_active from users').all();
      console.log('\nAll users in DB:');
      all.forEach(u => console.log(`  id=${u.id}, username="${u.username}", role=${u.role}, is_active=${u.is_active}`));
      db.close();
      expect(true).toBe(true);
      return;
    }
    
    // STEP 4: BCRYPT VERIFY (static import)
    console.log('\n=== STEP 4: BCRYPT VERIFY (static import) ===');
    console.log('bcrypt module:', bcrypt ? 'loaded' : 'NOT LOADED');
    console.log('bcrypt.compare:', bcrypt?.compare ? 'available' : 'NOT AVAILABLE');
    console.log('bcrypt.compareSync:', bcrypt?.compareSync ? 'available' : 'NOT AVAILABLE');
    
    const compareSyncResult = bcrypt.compareSync('1234', maria.password_hash);
    console.log("bcrypt.compareSync('1234', hash):", compareSyncResult);
    
    // STEP 5: BCRYPT VERIFY (dynamic import - like auth.js)
    console.log('\n=== STEP 5: BCRYPT VERIFY (dynamic import - like auth.js) ===');
    const dynBcrypt = await getBcrypt();
    console.log('Dynamic bcrypt module:', dynBcrypt ? 'loaded' : 'NOT LOADED');
    console.log('Dynamic bcrypt.compare:', dynBcrypt?.compare ? 'available' : 'NOT AVAILABLE');
    
    if (dynBcrypt?.compare) {
      const dynCompareResult = await dynBcrypt.compare('1234', maria.password_hash);
      console.log("dynBcrypt.compare('1234', hash):", dynCompareResult);
    }
    
    // STEP 6: Check what import('bcrypt') actually returns
    console.log('\n=== STEP 6: CHECK import(\'bcrypt\') STRUCTURE ===');
    const bcryptModule = await import('bcrypt');
    console.log('import("bcrypt") keys:', Object.keys(bcryptModule));
    console.log('bcryptModule.default:', bcryptModule.default ? 'exists' : 'undefined');
    console.log('bcryptModule.compare:', bcryptModule.compare ? 'exists' : 'undefined');
    console.log('bcryptModule.hash:', bcryptModule.hash ? 'exists' : 'undefined');
    
    // The expression from auth.js: m?.default ?? m
    const resolvedModule = bcryptModule?.default ?? bcryptModule;
    console.log('Resolved module (m?.default ?? m):', resolvedModule ? 'exists' : 'undefined');
    console.log('Resolved module.compare:', resolvedModule?.compare ? 'available' : 'NOT AVAILABLE');
    
    if (resolvedModule?.compare) {
      const resolvedResult = await resolvedModule.compare('1234', maria.password_hash);
      console.log("resolvedModule.compare('1234', hash):", resolvedResult);
    }
    
    db.close();
    console.log('\n=== DIAGNOSTIC COMPLETE ===');
    expect(true).toBe(true);
  });
});


