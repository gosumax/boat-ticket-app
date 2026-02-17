import bcrypt from 'bcrypt';

/**
 * Ensures existing DBs can store role 'owner' in users.role CHECK constraint,
 * and seeds initial owner user if missing.
 *
 * Works by:
 * 1) Reading original CREATE TABLE SQL from sqlite_master
 * 2) If CHECK(role IN (...)) does not include 'owner', it recreates users table:
 *    - saves existing indexes/triggers SQL
 *    - ALTER TABLE users RENAME TO users_old
 *    - CREATE TABLE users ... (patched CHECK constraint to include 'owner')
 *    - INSERT rows back
 *    - DROP users_old
 *    - Recreate indexes/triggers
 *
 * Minimal, stable, and does not touch other tables.
 */
export function ensureOwnerRoleAndUser(db, { username = 'owner', password = 'owner123', saltRounds = 10 } = {}) {
  // Skip owner setup in test mode to avoid conflicts with test seed data
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  
  try {
    const usersTable = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'"
    ).get();
    const usersSql = usersTable?.sql || '';

    // If users table doesn't exist yet, just return (db.js will create it)
    if (!usersSql) return;

    const hasOwnerInConstraint = /'owner'/.test(usersSql);
    if (!hasOwnerInConstraint) {
      // Collect existing indexes and triggers for users
      const indexes = db.prepare(
        "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='users' AND sql IS NOT NULL"
      ).all();

      const triggers = db.prepare(
        "SELECT name, sql FROM sqlite_master WHERE type='trigger' AND tbl_name='users' AND sql IS NOT NULL"
      ).all();

      // Patch CHECK(role IN (...)) to include 'owner'
      const patchedUsersSql = usersSql.replace(
        /CHECK\s*\(\s*role\s+IN\s*\(([^)]*)\)\s*\)/i,
        (match, inside) => {
          const normalized = String(inside || '').trim();
          if (/'owner'/.test(normalized)) return match;
          const next = normalized.length ? `${normalized}, 'owner'` : `'owner'`;
          return `CHECK(role IN (${next}))`;
        }
      );

      // If we couldn't patch (no CHECK), keep original SQL and do NOT migrate
      if (patchedUsersSql === usersSql) {
        console.warn("[OWNER_SETUP] users.role CHECK constraint not found; skipping constraint migration.");
      } else {
        db.prepare('BEGIN').run();
        try {
          db.prepare('ALTER TABLE users RENAME TO users_old').run();
          db.prepare(patchedUsersSql).run();

          const cols = db.prepare("PRAGMA table_info(users_old)").all().map(r => r.name);
          if (cols.length === 0) throw new Error('users_old has no columns; aborting migration.');

          const colList = cols.map(c => `"${c}"`).join(', ');
          db.prepare(`INSERT INTO users (${colList}) SELECT ${colList} FROM users_old`).run();

          db.prepare('DROP TABLE users_old').run();

          for (const idx of indexes) if (idx?.sql) db.prepare(idx.sql).run();
          for (const trg of triggers) if (trg?.sql) db.prepare(trg.sql).run();

          db.prepare('COMMIT').run();
          console.log("[OWNER_SETUP] Migrated users.role CHECK constraint to include 'owner'.");
        } catch (e) {
          db.prepare('ROLLBACK').run();
          console.error("[OWNER_SETUP] users table migration failed:", e?.message);
          console.error(e?.stack);
        }
      }
    }

    const ownerUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (!ownerUser) {
      const hashedPassword = bcrypt.hashSync(password, saltRounds);
      const stmt = db.prepare(`
        INSERT INTO users (username, password_hash, role, is_active)
        VALUES (?, ?, ?, ?)
      `);
      stmt.run(username, hashedPassword, 'owner', 1);
      console.log('[OWNER_SETUP] Initial owner user created:');
      console.log(`Username: ${username}`);
      console.log(`Password: ${password}`);
      console.log('Please change this password immediately!');
    }
  } catch (e) {
    console.error('[OWNER_SETUP] Failed:', e?.message);
    console.error(e?.stack);
  }
}
