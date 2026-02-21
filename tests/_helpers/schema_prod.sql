-- Base tables (no FK dependencies)
CREATE TABLE boats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1
    , type TEXT, price_adult REAL NOT NULL DEFAULT 0, price_teen REAL NULL, price_child REAL NOT NULL DEFAULT 0);

CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('seller', 'dispatcher', 'admin', 'owner')),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

-- Tables with FK to boats/users
CREATE TABLE boat_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      boat_id INTEGER NOT NULL UNIQUE REFERENCES boats(id) ON DELETE CASCADE,
      seller_cutoff_minutes INTEGER NOT NULL DEFAULT 10,
      dispatcher_cutoff_minutes INTEGER NOT NULL DEFAULT 0
    );

CREATE TABLE boat_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      boat_id INTEGER NOT NULL REFERENCES boats(id),
      time TEXT NOT NULL,
      price INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1, seats_left INTEGER NOT NULL DEFAULT 12, capacity INTEGER NOT NULL DEFAULT 12, duration_minutes INTEGER NULL, price_adult INTEGER NULL, price_child INTEGER NULL, price_teen INTEGER NULL, seller_cutoff_minutes INTEGER NULL, locked INTEGER DEFAULT 0, is_completed INTEGER DEFAULT 0, completed_at TEXT, status TEXT DEFAULT 'ACTIVE',
      UNIQUE(boat_id, time)
    );

CREATE TABLE schedule_template_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT,
          boat_id INTEGER REFERENCES boats(id),
          boat_type TEXT,
          type TEXT NOT NULL CHECK(type IN ('speed', 'cruise', 'banana')),
          departure_time TEXT NOT NULL,
          duration_minutes INTEGER NOT NULL,
          capacity INTEGER NOT NULL,
          price_adult INTEGER NOT NULL,
          price_child INTEGER NOT NULL,
          price_teen INTEGER,
          weekdays_mask INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          schedule_template_id INTEGER REFERENCES schedule_templates(id),
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

CREATE TABLE schedule_templates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          weekday INTEGER NOT NULL CHECK(weekday >= 1 AND weekday <= 7),
          time TEXT NOT NULL,
          product_type TEXT NOT NULL CHECK(product_type IN ('speed', 'cruise', 'banana')),
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

-- Tables with FK to schedule_template_items
CREATE TABLE "generated_slots" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_template_id INTEGER NOT NULL REFERENCES schedule_templates(id),
      trip_date TEXT NOT NULL CHECK(length(trip_date) = 10),
      boat_id INTEGER NOT NULL REFERENCES boats(id),
      time TEXT NOT NULL CHECK(length(time) = 5),
      capacity INTEGER NOT NULL CHECK(capacity > 0),
      seats_left INTEGER NOT NULL,
      duration_minutes INTEGER NOT NULL CHECK(duration_minutes > 0),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
      price_adult INTEGER NOT NULL CHECK(price_adult > 0),
      price_child INTEGER NOT NULL CHECK(price_child >= 0),
      price_teen INTEGER CHECK(price_teen >= 0),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    , seller_cutoff_minutes INTEGER NULL, dispatcher_cutoff_minutes INTEGER NULL, locked INTEGER DEFAULT 0, is_completed INTEGER DEFAULT 0, completed_at TEXT, status TEXT DEFAULT 'ACTIVE');

CREATE TABLE manual_batches (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date_from TEXT NOT NULL,
          date_to TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          locked INTEGER NOT NULL DEFAULT 0,
          locked_at TEXT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        , period TEXT NULL, created_by_user_id INTEGER NULL, updated_by_user_id INTEGER NULL, locked_by_user_id INTEGER NULL);

CREATE TABLE manual_boat_stats (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          period TEXT NOT NULL,
          boat_id INTEGER NULL,
          revenue REAL NOT NULL DEFAULT 0,
          trips_completed INTEGER NOT NULL DEFAULT 0,
          seats_sold INTEGER NOT NULL DEFAULT 0
        , business_day TEXT NULL, trips INTEGER NOT NULL DEFAULT 0, tickets INTEGER NOT NULL DEFAULT 0, capacity INTEGER NOT NULL DEFAULT 0);

CREATE TABLE manual_days (
          period TEXT PRIMARY KEY,
          locked INTEGER NOT NULL DEFAULT 0
        , locked_by_user_id INTEGER NULL, locked_at TEXT NULL, business_day TEXT NULL);

CREATE TABLE manual_seller_stats (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          period TEXT NOT NULL,
          seller_id INTEGER NULL,
          revenue REAL NOT NULL DEFAULT 0,
          seats_sold INTEGER NOT NULL DEFAULT 0
        , business_day TEXT NULL, trips INTEGER NOT NULL DEFAULT 0, tickets INTEGER NOT NULL DEFAULT 0);

