const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');

const db = new Database('./database.sqlite');

console.log('=== STEP 2: DB PATH ===');
const dbList = db.pragma('database_list');
console.log('PRAGMA database_list:', JSON.stringify(dbList, null, 2));

console.log('\n=== STEP 3: CHECK MARIA IN DB ===');
const maria = db.prepare(`select id, username, role, is_active, length(password_hash) as hash_len, substr(password_hash,1,12) as hash_prefix, password_hash from users where username='Maria'`).get();
console.log('Maria row:', maria ? JSON.stringify({...maria, password_hash: '[HIDDEN]'}, null, 2) : 'NOT FOUND');

if (!maria) {
  const all = db.prepare('select id, username, role, is_active from users').all();
  console.log('\nAll users in DB:');
  console.table(all);
} else {
  console.log('\n=== STEP 4: BCRYPT VERIFY ===');
  console.log('bcrypt library:', bcrypt !== undefined ? 'loaded' : 'NOT LOADED');
  console.log('bcrypt module path:', require.resolve('bcrypt'));
  
  const compare1234 = bcrypt.compareSync('1234', maria.password_hash);
  console.log("bcrypt.compareSync('1234', hash):", compare1234);
  
  const compareLowerCase = bcrypt.compareSync('maria', maria.password_hash);
  console.log("bcrypt.compareSync('maria', hash):", compareLowerCase);
}

db.close();
