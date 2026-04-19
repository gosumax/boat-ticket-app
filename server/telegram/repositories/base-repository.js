export class TelegramBaseRepository {
  constructor({
    db = null,
    entityName,
    tableName = null,
    idColumn = null,
    writableColumns = [],
    jsonColumns = [],
  }) {
    this.db = db;
    this.entityName = entityName;
    this.tableName = tableName;
    this.idColumn = idColumn;
    this.writableColumns = writableColumns;
    this.jsonColumns = jsonColumns;
  }

  describe() {
    return Object.freeze({
      entityName: this.entityName,
      status: this.tableName ? 'persistence_ready' : 'skeleton_only',
      persistence: this.db && this.tableName ? 'wired' : 'not_wired',
      tableName: this.tableName,
      idColumn: this.idColumn,
    });
  }

  assertReady() {
    if (!this.db || !this.tableName || !this.idColumn) {
      throw new Error(`[TELEGRAM_REPOSITORY] ${this.entityName} repository is not wired yet`);
    }
  }

  deserializeRow(row) {
    if (!row) return null;
    const next = { ...row };
    for (const column of this.jsonColumns) {
      if (typeof next[column] === 'string') {
        try {
          next[column] = JSON.parse(next[column]);
        } catch {
          // keep stored string if legacy/manual data is not valid JSON
        }
      }
    }
    return next;
  }

  serializeRecord(input = {}) {
    const record = {};
    for (const column of this.writableColumns) {
      if (input[column] === undefined) continue;
      if (this.jsonColumns.includes(column) && input[column] !== null && typeof input[column] !== 'string') {
        record[column] = JSON.stringify(input[column]);
      } else {
        record[column] = input[column];
      }
    }
    return record;
  }

  getById(id) {
    this.assertReady();
    const row = this.db
      .prepare(`SELECT * FROM ${this.tableName} WHERE ${this.idColumn} = ?`)
      .get(id);
    return this.deserializeRow(row);
  }

  findOneBy(where = {}, options = {}) {
    this.assertReady();
    const { orderBy = `${this.idColumn} DESC` } = options;
    const entries = Object.entries(where);
    const whereSql = entries.length
      ? `WHERE ${entries.map(([column]) => `${column} = ?`).join(' AND ')}`
      : '';
    const row = this.db
      .prepare(`SELECT * FROM ${this.tableName} ${whereSql} ORDER BY ${orderBy} LIMIT 1`)
      .get(entries.map(([, value]) => value));
    return this.deserializeRow(row);
  }

  listBy(where = {}, options = {}) {
    this.assertReady();
    const { orderBy = `${this.idColumn} DESC`, limit = 50 } = options;
    const entries = Object.entries(where);
    const whereSql = entries.length
      ? `WHERE ${entries.map(([column]) => `${column} = ?`).join(' AND ')}`
      : '';
    const rows = this.db
      .prepare(`SELECT * FROM ${this.tableName} ${whereSql} ORDER BY ${orderBy} LIMIT ?`)
      .all(...entries.map(([, value]) => value), limit);
    return rows.map((row) => this.deserializeRow(row));
  }

  list(limit = 50) {
    const rowLimit = Number.isFinite(Number(limit)) ? Number(limit) : 50;
    return this.listBy({}, { limit: rowLimit });
  }

  create(input = {}) {
    this.assertReady();
    const record = this.serializeRecord(input);
    const columns = Object.keys(record);

    if (columns.length === 0) {
      throw new Error(`[TELEGRAM_REPOSITORY] ${this.entityName} create requires at least one writable field`);
    }

    const placeholders = columns.map(() => '?').join(', ');
    const statement = this.db.prepare(
      `INSERT INTO ${this.tableName} (${columns.join(', ')}) VALUES (${placeholders})`
    );
    const result = statement.run(columns.map((column) => record[column]));
    return this.getById(result.lastInsertRowid);
  }

  save(input = {}) {
    return this.create(input);
  }

  updateById(id, patch = {}) {
    this.assertReady();
    const record = this.serializeRecord(patch);
    const columns = Object.keys(record);

    if (columns.length === 0) {
      return this.getById(id);
    }

    const statement = this.db.prepare(
      `UPDATE ${this.tableName} SET ${columns.map((column) => `${column} = ?`).join(', ')} WHERE ${this.idColumn} = ?`
    );
    statement.run(...columns.map((column) => record[column]), id);
    return this.getById(id);
  }
}