CREATE TABLE money_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        presale_id INTEGER NULL,
        slot_id INTEGER NULL,
        trip_day TEXT NULL,
        business_day TEXT NULL,
        kind TEXT NOT NULL,
        type TEXT NOT NULL,
        method TEXT NULL,
        amount INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'POSTED',
        seller_id INTEGER NULL,
        event_time TEXT DEFAULT CURRENT_TIMESTAMP,
        decision_final TEXT NULL
      );

CREATE TABLE motivation_day_settings (
        business_day TEXT PRIMARY KEY,
        settings_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

CREATE TABLE seller_motivation_state (
        seller_id INTEGER PRIMARY KEY,
        calibrated INTEGER NOT NULL DEFAULT 0,
        calibration_worked_days INTEGER NOT NULL DEFAULT 0,
        calibration_revenue_sum INTEGER NOT NULL DEFAULT 0,
        current_level TEXT NOT NULL DEFAULT 'NONE',
        streak_days INTEGER NOT NULL DEFAULT 0,
        last_eval_day TEXT NULL,
        week_id TEXT NULL,
        week_worked_days INTEGER NOT NULL DEFAULT 0,
        week_revenue_sum INTEGER NOT NULL DEFAULT 0
      );

CREATE TABLE seller_season_stats (
        seller_id INTEGER NOT NULL,
        season_id TEXT NOT NULL,
        revenue_total INTEGER NOT NULL DEFAULT 0,
        points_total REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (seller_id, season_id)
      );

CREATE TABLE seller_day_stats (
        business_day TEXT NOT NULL,
        seller_id INTEGER NOT NULL,
        revenue_day INTEGER NOT NULL DEFAULT 0,
        points_day_total REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (business_day, seller_id)
      );

CREATE TABLE seller_season_applied_days (
        season_id TEXT NOT NULL,
        business_day TEXT NOT NULL,
        seller_id INTEGER NOT NULL,
        PRIMARY KEY (season_id, business_day, seller_id)
      );

CREATE TABLE owner_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      action TEXT NOT NULL,
      request_id TEXT,
      meta_json TEXT,
      ip TEXT
    );

CREATE TABLE owner_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      currency TEXT DEFAULT 'RUB',
      timezone TEXT DEFAULT 'Europe/Moscow',
      owner_name TEXT DEFAULT '',
      company_name TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      payout_target_rub INTEGER DEFAULT 0,
      motivation_mode TEXT DEFAULT 'v1',
      settings_json TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

CREATE TABLE presales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      boat_slot_id INTEGER NOT NULL REFERENCES boat_slots(id),
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      number_of_seats INTEGER NOT NULL,
      total_price INTEGER NOT NULL,
      prepayment_amount INTEGER NOT NULL DEFAULT 0,
      prepayment_comment TEXT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    , status TEXT NOT NULL DEFAULT 'ACTIVE', tickets_json TEXT NULL, slot_uid TEXT NULL, payment_method TEXT NULL, payment_cash_amount INTEGER NULL, payment_card_amount INTEGER NULL, seller_id INTEGER NULL);

CREATE TABLE sales_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_day TEXT NOT NULL,
      presale_id INTEGER NULL,
      slot_id INTEGER NULL,
      slot_uid TEXT NULL,
      slot_source TEXT NULL, -- generated_slots | manual
      amount INTEGER NOT NULL DEFAULT 0,
      qty INTEGER NOT NULL DEFAULT 0,
      method TEXT NULL, -- CASH | CARD
      status TEXT NOT NULL DEFAULT 'VALID',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    , ticket_id INTEGER NULL);

CREATE TABLE sales_transactions_canonical (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER UNIQUE,
        presale_id INTEGER NULL,
        slot_id INTEGER NULL,
        boat_id INTEGER NULL,
        slot_uid TEXT NULL,
        slot_source TEXT NULL,
        amount INTEGER NOT NULL DEFAULT 0,
        cash_amount INTEGER NOT NULL DEFAULT 0,
        card_amount INTEGER NOT NULL DEFAULT 0,
        method TEXT NULL,
        status TEXT NOT NULL DEFAULT 'VALID',
        business_day TEXT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

CREATE TABLE tickets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          presale_id INTEGER NOT NULL REFERENCES presales(id),
          boat_slot_id INTEGER NOT NULL REFERENCES boat_slots(id),
          ticket_code TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          price INTEGER NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        , payment_method TEXT NULL);

