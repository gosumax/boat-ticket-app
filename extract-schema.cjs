const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const db = new Database('database.sqlite', { readonly: true });

// Extract schema objects in correct order: tables first, then indexes/triggers/views
const tables = db.prepare(`
  SELECT sql 
  FROM sqlite_master 
  WHERE sql IS NOT NULL 
    AND type = 'table'
    AND name NOT LIKE 'sqlite_%'
  ORDER BY name
`).all();

const indexes = db.prepare(`
  SELECT sql 
  FROM sqlite_master 
  WHERE sql IS NOT NULL 
    AND type IN ('index', 'trigger', 'view')
  ORDER BY type, name
`).all();

const schema = [
  ...tables.map(r => r.sql.trim()),
  '',
  ...indexes.map(r => r.sql.trim())
].join(';\n\n') + ';';

const outputPath = path.join(__dirname, 'tests', '_helpers', 'schema_prod.sql');
fs.writeFileSync(outputPath, schema, 'utf8');

console.log(`[SCHEMA EXTRACT] Written ${tables.length} tables + ${indexes.length} indexes/triggers/views to ${outputPath}`);
db.close();
