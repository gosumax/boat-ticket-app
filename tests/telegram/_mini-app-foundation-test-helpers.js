import {
  createLifecycleTestContext,
  createSellerRouteDecision,
} from './_booking-request-lifecycle-helpers.js';

export const MINI_APP_FUTURE_DATE = '2036-04-11';
export const MINI_APP_FUTURE_DATE_ALT = '2036-04-12';

export function ensureMiniAppCanonicalTripTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS boats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      type TEXT,
      price_adult REAL NOT NULL DEFAULT 0,
      price_teen REAL NULL,
      price_child REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS boat_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      boat_id INTEGER NOT NULL REFERENCES boats(id),
      time TEXT NOT NULL,
      price INTEGER NULL,
      capacity INTEGER NOT NULL,
      seats_left INTEGER NOT NULL,
      duration_minutes INTEGER NULL,
      trip_date TEXT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      price_adult INTEGER NULL,
      price_child INTEGER NULL,
      price_teen INTEGER NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS schedule_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      weekday INTEGER NOT NULL,
      time TEXT NOT NULL,
      product_type TEXT NOT NULL,
      boat_id INTEGER REFERENCES boats(id),
      boat_type TEXT,
      capacity INTEGER NOT NULL,
      price_adult INTEGER NOT NULL,
      price_child INTEGER NOT NULL,
      price_teen INTEGER,
      duration_minutes INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS schedule_template_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_template_id INTEGER REFERENCES schedule_templates(id),
      name TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS generated_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_template_id INTEGER NOT NULL REFERENCES schedule_templates(id),
      trip_date TEXT NOT NULL,
      boat_id INTEGER NOT NULL REFERENCES boats(id),
      time TEXT NOT NULL,
      capacity INTEGER NOT NULL,
      seats_left INTEGER NOT NULL,
      duration_minutes INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      price_adult INTEGER NULL,
      price_child INTEGER NULL,
      price_teen INTEGER NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export function seedMiniAppCanonicalTripData(db) {
  ensureMiniAppCanonicalTripTables(db);
  db.exec(`
    DELETE FROM schedule_template_items;
    DELETE FROM generated_slots;
    DELETE FROM boat_slots;
    DELETE FROM schedule_templates;
    DELETE FROM boats;
  `);

  db.prepare(
    `
      INSERT INTO boats (id, name, is_active, type, price_adult, price_teen, price_child)
      VALUES
        (1, 'Sea Breeze', 1, 'speed', 1800, 1600, 1200),
        (2, 'Calm Wave', 1, 'cruise', 2200, 2000, 1500),
        (3, 'Inactive Boat', 0, 'speed', 1700, 1500, 1100)
    `
  ).run();

  db.prepare(
    `
      INSERT INTO schedule_templates (
        id, weekday, time, product_type, boat_id, boat_type,
        capacity, price_adult, price_child, price_teen, duration_minutes, is_active
      )
      VALUES
        (1, 5, '10:00', 'speed', 1, 'speed', 12, 1500, 1000, 1200, 60, 1),
        (2, 5, '14:00', 'cruise', 2, 'cruise', 12, 2100, 1500, 1800, 90, 1)
    `
  ).run();

  db.prepare(
    `
      INSERT INTO schedule_template_items (schedule_template_id, name, is_active)
      VALUES
        (1, 'Sunrise sprint route', 1),
        (2, 'Family cruise route', 1)
    `
  ).run();

  db.prepare(
    `
      INSERT INTO generated_slots (
        id, schedule_template_id, trip_date, boat_id, time, capacity, seats_left,
        duration_minutes, is_active, price_adult, price_child, price_teen, created_at, updated_at
      )
      VALUES
        (41, 1, ?, 1, '10:00', 12, 12, 60, 1, 1500, 1000, 1200, '2036-04-01T08:00:00.000Z', '2036-04-01T08:00:00.000Z'),
        (42, 1, ?, 1, '12:00', 12, 2, 60, 1, 1500, 1000, 1200, '2036-04-01T09:00:00.000Z', '2036-04-02T09:00:00.000Z'),
        (43, 2, ?, 2, '14:00', 12, 0, 90, 1, 2100, 1500, 1800, '2036-04-01T10:00:00.000Z', '2036-04-01T10:00:00.000Z'),
        (44, 2, ?, 2, '13:00', 12, 5, 90, 1, 2100, 1500, 1800, '2036-04-01T11:00:00.000Z', '2036-04-01T11:00:00.000Z')
    `
  ).run(
    MINI_APP_FUTURE_DATE,
    MINI_APP_FUTURE_DATE,
    MINI_APP_FUTURE_DATE,
    MINI_APP_FUTURE_DATE_ALT
  );

  db.prepare(
    `
      INSERT INTO boat_slots (
        id, boat_id, time, price, capacity, seats_left, duration_minutes, trip_date, is_active,
        price_adult, price_child, price_teen, created_at, updated_at
      )
      VALUES
        (51, 1, '16:00', 1800, 10, 4, 75, ?, 1, 1800, 1200, 1500, '2036-04-03T08:00:00.000Z', '2036-04-03T08:00:00.000Z'),
        (52, 1, '18:00', 1800, 10, 0, 75, ?, 1, 1800, 1200, 1500, '2036-04-03T09:00:00.000Z', '2036-04-03T09:00:00.000Z'),
        (60, 1, '20:00', 1800, 10, 8, 75, NULL, 1, 1800, 1200, 1500, '2036-04-03T10:00:00.000Z', '2036-04-03T10:00:00.000Z')
    `
  ).run(MINI_APP_FUTURE_DATE, MINI_APP_FUTURE_DATE);
}

export function createMiniAppFoundationContext() {
  const lifecycle = createLifecycleTestContext({
    creationNow: '2036-04-10T10:30:00.000Z',
    activationNow: '2036-04-10T10:31:00.000Z',
    extensionNow: '2036-04-10T10:35:00.000Z',
    expiryNow: '2036-04-10T10:47:00.000Z',
    cancelNow: '2036-04-10T10:40:00.000Z',
    confirmationNow: '2036-04-10T10:41:00.000Z',
  });
  seedMiniAppCanonicalTripData(lifecycle.db);
  const routingDecision = createSellerRouteDecision(lifecycle.context);

  return {
    ...lifecycle,
    routingDecision,
  };
}