CREATE TABLE trip_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slot_id INTEGER,
      slot_source TEXT,
      event TEXT,
      detail TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

CREATE TABLE trip_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_type TEXT NOT NULL CHECK(product_type IN ('speed', 'cruise', 'banana')),
            time TEXT NOT NULL,
            duration_minutes INTEGER NOT NULL,
            capacity INTEGER NOT NULL,
            price_adult INTEGER NOT NULL,
            price_child INTEGER NOT NULL,
            price_teen INTEGER,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
          );

;

CREATE INDEX idx_canon_business_day ON sales_transactions_canonical(business_day);

CREATE INDEX idx_canon_presale_id ON sales_transactions_canonical(presale_id);

CREATE INDEX idx_canon_status ON sales_transactions_canonical(status);

CREATE UNIQUE INDEX idx_canon_ticket_id ON sales_transactions_canonical(ticket_id);

CREATE INDEX idx_generated_slots_active ON "generated_slots"(is_active);

CREATE INDEX idx_generated_slots_boat_date ON "generated_slots"(boat_id, trip_date);

CREATE INDEX idx_generated_slots_template ON "generated_slots"(schedule_template_id);

CREATE UNIQUE INDEX idx_generated_slots_unique ON generated_slots(trip_date, time, boat_id);

CREATE INDEX idx_manual_batches_period ON manual_batches(period);

CREATE INDEX idx_manual_batches_period_locked ON manual_batches(period, locked);

CREATE INDEX idx_manual_boat_stats_boat ON manual_boat_stats(boat_id);

CREATE INDEX idx_manual_boat_stats_business_day ON manual_boat_stats(business_day);

CREATE INDEX idx_manual_boat_stats_period ON manual_boat_stats(period);

CREATE INDEX idx_manual_seller_stats_business_day ON manual_seller_stats(business_day);

CREATE INDEX idx_manual_seller_stats_period ON manual_seller_stats(period);

CREATE INDEX idx_manual_seller_stats_seller ON manual_seller_stats(seller_id);

CREATE INDEX idx_money_ledger_business_day ON money_ledger(business_day);

CREATE INDEX idx_money_ledger_kind ON money_ledger(kind);

CREATE INDEX idx_money_ledger_presale_id ON money_ledger(presale_id);

CREATE INDEX idx_money_ledger_seller_id ON money_ledger(seller_id);

CREATE INDEX idx_money_ledger_status ON money_ledger(status);

CREATE INDEX idx_money_ledger_type ON money_ledger(type);

CREATE INDEX idx_owner_audit_action ON owner_audit_log(action);

CREATE INDEX idx_owner_audit_created_at ON owner_audit_log(created_at);

CREATE INDEX idx_presales_slot_uid ON presales(slot_uid);

CREATE UNIQUE INDEX idx_sales_transactions_ticket_id ON sales_transactions(ticket_id) WHERE ticket_id IS NOT NULL;

CREATE INDEX idx_sales_tx_business_day
    ON sales_transactions(business_day);

CREATE INDEX idx_sales_tx_day ON sales_transactions(business_day);

CREATE INDEX idx_sales_tx_day_status ON sales_transactions(business_day, status);

CREATE INDEX idx_sales_tx_status ON sales_transactions(status);

CREATE INDEX idx_sales_tx_ticket_id ON sales_transactions(ticket_id);

CREATE INDEX idx_tickets_created_at ON tickets(created_at);

CREATE INDEX idx_tickets_status ON tickets(status);

CREATE TRIGGER trg_TICKETS_TO_SALES_TRANSACTIONS
        AFTER INSERT ON tickets
        BEGIN
          INSERT OR IGNORE INTO sales_transactions (
            business_day,
            presale_id,
            slot_id,
            slot_uid,
            slot_source,
            amount,
            qty,
            method,
            status,
            ticket_id
          ) VALUES (
            DATE(NEW.created_at),
            NEW.presale_id,
            CASE WHEN instr((SELECT slot_uid FROM presales WHERE id = NEW.presale_id), ':') > 0 THEN CAST(substr((SELECT slot_uid FROM presales WHERE id = NEW.presale_id), instr((SELECT slot_uid FROM presales WHERE id = NEW.presale_id), ':') + 1) AS INTEGER) ELSE NULL END,
            (SELECT slot_uid FROM presales WHERE id = NEW.presale_id),
            CASE WHEN (SELECT slot_uid FROM presales WHERE id = NEW.presale_id) LIKE 'generated:%' THEN 'generated_slots' WHEN (SELECT slot_uid FROM presales WHERE id = NEW.presale_id) LIKE 'manual:%' THEN 'manual' ELSE NULL END,
            COALESCE(NEW.price,0),
            1,
            NEW.payment_method,
            CASE WHEN NEW.status IN ('ACTIVE','USED') THEN 'VALID' ELSE 'INVALID' END,
            NEW.id
          );
        END;

