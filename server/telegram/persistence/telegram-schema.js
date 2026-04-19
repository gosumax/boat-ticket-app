const ensuredDatabases = new WeakSet();

function tryMarkSchemaVersion(db) {
  try {
    db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('telegram_schema_v1', 'true')"
    ).run();
  } catch {
    // settings table may be unavailable in isolated schema checks
  }
}

export function ensureTelegramSchema(db) {
  if (!db || ensuredDatabases.has(db)) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS telegram_guest_profiles (
      guest_profile_id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_user_id TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      username TEXT NULL,
      language_code TEXT NULL,
      phone_e164 TEXT NULL,
      consent_status TEXT NOT NULL,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      profile_status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS telegram_traffic_sources (
      traffic_source_id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_code TEXT NOT NULL UNIQUE,
      source_type TEXT NOT NULL,
      source_name TEXT NOT NULL,
      default_seller_id INTEGER NULL REFERENCES users(id),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS telegram_source_qr_codes (
      source_qr_code_id INTEGER PRIMARY KEY AUTOINCREMENT,
      qr_token TEXT NOT NULL UNIQUE,
      traffic_source_id INTEGER NOT NULL REFERENCES telegram_traffic_sources(traffic_source_id),
      seller_id INTEGER NULL REFERENCES users(id),
      entry_context TEXT NOT NULL DEFAULT '{}',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS telegram_seller_attribution_sessions (
      seller_attribution_session_id INTEGER PRIMARY KEY AUTOINCREMENT,
      guest_profile_id INTEGER NOT NULL REFERENCES telegram_guest_profiles(guest_profile_id),
      traffic_source_id INTEGER NOT NULL REFERENCES telegram_traffic_sources(traffic_source_id),
      source_qr_code_id INTEGER NOT NULL REFERENCES telegram_source_qr_codes(source_qr_code_id),
      seller_id INTEGER NULL REFERENCES users(id),
      starts_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attribution_status TEXT NOT NULL,
      binding_reason TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS telegram_seller_attribution_session_start_events (
      attribution_start_event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_binding_event_id INTEGER NOT NULL UNIQUE REFERENCES telegram_guest_entry_source_binding_events(source_binding_event_id),
      seller_attribution_session_id INTEGER NULL REFERENCES telegram_seller_attribution_sessions(seller_attribution_session_id),
      event_type TEXT NOT NULL,
      attribution_status TEXT NOT NULL,
      no_attribution_reason TEXT NULL,
      telegram_user_summary TEXT NOT NULL DEFAULT '{}',
      telegram_guest_summary TEXT NULL DEFAULT '{}',
      source_binding_reference TEXT NOT NULL DEFAULT '{}',
      attribution_session_reference TEXT NULL DEFAULT '{}',
      seller_attribution_active INTEGER NOT NULL DEFAULT 0,
      attribution_started_at_summary TEXT NULL DEFAULT '{}',
      attribution_expires_at_summary TEXT NULL DEFAULT '{}',
      event_payload TEXT NOT NULL DEFAULT '{}',
      idempotency_key TEXT NOT NULL UNIQUE,
      dedupe_key TEXT NOT NULL,
      event_signature TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS telegram_guest_entries (
      guest_entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
      guest_profile_id INTEGER NOT NULL REFERENCES telegram_guest_profiles(guest_profile_id),
      entry_at TEXT NOT NULL DEFAULT (datetime('now')),
      entry_channel TEXT NOT NULL,
      traffic_source_id INTEGER NOT NULL REFERENCES telegram_traffic_sources(traffic_source_id),
      source_qr_code_id INTEGER NOT NULL REFERENCES telegram_source_qr_codes(source_qr_code_id),
      entry_payload TEXT NOT NULL DEFAULT '{}',
      entry_status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS telegram_guest_entry_events (
      guest_entry_event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_status TEXT NOT NULL,
      telegram_update_id INTEGER NOT NULL,
      telegram_message_id INTEGER NOT NULL,
      telegram_user_summary TEXT NOT NULL DEFAULT '{}',
      telegram_chat_summary TEXT NOT NULL DEFAULT '{}',
      normalized_start_payload TEXT NOT NULL DEFAULT '{}',
      source_token TEXT NULL,
      event_timestamp_summary TEXT NOT NULL DEFAULT '{}',
      entry_payload TEXT NOT NULL DEFAULT '{}',
      idempotency_key TEXT NOT NULL UNIQUE,
      dedupe_key TEXT NOT NULL,
      entry_signature TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS telegram_guest_entry_source_binding_events (
      source_binding_event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      guest_entry_event_id INTEGER NOT NULL UNIQUE REFERENCES telegram_guest_entry_events(guest_entry_event_id),
      event_type TEXT NOT NULL,
      binding_status TEXT NOT NULL,
      telegram_user_summary TEXT NOT NULL DEFAULT '{}',
      guest_entry_reference TEXT NOT NULL DEFAULT '{}',
      raw_source_token TEXT NULL,
      normalized_source_token TEXT NULL,
      resolved_source_family TEXT NULL,
      source_resolution_outcome TEXT NOT NULL,
      source_resolution_summary TEXT NOT NULL DEFAULT '{}',
      event_at TEXT NOT NULL,
      event_timestamp_summary TEXT NOT NULL DEFAULT '{}',
      binding_payload TEXT NOT NULL DEFAULT '{}',
      idempotency_key TEXT NOT NULL UNIQUE,
      dedupe_key TEXT NOT NULL,
      binding_signature TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS telegram_booking_requests (
      booking_request_id INTEGER PRIMARY KEY AUTOINCREMENT,
      guest_profile_id INTEGER NOT NULL REFERENCES telegram_guest_profiles(guest_profile_id),
      seller_attribution_session_id INTEGER NOT NULL REFERENCES telegram_seller_attribution_sessions(seller_attribution_session_id),
      requested_trip_date TEXT NOT NULL,
      requested_time_slot TEXT NOT NULL,
      requested_seats INTEGER NOT NULL CHECK (requested_seats > 0),
      requested_ticket_mix TEXT NOT NULL DEFAULT '{}',
      contact_phone_e164 TEXT NOT NULL,
      request_status TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_status_at TEXT NOT NULL DEFAULT (datetime('now')),
      confirmed_presale_id INTEGER NULL REFERENCES presales(id)
    );

    CREATE TABLE IF NOT EXISTS telegram_booking_holds (
      booking_hold_id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_request_id INTEGER NOT NULL UNIQUE REFERENCES telegram_booking_requests(booking_request_id),
      hold_scope TEXT NOT NULL,
      hold_expires_at TEXT NOT NULL,
      hold_status TEXT NOT NULL,
      requested_amount INTEGER NOT NULL DEFAULT 0 CHECK (requested_amount >= 0),
      currency TEXT NOT NULL,
      started_at TEXT NOT NULL,
      last_extended_at TEXT NULL
    );

    CREATE TABLE IF NOT EXISTS telegram_booking_request_events (
      booking_request_event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_request_id INTEGER NOT NULL REFERENCES telegram_booking_requests(booking_request_id),
      booking_hold_id INTEGER NULL REFERENCES telegram_booking_holds(booking_hold_id),
      seller_attribution_session_id INTEGER NULL REFERENCES telegram_seller_attribution_sessions(seller_attribution_session_id),
      event_type TEXT NOT NULL,
      event_at TEXT NOT NULL DEFAULT (datetime('now')),
      actor_type TEXT NOT NULL,
      actor_id TEXT NULL,
      event_payload TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS telegram_content_blocks (
      telegram_content_block_id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_key TEXT NOT NULL,
      content_type TEXT NOT NULL,
      channel_type TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      locale TEXT NOT NULL,
      body_template TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      UNIQUE(content_key, channel_type, locale, version)
    );

    CREATE TABLE IF NOT EXISTS telegram_managed_content_items (
      telegram_managed_content_item_id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_reference TEXT NOT NULL,
      content_group TEXT NOT NULL,
      content_type TEXT NOT NULL,
      title_summary TEXT NOT NULL,
      short_text_summary TEXT NOT NULL,
      visibility_action_summary TEXT NOT NULL DEFAULT '{}',
      is_enabled INTEGER NOT NULL DEFAULT 1,
      content_version INTEGER NOT NULL,
      is_latest_version INTEGER NOT NULL DEFAULT 1,
      versioned_from_item_id INTEGER NULL REFERENCES telegram_managed_content_items(telegram_managed_content_item_id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(content_reference, content_version)
    );

    CREATE TABLE IF NOT EXISTS telegram_source_registry_items (
      source_registry_item_id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_reference TEXT NOT NULL UNIQUE,
      source_family TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_token TEXT NOT NULL UNIQUE,
      seller_id INTEGER NULL,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      is_exportable INTEGER NOT NULL DEFAULT 1,
      source_payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS telegram_analytics_capture_events (
      analytics_capture_event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      analytics_event_type TEXT NOT NULL,
      event_at TEXT NOT NULL DEFAULT (datetime('now')),
      guest_profile_id INTEGER NULL REFERENCES telegram_guest_profiles(guest_profile_id),
      booking_request_id INTEGER NULL REFERENCES telegram_booking_requests(booking_request_id),
      source_reference_type TEXT NULL,
      source_reference_id TEXT NULL,
      source_reference_token TEXT NULL,
      event_payload TEXT NOT NULL DEFAULT '{}',
      idempotency_key TEXT NOT NULL UNIQUE,
      dedupe_key TEXT NOT NULL,
      event_signature TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS telegram_notifications (
      telegram_notification_id INTEGER PRIMARY KEY AUTOINCREMENT,
      guest_profile_id INTEGER NOT NULL REFERENCES telegram_guest_profiles(guest_profile_id),
      booking_request_id INTEGER NULL REFERENCES telegram_booking_requests(booking_request_id),
      notification_type TEXT NOT NULL,
      content_block_id INTEGER NOT NULL REFERENCES telegram_content_blocks(telegram_content_block_id),
      send_status TEXT NOT NULL,
      scheduled_for TEXT NULL,
      sent_at TEXT NULL,
      delivery_provider TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS telegram_analytics_events (
      analytics_event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      event_at TEXT NOT NULL DEFAULT (datetime('now')),
      guest_profile_id INTEGER NULL REFERENCES telegram_guest_profiles(guest_profile_id),
      traffic_source_id INTEGER NULL REFERENCES telegram_traffic_sources(traffic_source_id),
      booking_request_id INTEGER NULL REFERENCES telegram_booking_requests(booking_request_id),
      notification_id INTEGER NULL REFERENCES telegram_notifications(telegram_notification_id),
      event_value TEXT NULL,
      event_payload TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS telegram_post_trip_messages (
      post_trip_message_id INTEGER PRIMARY KEY AUTOINCREMENT,
      guest_profile_id INTEGER NOT NULL REFERENCES telegram_guest_profiles(guest_profile_id),
      booking_request_id INTEGER NULL REFERENCES telegram_booking_requests(booking_request_id),
      content_block_id INTEGER NOT NULL REFERENCES telegram_content_blocks(telegram_content_block_id),
      message_type TEXT NOT NULL,
      scheduled_for TEXT NULL,
      sent_at TEXT NULL,
      message_status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS telegram_post_trip_offers (
      post_trip_offer_id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_trip_message_id INTEGER NOT NULL UNIQUE REFERENCES telegram_post_trip_messages(post_trip_message_id),
      offer_type TEXT NOT NULL,
      offer_code TEXT NOT NULL UNIQUE,
      offer_status TEXT NOT NULL,
      valid_from TEXT NOT NULL,
      valid_until TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS telegram_review_submissions (
      review_submission_id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_request_id INTEGER NOT NULL UNIQUE REFERENCES telegram_booking_requests(booking_request_id),
      guest_profile_id INTEGER NOT NULL REFERENCES telegram_guest_profiles(guest_profile_id),
      telegram_user_id TEXT NOT NULL,
      rating_value INTEGER NOT NULL CHECK (rating_value >= 1 AND rating_value <= 5),
      comment_text TEXT NOT NULL,
      submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
      idempotency_key TEXT NULL UNIQUE,
      dedupe_key TEXT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_tg_guest_profiles_phone
      ON telegram_guest_profiles(phone_e164);
    CREATE INDEX IF NOT EXISTS idx_tg_source_qr_codes_source
      ON telegram_source_qr_codes(traffic_source_id);
    CREATE INDEX IF NOT EXISTS idx_tg_attribution_guest_status
      ON telegram_seller_attribution_sessions(guest_profile_id, attribution_status, expires_at);
    CREATE INDEX IF NOT EXISTS idx_tg_attribution_start_events_source_binding
      ON telegram_seller_attribution_session_start_events(source_binding_event_id);
    CREATE INDEX IF NOT EXISTS idx_tg_attribution_start_events_dedupe
      ON telegram_seller_attribution_session_start_events(dedupe_key);
    CREATE INDEX IF NOT EXISTS idx_tg_guest_entries_guest_time
      ON telegram_guest_entries(guest_profile_id, entry_at);
    CREATE INDEX IF NOT EXISTS idx_tg_guest_entry_events_update_message
      ON telegram_guest_entry_events(telegram_update_id, telegram_message_id);
    CREATE INDEX IF NOT EXISTS idx_tg_guest_entry_events_dedupe
      ON telegram_guest_entry_events(dedupe_key);
    CREATE INDEX IF NOT EXISTS idx_tg_source_binding_events_guest_entry
      ON telegram_guest_entry_source_binding_events(guest_entry_event_id);
    CREATE INDEX IF NOT EXISTS idx_tg_source_binding_events_dedupe
      ON telegram_guest_entry_source_binding_events(dedupe_key);
    CREATE INDEX IF NOT EXISTS idx_tg_booking_requests_guest_status
      ON telegram_booking_requests(guest_profile_id, request_status, created_at);
    CREATE INDEX IF NOT EXISTS idx_tg_booking_requests_presale
      ON telegram_booking_requests(confirmed_presale_id);
    CREATE INDEX IF NOT EXISTS idx_tg_booking_holds_status_expiry
      ON telegram_booking_holds(hold_status, hold_expires_at);
    CREATE INDEX IF NOT EXISTS idx_tg_booking_events_request_time
      ON telegram_booking_request_events(booking_request_id, event_at);
    CREATE INDEX IF NOT EXISTS idx_tg_managed_content_group_enabled
      ON telegram_managed_content_items(content_group, is_enabled, is_latest_version);
    CREATE INDEX IF NOT EXISTS idx_tg_managed_content_reference_version
      ON telegram_managed_content_items(content_reference, content_version DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tg_managed_content_latest_reference
      ON telegram_managed_content_items(content_reference)
      WHERE is_latest_version = 1;
    CREATE INDEX IF NOT EXISTS idx_tg_source_registry_family_enabled
      ON telegram_source_registry_items(source_family, is_enabled);
    CREATE INDEX IF NOT EXISTS idx_tg_source_registry_token
      ON telegram_source_registry_items(source_token);
    CREATE INDEX IF NOT EXISTS idx_tg_analytics_capture_guest_time
      ON telegram_analytics_capture_events(guest_profile_id, event_at);
    CREATE INDEX IF NOT EXISTS idx_tg_analytics_capture_source_time
      ON telegram_analytics_capture_events(source_reference_type, source_reference_id, event_at);
    CREATE INDEX IF NOT EXISTS idx_tg_analytics_capture_request_time
      ON telegram_analytics_capture_events(booking_request_id, event_at);
    CREATE INDEX IF NOT EXISTS idx_tg_analytics_capture_event_type_time
      ON telegram_analytics_capture_events(analytics_event_type, event_at);
    CREATE INDEX IF NOT EXISTS idx_tg_analytics_capture_dedupe
      ON telegram_analytics_capture_events(dedupe_key);
    CREATE INDEX IF NOT EXISTS idx_tg_notifications_guest_status
      ON telegram_notifications(guest_profile_id, send_status, scheduled_for);
    CREATE INDEX IF NOT EXISTS idx_tg_notifications_request_type
      ON telegram_notifications(booking_request_id, notification_type);
    CREATE INDEX IF NOT EXISTS idx_tg_analytics_event_type_time
      ON telegram_analytics_events(event_type, event_at);
    CREATE INDEX IF NOT EXISTS idx_tg_post_trip_messages_guest_status
      ON telegram_post_trip_messages(guest_profile_id, message_status, scheduled_for);
    CREATE INDEX IF NOT EXISTS idx_tg_review_submissions_guest_submitted
      ON telegram_review_submissions(guest_profile_id, submitted_at);
    CREATE INDEX IF NOT EXISTS idx_tg_review_submissions_telegram_user
      ON telegram_review_submissions(telegram_user_id);
  `);

  tryMarkSchemaVersion(db);
  ensuredDatabases.add(db);
}