CREATE TRIGGER trg_TICKETS_TO_SALES_TRANSACTIONS_DELETE
      AFTER DELETE ON tickets
      BEGIN
        UPDATE sales_transactions
        SET status = 'INVALID'
        WHERE ticket_id = OLD.id;
      END;

CREATE TRIGGER trg_TICKETS_TO_SALES_TRANSACTIONS_UPDATE
        AFTER UPDATE ON tickets
        BEGIN
          UPDATE sales_transactions
          SET business_day = DATE(NEW.created_at),
              amount = COALESCE(NEW.price,0),
              method = NEW.payment_method,
              status = CASE WHEN NEW.status IN ('ACTIVE','USED') THEN 'VALID' ELSE 'INVALID' END
          WHERE ticket_id = NEW.id;
        END;

CREATE TRIGGER validate_generated_slots_insert 
    BEFORE INSERT ON generated_slots
    FOR EACH ROW 
    BEGIN
      SELECT CASE
        WHEN NEW.price_adult <= 0 THEN 
          RAISE(ABORT, 'price_adult must be greater than 0')
        WHEN NEW.capacity <= 0 THEN 
          RAISE(ABORT, 'capacity must be greater than 0')
        WHEN NEW.duration_minutes <= 0 THEN 
          RAISE(ABORT, 'duration_minutes must be greater than 0')
        WHEN length(NEW.trip_date) != 10 THEN 
          RAISE(ABORT, 'trip_date must be in YYYY-MM-DD format (10 chars)')
        WHEN length(NEW.time) != 5 THEN 
          RAISE(ABORT, 'time must be in HH:MM format (5 chars)')
        WHEN NEW.is_active NOT IN (0, 1) THEN 
          RAISE(ABORT, 'is_active must be 0 or 1')
        WHEN NEW.price_child < 0 THEN 
          RAISE(ABORT, 'price_child must be greater than or equal to 0')
        WHEN NEW.price_teen IS NOT NULL AND NEW.price_teen < 0 THEN 
          RAISE(ABORT, 'price_teen must be greater than or equal to 0')
      END;
    END;

-- Shift closures for dispatcher shift close snapshot
CREATE TABLE IF NOT EXISTS shift_closures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_day TEXT NOT NULL UNIQUE,
  closed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_by INTEGER NOT NULL,

  total_revenue INTEGER NOT NULL DEFAULT 0,
  collected_total INTEGER NOT NULL DEFAULT 0,
  collected_cash INTEGER NOT NULL DEFAULT 0,
  collected_card INTEGER NOT NULL DEFAULT 0,

  refund_total INTEGER NOT NULL DEFAULT 0,
  refund_cash INTEGER NOT NULL DEFAULT 0,
  refund_card INTEGER NOT NULL DEFAULT 0,

  net_total INTEGER NOT NULL DEFAULT 0,
  net_cash INTEGER NOT NULL DEFAULT 0,
  net_card INTEGER NOT NULL DEFAULT 0,

  deposit_cash INTEGER NOT NULL DEFAULT 0,
  deposit_card INTEGER NOT NULL DEFAULT 0,

  sellers_json TEXT NULL
);

CREATE TRIGGER validate_generated_slots_update 
    BEFORE UPDATE ON generated_slots
    FOR EACH ROW 
    BEGIN
      SELECT CASE
        WHEN NEW.price_adult <= 0 THEN 
          RAISE(ABORT, 'price_adult must be greater than 0')
        WHEN NEW.capacity <= 0 THEN 
          RAISE(ABORT, 'capacity must be greater than 0')
        WHEN NEW.duration_minutes <= 0 THEN 
          RAISE(ABORT, 'duration_minutes must be greater than 0')
        WHEN length(NEW.trip_date) != 10 THEN 
          RAISE(ABORT, 'trip_date must be in YYYY-MM-DD format (10 chars)')
        WHEN length(NEW.time) != 5 THEN 
          RAISE(ABORT, 'time must be in HH:MM format (5 chars)')
        WHEN NEW.is_active NOT IN (0, 1) THEN 
          RAISE(ABORT, 'is_active must be 0 or 1')
        WHEN NEW.price_child < 0 THEN 
          RAISE(ABORT, 'price_child must be greater than or equal to 0')
        WHEN NEW.price_teen IS NOT NULL AND NEW.price_teen < 0 THEN 
          RAISE(ABORT, 'price_teen must be greater than or equal to 0')
      END;
    END;