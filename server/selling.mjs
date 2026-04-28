import { Router } from 'express';
import db from './db.js';

const moneyLedgerColumns = (() => {
  try {
    return new Set(db.prepare(`PRAGMA table_info(money_ledger)`).all().map((row) => row.name));
  } catch {
    return new Set();
  }
})();
const moneyLedgerHasCashAmount = moneyLedgerColumns.has('cash_amount');
const moneyLedgerHasCardAmount = moneyLedgerColumns.has('card_amount');
const moneyLedgerHasDecidedByUserId = moneyLedgerColumns.has('decided_by_user_id');

// Seat-occupying ticket statuses (1 ticket = 1 seat)
const SEAT_STATUS_LIST = [
  'ACTIVE',
  'PAID',
  'UNPAID',
  'RESERVED',
  'PARTIALLY_PAID',
  'CONFIRMED',
  'USED',
];

const seatStatusSql = SEAT_STATUS_LIST.map(() => '?').join(',');

const stmtCountOccupiedByBoatSlot = db.prepare(`
  SELECT COUNT(*) AS cnt
  FROM tickets
  WHERE boat_slot_id = ?
    AND status IN (${seatStatusSql})
`);

const stmtGetBoatSlotCapacity = db.prepare(`
  SELECT capacity
  FROM boat_slots
  WHERE id = ?
`);

// For generated slots: count occupied seats from presales by slot_uid.
// We do NOT trust generated_slots.seats_left as source of truth because it is a cache that
// can drift if older code paths updated the wrong table.
const stmtCountOccupiedBySlotUidFromPresales = db.prepare(`
  SELECT COALESCE(SUM(number_of_seats),0) AS cnt
  FROM presales
  WHERE slot_uid = ?
    AND status IN (${seatStatusSql})
`);

function countOccupiedSeatsForSlotUid(slotUid) {
  return Number(stmtCountOccupiedBySlotUidFromPresales.get(String(slotUid || ''), ...SEAT_STATUS_LIST)?.cnt || 0);
}

function countOccupiedSeatsForBoatSlot(boatSlotId) {
  return Number(stmtCountOccupiedByBoatSlot.get(boatSlotId, ...SEAT_STATUS_LIST)?.cnt || 0);
}

function getCapacityForBoatSlot(boatSlotId) {
  return Number(stmtGetBoatSlotCapacity.get(boatSlotId)?.capacity || 0);
}

function assertCapacityOrThrow(boatSlotId, requestedSeats) {
  const cap = getCapacityForBoatSlot(boatSlotId);
  const occ = countOccupiedSeatsForBoatSlot(boatSlotId);
  if (requestedSeats > cap - occ) {
    const err = new Error('CAPACITY_EXCEEDED');
    err.details = { capacity: cap, occupied: occ, requested: requestedSeats, free: cap - occ, boatSlotId };
    throw err;
  }
}

// Capacity check that respects generated slots.
// IMPORTANT: For generated slots, boat_slots does NOT contain trip date (often time-only).
// Therefore, counting tickets by boat_slot_id can incorrectly aggregate seats across different dates.
// Source of truth for generated slots is generated_slots.seats_left/capacity.
function assertCapacityForSlotUidOrThrow(slotUid, boatSlotIdForFK, requestedSeats) {
  const seats = Number(requestedSeats || 0);
  if (!Number.isFinite(seats) || seats < 1) return;

  const s = String(slotUid || '');
  if (s.startsWith('generated:')) {
    const genId = Number(s.split(':')[1]);
    const row = db.prepare(`SELECT capacity, seats_left FROM generated_slots WHERE id = ?`).get(genId);
    const cap = Number(row?.capacity || 0);

    // Compute free seats from presales (source of truth), then sync cache in generated_slots.
    const occ = Math.max(0, countOccupiedSeatsForSlotUid(s));
    const left = Math.max(0, cap - occ);
    try {
      // keep cache consistent for UI and future checks
      db.prepare(`UPDATE generated_slots SET seats_left = ? WHERE id = ?`).run(left, genId);
    } catch {}

    if (seats > left) {
      const err = new Error('CAPACITY_EXCEEDED');
      err.details = { capacity: cap, occupied: occ, requested: seats, free: Math.max(0, left), boatSlotId: boatSlotIdForFK };
      throw err;
    }
    return;
  }

  // manual slot
  assertCapacityOrThrow(boatSlotIdForFK, seats);
}

function syncSeatsLeftCache(boatSlotId, capacityOverride = null) {
  const cap = Number.isFinite(capacityOverride) ? Number(capacityOverride) : getCapacityForBoatSlot(boatSlotId);
  const occ = countOccupiedSeatsForBoatSlot(boatSlotId);
  const left = Math.max(0, cap - occ);
  db.prepare(`UPDATE boat_slots SET seats_left = ? WHERE id = ?`).run(left, boatSlotId);
  return { capacity: cap, occupied: occ, seats_left: left };
}

// Helper: recalc pending (EXPECT_PAYMENT) for a presale after transfer
// This ensures unpaid tickets appear in correct day's "pending" block
function recalcPendingForTransfer(presaleId, slotUid, boatSlotId, totalPrice, prepaymentAmount) {
  try {
    const expectedAmount = Math.max(0, Number(totalPrice || 0) - Number(prepaymentAmount || 0));
    
    // Get trip day for the slot
    let tripDay = null;
    try {
      if (slotUid && typeof slotUid === 'string' && slotUid.startsWith('generated:')) {
        const genId = Number(String(slotUid).slice('generated:'.length));
        if (Number.isFinite(genId)) {
          const row = db.prepare('SELECT trip_date FROM generated_slots WHERE id = ?').get(genId);
          if (row?.trip_date) tripDay = row.trip_date;
        }
      }
    } catch (_) {}
    
    if (!tripDay && boatSlotId != null) {
      try {
        const row = db.prepare('SELECT trip_date FROM boat_slots WHERE id = ?').get(boatSlotId);
        if (row?.trip_date) tripDay = row.trip_date;
      } catch (_) {}
    }
    
    if (!tripDay) {
      tripDay = db.prepare(`SELECT date('now','localtime') AS d`).get()?.d || null;
    }
    
    // Delete old EXPECT_PAYMENT rows for this presale
    db.prepare(`DELETE FROM money_ledger WHERE presale_id = ? AND kind = 'EXPECT_PAYMENT'`).run(presaleId);
    
    // Insert new EXPECT_PAYMENT row if there's unpaid amount
    if (expectedAmount > 0) {
      db.prepare(`
        INSERT INTO money_ledger
        (presale_id, slot_id, trip_day, kind, method, amount, status, type)
        VALUES (?, ?, ?, 'EXPECT_PAYMENT', NULL, ?, 'POSTED', 'PENDING')
      `).run(presaleId, boatSlotId ?? null, tripDay, expectedAmount);
    }
    
    return { ok: true, tripDay, expectedAmount };
  } catch (e) {
    console.error('[recalcPendingForTransfer] Failed:', e);
    return { ok: false, error: e?.message };
  }
}
import { authenticateToken, canSell, canDispatchManageSlots } from './auth.js';
import { getDatabaseFilePath } from './db.js';
import { assertShiftOpen, SHIFT_CLOSED_CODE } from './shift-guard.mjs';
import { calcMotivationDay } from './motivation/engine.mjs';
import {
  getSellerDayRevenue,
  getSellerState,
  getStreakMultiplier,
  getStreakThreshold,
} from './seller-motivation-state.mjs';
import { resolveOwnerSettings } from './owner-settings.mjs';
import {
  buildOwnerSeasonMotivationReadModel,
  buildOwnerWeeklyMotivationReadModel,
} from './owner.mjs';
import { getIsoWeekIdForBusinessDay } from './utils/iso-week.mjs';
import {
  buildBuyerTicketCodeFromCanonicalPresaleId,
  parseBuyerTicketCodeToCanonicalPresaleId,
} from './ticketing/buyer-ticket-reference.mjs';

function getLocalBusinessDay() {
  return db.prepare(`SELECT DATE('now','localtime') AS d`).get()?.d || null;
}

function roundToKopecks(amount) {
  return Math.round(Number(amount || 0) * 100) / 100;
}

function toNonNegativeInt(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  const normalized = Math.trunc(numeric);
  return normalized < 0 ? fallback : normalized;
}

const SELLER_HANDOFF_TELEGRAM_DEFAULT_BOT_USERNAME = 'seawalk_bot';
const SELLER_HANDOFF_START_PAYLOAD_SEPARATOR = '__p';

function normalizeTelegramStartToken(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return null;
  }
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function resolveSellerHandoffTelegramBotUsername() {
  const envBotUsername = String(process.env.TELEGRAM_BOT_USERNAME ?? '').trim();
  if (/^[A-Za-z0-9_]{5,}$/.test(envBotUsername)) {
    return envBotUsername;
  }
  return SELLER_HANDOFF_TELEGRAM_DEFAULT_BOT_USERNAME;
}

function resolveSellerSourceTokenForHandoff(sellerId) {
  const normalizedSellerId = Number(sellerId);
  if (!Number.isInteger(normalizedSellerId) || normalizedSellerId <= 0) {
    return null;
  }

  try {
    const registryTableExists = db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'telegram_source_registry_items'"
      )
      .get();
    if (registryTableExists) {
      const registryRow = db
        .prepare(
          `
            SELECT source_token
            FROM telegram_source_registry_items
            WHERE seller_id = ?
              AND is_enabled = 1
            ORDER BY source_registry_item_id ASC
            LIMIT 1
          `
        )
        .get(normalizedSellerId);
      const tokenFromRegistry = normalizeTelegramStartToken(registryRow?.source_token);
      if (tokenFromRegistry) {
        return tokenFromRegistry;
      }
    }
  } catch {
    // Best-effort handoff source lookup: fall through to deterministic seller token.
  }

  return normalizeTelegramStartToken(`seller-direct-link-${normalizedSellerId}`);
}

function parsePositiveIntegerOrNull(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function normalizeDispatcherLookupToken(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return '';
  }
  return normalized.toUpperCase().replace(/\s+/g, ' ');
}

function normalizeDispatcherLookupCompact(value) {
  return normalizeDispatcherLookupToken(value).replace(/[^0-9A-ZА-ЯЁ]/g, '');
}

const DISPATCHER_PUBLIC_TICKET_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DISPATCHER_PUBLIC_TICKET_NUMERIC_SPACE = 99;

function buildDispatcherPublicTicketCodeFromPresaleId(presaleId) {
  const normalized = Number(presaleId);
  if (!Number.isInteger(normalized) || normalized <= 0) return null;

  const zeroBased = normalized - 1;
  const prefixOrdinal = Math.floor(zeroBased / DISPATCHER_PUBLIC_TICKET_NUMERIC_SPACE);
  const numericPart = (zeroBased % DISPATCHER_PUBLIC_TICKET_NUMERIC_SPACE) + 1;
  const alphabetSize = DISPATCHER_PUBLIC_TICKET_CODE_ALPHABET.length;
  let remainder = prefixOrdinal + 1;
  const chars = [];

  while (remainder > 0) {
    remainder -= 1;
    chars.push(DISPATCHER_PUBLIC_TICKET_CODE_ALPHABET[remainder % alphabetSize]);
    remainder = Math.floor(remainder / alphabetSize);
  }

  return `${chars.reverse().join('')}${numericPart}`;
}

function parseDispatcherPublicTicketCodeToPresaleId(value) {
  const normalized = normalizeDispatcherLookupCompact(value);
  const match = normalized.match(/^([A-Z]+)([1-9]\d{0,1})$/);
  if (!match) return null;

  const [, prefixPart, numericPartRaw] = match;
  const numericPart = Number(numericPartRaw);
  if (!Number.isInteger(numericPart) || numericPart < 1 || numericPart > DISPATCHER_PUBLIC_TICKET_NUMERIC_SPACE) {
    return null;
  }

  let ordinalValue = 0;
  for (const char of Array.from(prefixPart)) {
    const letterIndex = DISPATCHER_PUBLIC_TICKET_CODE_ALPHABET.indexOf(char);
    if (letterIndex < 0) return null;
    ordinalValue = ordinalValue * DISPATCHER_PUBLIC_TICKET_CODE_ALPHABET.length + (letterIndex + 1);
  }

  const prefixOrdinal = ordinalValue - 1;
  const presaleId = prefixOrdinal * DISPATCHER_PUBLIC_TICKET_NUMERIC_SPACE + numericPart;
  return Number.isInteger(presaleId) && presaleId > 0 ? presaleId : null;
}

function safeDecodeLookupURIComponent(value) {
  const normalized = String(value ?? '');
  try {
    return decodeURIComponent(normalized);
  } catch {
    return normalized;
  }
}

function buildDispatcherTicketLookupCandidates(rawInput) {
  const input = String(rawInput ?? '').trim();
  if (!input) {
    return [];
  }

  const candidateMap = new Map();
  const pushCandidate = (value) => {
    const decoded = safeDecodeLookupURIComponent(value);
    const token = normalizeDispatcherLookupToken(decoded);
    if (!token) {
      return;
    }
    const key = normalizeDispatcherLookupCompact(token) || token;
    if (!candidateMap.has(key)) {
      candidateMap.set(key, token);
    }
  };

  pushCandidate(input);

  String(input)
    .split(/[\s,;|]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => pushCandidate(part));

  let parsedUrl = null;
  try {
    parsedUrl = new URL(input);
  } catch {
    try {
      if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(input)) {
        parsedUrl = new URL(`https://${input}`);
      }
    } catch {
      parsedUrl = null;
    }
  }

  if (parsedUrl) {
    const hostWithPath = `${parsedUrl.hostname}${parsedUrl.pathname || ''}`;
    pushCandidate(hostWithPath);

    parsedUrl.pathname
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean)
      .forEach((segment) => pushCandidate(segment));

    parsedUrl.searchParams.forEach((value) => {
      pushCandidate(value);
    });

    const hashRaw = String(parsedUrl.hash || '').replace(/^#/, '').trim();
    if (hashRaw) {
      pushCandidate(hashRaw);
      if (hashRaw.includes('=')) {
        try {
          const hashParams = new URLSearchParams(hashRaw);
          hashParams.forEach((value) => {
            pushCandidate(value);
          });
        } catch {
          // no-op
        }
      }
    }
  }

  return Array.from(candidateMap.values());
}

function findDispatcherLookupByPresaleId(presaleId) {
  const normalizedPresaleId = parsePositiveIntegerOrNull(presaleId);
  if (!normalizedPresaleId) {
    return null;
  }
  return db.prepare(`
    SELECT
      p.id AS presale_id,
      p.boat_slot_id,
      p.status AS presale_status,
      p.total_price,
      p.prepayment_amount,
      p.payment_method,
      p.payment_cash_amount,
      p.payment_card_amount,
      COALESCE(bs.time, gs.time) AS slot_time,
      COALESCE(NULLIF(p.business_day, ''), gs.trip_date, bs.trip_date) AS slot_trip_date,
      COALESCE(b.name, gb.name) AS boat_name,
      COALESCE(b.type, gb.type) AS boat_type,
      CASE
        WHEN gs.id IS NOT NULL THEN 'generated:' || gs.id
        WHEN bs.id IS NOT NULL THEN 'manual:' || bs.id
        ELSE p.slot_uid
      END AS slot_uid,
      t.id AS ticket_id,
      t.ticket_code
    FROM presales p
    LEFT JOIN boat_slots bs ON p.boat_slot_id = bs.id
    LEFT JOIN generated_slots gs ON (p.slot_uid LIKE 'generated:%' AND gs.id = CAST(substr(p.slot_uid, 11) AS INTEGER))
    LEFT JOIN boats b ON bs.boat_id = b.id
    LEFT JOIN boats gb ON gs.boat_id = gb.id
    LEFT JOIN tickets t ON t.id = (
      SELECT t2.id
      FROM tickets t2
      WHERE t2.presale_id = p.id
      ORDER BY CASE WHEN t2.status = 'ACTIVE' THEN 0 ELSE 1 END, t2.id ASC
      LIMIT 1
    )
    WHERE p.id = ?
    LIMIT 1
  `).get(normalizedPresaleId);
}

function findDispatcherLookupByTicketId(ticketId) {
  const normalizedTicketId = parsePositiveIntegerOrNull(ticketId);
  if (!normalizedTicketId) {
    return null;
  }
  return db.prepare(`
    SELECT
      p.id AS presale_id,
      p.boat_slot_id,
      p.status AS presale_status,
      p.total_price,
      p.prepayment_amount,
      p.payment_method,
      p.payment_cash_amount,
      p.payment_card_amount,
      COALESCE(bs.time, gs.time) AS slot_time,
      COALESCE(NULLIF(p.business_day, ''), gs.trip_date, bs.trip_date) AS slot_trip_date,
      COALESCE(b.name, gb.name) AS boat_name,
      COALESCE(b.type, gb.type) AS boat_type,
      CASE
        WHEN gs.id IS NOT NULL THEN 'generated:' || gs.id
        WHEN bs.id IS NOT NULL THEN 'manual:' || bs.id
        ELSE p.slot_uid
      END AS slot_uid,
      t.id AS ticket_id,
      t.ticket_code
    FROM tickets t
    JOIN presales p ON p.id = t.presale_id
    LEFT JOIN boat_slots bs ON p.boat_slot_id = bs.id
    LEFT JOIN generated_slots gs ON (p.slot_uid LIKE 'generated:%' AND gs.id = CAST(substr(p.slot_uid, 11) AS INTEGER))
    LEFT JOIN boats b ON bs.boat_id = b.id
    LEFT JOIN boats gb ON gs.boat_id = gb.id
    WHERE t.id = ?
    LIMIT 1
  `).get(normalizedTicketId);
}

function findDispatcherLookupByTicketCode(ticketCodeCandidate) {
  const normalizedToken = normalizeDispatcherLookupToken(ticketCodeCandidate);
  if (!normalizedToken) {
    return null;
  }
  const compactToken = normalizeDispatcherLookupCompact(ticketCodeCandidate);
  if (!compactToken) {
    return null;
  }

  return db.prepare(`
    SELECT
      p.id AS presale_id,
      p.boat_slot_id,
      p.status AS presale_status,
      p.total_price,
      p.prepayment_amount,
      p.payment_method,
      p.payment_cash_amount,
      p.payment_card_amount,
      COALESCE(bs.time, gs.time) AS slot_time,
      COALESCE(NULLIF(p.business_day, ''), gs.trip_date, bs.trip_date) AS slot_trip_date,
      COALESCE(b.name, gb.name) AS boat_name,
      COALESCE(b.type, gb.type) AS boat_type,
      CASE
        WHEN gs.id IS NOT NULL THEN 'generated:' || gs.id
        WHEN bs.id IS NOT NULL THEN 'manual:' || bs.id
        ELSE p.slot_uid
      END AS slot_uid,
      t.id AS ticket_id,
      t.ticket_code
    FROM tickets t
    JOIN presales p ON p.id = t.presale_id
    LEFT JOIN boat_slots bs ON p.boat_slot_id = bs.id
    LEFT JOIN generated_slots gs ON (p.slot_uid LIKE 'generated:%' AND gs.id = CAST(substr(p.slot_uid, 11) AS INTEGER))
    LEFT JOIN boats b ON bs.boat_id = b.id
    LEFT JOIN boats gb ON gs.boat_id = gb.id
    WHERE
      UPPER(COALESCE(t.ticket_code, '')) = ?
      OR UPPER(REPLACE(REPLACE(REPLACE(COALESCE(t.ticket_code, ''), '-', ''), ' ', ''), '№', '')) = ?
    ORDER BY
      CASE
        WHEN UPPER(COALESCE(t.ticket_code, '')) = ? THEN 0
        ELSE 1
      END,
      t.id DESC
    LIMIT 1
  `).get(normalizedToken, compactToken, normalizedToken);
}

function buildTelegramStartPayloadForSellerHandoff({
  sourceToken = null,
  canonicalPresaleId = null,
} = {}) {
  const normalizedSourceToken = normalizeTelegramStartToken(sourceToken);
  if (!normalizedSourceToken) {
    return null;
  }

  const normalizedPresaleId = parsePositiveIntegerOrNull(canonicalPresaleId);
  if (!normalizedPresaleId) {
    return normalizedSourceToken;
  }

  return `${normalizedSourceToken}${SELLER_HANDOFF_START_PAYLOAD_SEPARATOR}${normalizedPresaleId}`;
}

function buildTelegramDeepLinkForSellerHandoff(startPayload = null) {
  const normalizedPayload = normalizeTelegramStartToken(startPayload);
  if (!normalizedPayload) {
    return null;
  }

  const botUsername = resolveSellerHandoffTelegramBotUsername();
  return `https://t.me/${botUsername}?start=${encodeURIComponent(normalizedPayload)}`;
}

function buildSellerBuyerHandoffSummary({
  canonicalPresaleId = null,
  buyerTicketCode = null,
  sellerId = null,
} = {}) {
  const normalizedPresaleId = parsePositiveIntegerOrNull(canonicalPresaleId);
  const normalizedBuyerTicketCode = String(buyerTicketCode ?? '').trim() || null;
  const sourceToken = resolveSellerSourceTokenForHandoff(sellerId);
  const telegramStartPayload = buildTelegramStartPayloadForSellerHandoff({
    sourceToken,
    canonicalPresaleId: normalizedPresaleId,
  });
  const telegramDeepLinkUrl = buildTelegramDeepLinkForSellerHandoff(telegramStartPayload);

  return Object.freeze({
    response_version: 'seller_buyer_handoff.v1',
    buyer_ticket_code: normalizedBuyerTicketCode,
    canonical_presale_id: normalizedPresaleId,
    source_token: sourceToken,
    channels: Object.freeze({
      telegram: Object.freeze({
        channel_key: 'telegram',
        channel_label: 'Telegram',
        handoff_status: telegramDeepLinkUrl ? 'ready' : 'blocked',
        source_token: sourceToken,
        start_payload: telegramStartPayload,
        start_command_payload: telegramStartPayload ? `/start ${telegramStartPayload}` : null,
        deeplink_url: telegramDeepLinkUrl,
        qr_payload_text: telegramDeepLinkUrl,
      }),
      max: Object.freeze({
        channel_key: 'max',
        channel_label: 'Max',
        handoff_status: 'planned',
        message: 'Канал Max скоро будет доступен.',
        deeplink_url: null,
        qr_payload_text: null,
      }),
      website: Object.freeze({
        channel_key: 'website',
        channel_label: 'Сайт',
        handoff_status: 'planned',
        message: 'Веб-канал скоро будет доступен.',
        deeplink_url: null,
        qr_payload_text: null,
      }),
    }),
  });
}

function resolveSlotCapacityTotal(slot) {
  return toNonNegativeInt(slot?.capacity ?? slot?.boat_capacity, 0);
}

function resolveCachedSeatsLeft(slot, capacityTotal) {
  const rawValue = slot?.seats_left_cache;
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return capacityTotal;
  }
  return Math.min(capacityTotal, toNonNegativeInt(rawValue, capacityTotal));
}

let hasLoggedTelegramHoldSummaryReadError = false;

function readActiveTelegramHoldSummaryBySlotUid() {
  try {
    const rows = db
      .prepare(
        `
          WITH request_slot_refs AS (
            SELECT
              e.booking_request_id,
              COALESCE(
                json_extract(e.event_payload, '$.creation_result.requested_trip_slot_reference.slot_uid'),
                json_extract(e.event_payload, '$.requested_trip_slot_reference.slot_uid')
              ) AS slot_uid
            FROM telegram_booking_request_events e
            INNER JOIN (
              SELECT
                booking_request_id,
                MIN(booking_request_event_id) AS first_request_created_event_id
              FROM telegram_booking_request_events
              WHERE event_type = 'REQUEST_CREATED'
              GROUP BY booking_request_id
            ) first_created_event
              ON first_created_event.booking_request_id = e.booking_request_id
             AND first_created_event.first_request_created_event_id = e.booking_request_event_id
            WHERE e.event_type = 'REQUEST_CREATED'
          )
          SELECT
            request_slot_refs.slot_uid AS slot_uid,
            SUM(
              CASE
                WHEN br.requested_seats IS NULL OR br.requested_seats < 0 THEN 0
                ELSE br.requested_seats
              END
            ) AS held_seats,
            COUNT(1) AS active_hold_count,
            MIN(h.hold_expires_at) AS next_hold_expires_at
          FROM telegram_booking_holds h
          INNER JOIN telegram_booking_requests br
            ON br.booking_request_id = h.booking_request_id
          INNER JOIN request_slot_refs
            ON request_slot_refs.booking_request_id = br.booking_request_id
          WHERE br.request_status = 'HOLD_ACTIVE'
            AND h.hold_status IN ('ACTIVE', 'EXTENDED')
            AND datetime(h.hold_expires_at) > datetime('now')
            AND request_slot_refs.slot_uid IS NOT NULL
            AND (
              request_slot_refs.slot_uid GLOB 'generated:[0-9]*'
              OR request_slot_refs.slot_uid GLOB 'manual:[0-9]*'
            )
          GROUP BY request_slot_refs.slot_uid
        `
      )
      .all();

    const holdSummaryBySlotUid = new Map();
    for (const row of rows || []) {
      const slotUid = String(row?.slot_uid || '').trim();
      if (!slotUid) {
        continue;
      }
      holdSummaryBySlotUid.set(slotUid, {
        held_seats: toNonNegativeInt(row?.held_seats, 0),
        active_hold_count: toNonNegativeInt(row?.active_hold_count, 0),
        next_hold_expires_at: row?.next_hold_expires_at || null,
      });
    }
    return holdSummaryBySlotUid;
  } catch (error) {
    if (!hasLoggedTelegramHoldSummaryReadError) {
      hasLoggedTelegramHoldSummaryReadError = true;
      console.warn(
        '[TELEGRAM_HOLD_VISIBILITY_READ_FAILED]',
        error?.message || error
      );
    }
    return new Map();
  }
}

function applyTelegramHoldVisibilityToSlots(slotRows = []) {
  const holdSummaryBySlotUid = readActiveTelegramHoldSummaryBySlotUid();
  return slotRows.map((slot) => {
    const slotUid = String(slot?.slot_uid || slot?.slotUid || '').trim();
    const holdSummary = holdSummaryBySlotUid.get(slotUid) || null;
    const capacityTotal = resolveSlotCapacityTotal(slot);
    const ticketBasedSeatsLeft = Math.min(
      capacityTotal,
      toNonNegativeInt(slot?.seats_left ?? slot?.available_seats, capacityTotal)
    );
    const cachedSeatsLeft = resolveCachedSeatsLeft(slot, capacityTotal);
    const explicitHeldSeats = toNonNegativeInt(holdSummary?.held_seats, 0);
    const seatsLeftAfterExplicitHolds = Math.max(
      0,
      ticketBasedSeatsLeft - explicitHeldSeats
    );
    const effectiveSeatsLeft = Math.max(
      0,
      Math.min(ticketBasedSeatsLeft, cachedSeatsLeft, seatsLeftAfterExplicitHolds)
    );
    const derivedHeldSeats = Math.max(0, ticketBasedSeatsLeft - effectiveSeatsLeft);
    const visibleHeldSeats = Math.max(explicitHeldSeats, derivedHeldSeats);

    return {
      ...slot,
      seats_left_without_telegram_holds: ticketBasedSeatsLeft,
      seats_left: effectiveSeatsLeft,
      available_seats: effectiveSeatsLeft,
      telegram_active_hold_seats: visibleHeldSeats,
      telegram_active_hold_count: toNonNegativeInt(
        holdSummary?.active_hold_count,
        visibleHeldSeats > 0 ? 1 : 0
      ),
      telegram_hold_expires_at: holdSummary?.next_hold_expires_at || null,
    };
  });
}

function getLocalBusinessDayWindow() {
  const row = db.prepare(`
    SELECT
      DATE('now','localtime') AS today,
      DATE('now','localtime','+1 day') AS tomorrow
  `).get();

  return {
    today: row?.today || getLocalBusinessDay(),
    tomorrow: row?.tomorrow || null,
  };
}

const SEASON_MMDD_REGEX = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function resolveSeasonDateRange(seasonId, settings) {
  const defaultStart = '01-01';
  const defaultEnd = '12-31';
  const ymdRegex = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  const rawSeasonStart = String(settings?.seasonStart ?? '').trim();
  const rawSeasonEnd = String(settings?.seasonEnd ?? '').trim();
  const hasValidYmdRange =
    ymdRegex.test(rawSeasonStart) &&
    ymdRegex.test(rawSeasonEnd) &&
    rawSeasonStart <= rawSeasonEnd;

  const rawStartMmdd = String(settings?.season_start_mmdd ?? '').trim();
  const rawEndMmdd = String(settings?.season_end_mmdd ?? '').trim();
  const hasValidMmddRange =
    SEASON_MMDD_REGEX.test(rawStartMmdd) &&
    SEASON_MMDD_REGEX.test(rawEndMmdd) &&
    rawStartMmdd <= rawEndMmdd;

  const startMmdd = hasValidYmdRange
    ? rawSeasonStart.slice(5)
    : (hasValidMmddRange ? rawStartMmdd : defaultStart);
  const endMmdd = hasValidYmdRange
    ? rawSeasonEnd.slice(5)
    : (hasValidMmddRange ? rawEndMmdd : defaultEnd);

  return {
    seasonFrom: `${seasonId}-${startMmdd}`,
    seasonTo: `${seasonId}-${endMmdd}`,
  };
}

function listCanonicalSellerPointRowsForBusinessDay(businessDay) {
  const settings = resolveOwnerSettings(db);
  const kSpeed = Number(settings.k_speed ?? 1.2);
  const kCruise = Number(settings.k_cruise ?? 3.0);
  const kZoneHedgehog = Number(settings.k_zone_hedgehog ?? 1.3);
  const kZoneCenter = Number(settings.k_zone_center ?? 1.0);
  const kZoneSanatorium = Number(settings.k_zone_sanatorium ?? 0.8);
  const kZoneStationary = Number(settings.k_zone_stationary ?? 0.7);
  const kBananaHedgehog = Number(settings.k_banana_hedgehog ?? 2.7);
  const kBananaCenter = Number(settings.k_banana_center ?? 2.2);
  const kBananaSanatorium = Number(settings.k_banana_sanatorium ?? 1.2);
  const kBananaStationary = Number(settings.k_banana_stationary ?? 1.0);

  const getZoneK = (zone) => {
    if (zone === 'hedgehog') return kZoneHedgehog;
    if (zone === 'center') return kZoneCenter;
    if (zone === 'sanatorium') return kZoneSanatorium;
    if (zone === 'stationary') return kZoneStationary;
    return 1.0;
  };

  const getBananaK = (zone) => {
    if (zone === 'hedgehog') return kBananaHedgehog;
    if (zone === 'center') return kBananaCenter;
    if (zone === 'sanatorium') return kBananaSanatorium;
    if (zone === 'stationary') return kBananaStationary;
    return 1.0;
  };

  const sellerZoneRows = db.prepare(`
    SELECT id, username, zone
    FROM users
    WHERE role = 'seller' AND is_active = 1
  `).all();
  const sellerZoneMap = new Map((sellerZoneRows || []).map((row) => [Number(row.id), row]));
  const revenueRows = db.prepare(`
    SELECT
      ml.seller_id,
      COALESCE(b.type, gb.type) AS boat_type,
      p.zone_at_sale,
      COALESCE(SUM(CASE
        WHEN ml.type IN (
          'SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED',
          'SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED'
        ) THEN ml.amount
        ELSE 0
      END), 0) AS revenue_gross,
      COALESCE(SUM(CASE WHEN ml.type = 'SALE_CANCEL_REVERSE' THEN ABS(ml.amount) ELSE 0 END), 0) AS refunds
    FROM money_ledger ml
    LEFT JOIN presales p ON p.id = ml.presale_id
    LEFT JOIN boat_slots bs ON bs.id = p.boat_slot_id
    LEFT JOIN generated_slots gs
      ON p.slot_uid LIKE 'generated:%'
     AND gs.id = CAST(substr(p.slot_uid, 11) AS INTEGER)
    LEFT JOIN boats b ON b.id = bs.boat_id
    LEFT JOIN boats gb ON gb.id = gs.boat_id
    WHERE ml.status = 'POSTED'
      AND ml.kind = 'SELLER_SHIFT'
      AND DATE(ml.business_day) = ?
      AND ml.seller_id IS NOT NULL
      AND ml.seller_id > 0
      AND ml.type IN (
        'SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED',
        'SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED',
        'SALE_CANCEL_REVERSE'
      )
    GROUP BY ml.seller_id, COALESCE(b.type, gb.type), p.zone_at_sale
  `).all(businessDay);

  const statsMap = new Map();
  for (const row of revenueRows || []) {
    const sellerId = Number(row.seller_id);
    const boatType = String(row.boat_type || '').toLowerCase();
    const sellerMeta = sellerZoneMap.get(sellerId);
    if (!sellerMeta) continue;
    if (!['speed', 'cruise', 'banana'].includes(boatType)) continue;

    const revenueNet = Math.max(
      0,
      Number(row.revenue_gross || 0) - Number(row.refunds || 0)
    );

    let entry = statsMap.get(sellerId);
    if (!entry) {
      const state = getSellerState(sellerId);
      const streakDays = state?.calibrated ? Number(state.streak_days || 0) : 0;
      entry = {
        user_id: sellerId,
        name: sellerMeta.username || `Seller ${sellerId}`,
        revenue_total: 0,
        points_total: 0,
        k_streak: getStreakMultiplier(streakDays),
        zone: sellerMeta.zone || null,
      };
      statsMap.set(sellerId, entry);
    }

    const effectiveZone = row.zone_at_sale || entry.zone;
    const revenueInK = revenueNet / 1000;
    let pointsBase = 0;

    if (boatType === 'speed') {
      pointsBase = revenueInK * kSpeed * getZoneK(effectiveZone);
    } else if (boatType === 'cruise') {
      pointsBase = revenueInK * kCruise * getZoneK(effectiveZone);
    } else if (boatType === 'banana') {
      pointsBase = revenueInK * getBananaK(effectiveZone);
    }

    entry.revenue_total = roundToKopecks(entry.revenue_total + revenueNet);
    entry.points_total = roundToKopecks(entry.points_total + (pointsBase * entry.k_streak));
  }

  return [...statsMap.values()];
}

function hasStoredSellerDayStats(businessDay) {
  const row = db.prepare(`
    SELECT COUNT(*) AS cnt
    FROM seller_day_stats
    WHERE DATE(business_day) = ?
  `).get(businessDay);
  return Number(row?.cnt || 0) > 0;
}

function listSellerLeaderboardRows({ dateFrom, dateTo, today, todayRows = null }) {
  const shouldOverlayToday =
    today >= dateFrom &&
    today <= dateTo &&
    !hasStoredSellerDayStats(today) &&
    Array.isArray(todayRows);

  const where = ['DATE(s.business_day) BETWEEN ? AND ?'];
  const params = [dateFrom, dateTo];
  if (shouldOverlayToday) {
    where.push('DATE(s.business_day) <> ?');
    params.push(today);
  }

  const aggregatedRows = db.prepare(`
    SELECT
      s.seller_id AS user_id,
      COALESCE(u.username, 'Seller ' || s.seller_id) AS name,
      COALESCE(SUM(s.revenue_day), 0) AS revenue_total,
      COALESCE(SUM(s.points_day_total), 0) AS points_total
    FROM seller_day_stats s
    JOIN users u ON u.id = s.seller_id
    WHERE u.role = 'seller'
      AND COALESCE(u.is_active, 1) = 1
      AND ${where.join('\n      AND ')}
    GROUP BY s.seller_id, name
  `).all(...params);

  const rowsMap = new Map();
  for (const row of aggregatedRows || []) {
    rowsMap.set(Number(row.user_id), {
      user_id: Number(row.user_id),
      name: row.name || `Seller ${row.user_id}`,
      revenue_total: roundToKopecks(Number(row.revenue_total || 0)),
      points_total: roundToKopecks(Number(row.points_total || 0)),
    });
  }

  if (shouldOverlayToday) {
    for (const row of todayRows) {
      const sellerId = Number(row.user_id);
      if (!Number.isFinite(sellerId) || sellerId <= 0) continue;
      const entry = rowsMap.get(sellerId) || {
        user_id: sellerId,
        name: row.name || `Seller ${sellerId}`,
        revenue_total: 0,
        points_total: 0,
      };
      entry.revenue_total = roundToKopecks(entry.revenue_total + Number(row.revenue_total || 0));
      entry.points_total = roundToKopecks(entry.points_total + Number(row.points_total || 0));
      rowsMap.set(sellerId, entry);
    }
  }

  const rows = [...rowsMap.values()]
    .filter((row) => Number(row.revenue_total || 0) > 0 || Number(row.points_total || 0) > 0)
    .sort((left, right) => {
      if (Number(right.points_total || 0) !== Number(left.points_total || 0)) {
        return Number(right.points_total || 0) - Number(left.points_total || 0);
      }
      if (Number(right.revenue_total || 0) !== Number(left.revenue_total || 0)) {
        return Number(right.revenue_total || 0) - Number(left.revenue_total || 0);
      }
      return String(left.name || '').localeCompare(String(right.name || ''));
    })
    .map((row, index) => ({
      ...row,
      place: index + 1,
    }));

  return {
    rows,
    source: shouldOverlayToday ? 'seller_day_stats+live_today' : 'seller_day_stats',
  };
}

const SELLER_SEASON_RULES = {
  minWorkedDaysSeason: 75,
  minWorkedDaysSep: 20,
  minWorkedDaysEndSep: 1,
  endSepWindowDays: 7,
};

const SEASON_PAYOUT_SCHEMES = new Set(['all', 'top3', 'top5']);

function getCurrentWeeklyPrizeSplit(poolTotal) {
  const total = Math.max(0, Math.round(Number(poolTotal || 0)));
  const first = Math.max(0, Math.round(total * 0.5));
  const second = Math.max(0, Math.round(total * 0.3));
  const third = Math.max(0, total - first - second);

  return {
    first,
    second,
    third,
  };
}

function buildCurrentWeeklyPrizes(poolTotal) {
  const split = getCurrentWeeklyPrizeSplit(poolTotal);
  return [
    { place: 1, amount: split.first },
    { place: 2, amount: split.second },
    { place: 3, amount: split.third },
  ];
}

function getWeeklyPrizeAmountByPlace(place, prizes) {
  const numericPlace = Number(place || 0);
  if (!Number.isFinite(numericPlace) || numericPlace <= 0) return 0;
  return Number(prizes.find((item) => Number(item.place) === numericPlace)?.amount || 0);
}

function normalizeSeasonPayoutScheme(raw) {
  const scheme = String(raw || '').trim().toLowerCase();
  return SEASON_PAYOUT_SCHEMES.has(scheme) ? scheme : 'all';
}

function getSeasonPayoutModeLabel(scheme) {
  if (scheme === 'top3') return 'eligible_top3_weighted_by_rank';
  if (scheme === 'top5') return 'eligible_top5_weighted_by_rank';
  return 'eligible_all_equal_split';
}

function selectSeasonPayoutRecipients(sellers, scheme) {
  const rankedSellers = (Array.isArray(sellers) ? sellers : []).filter((seller) => Number(seller?.user_id || 0) > 0);
  if (scheme === 'top3') return rankedSellers.slice(0, 3);
  if (scheme === 'top5') return rankedSellers.slice(0, 5);
  return rankedSellers;
}

function getSeasonPayoutWeights(scheme, recipientCount) {
  const count = Math.max(0, Number(recipientCount || 0));
  if (count <= 0) return [];

  if (scheme === 'all') {
    return Array.from({ length: count }, () => 1 / count);
  }

  if (scheme === 'top3') {
    if (count === 1) return [1];
    if (count === 2) return [0.6, 0.4];
    return [0.5, 0.3, 0.2];
  }

  if (count === 1) return [1];
  if (count === 2) return [0.6, 0.4];
  if (count === 3) return [0.5, 0.3, 0.2];
  if (count === 4) return [0.4, 0.3, 0.2, 0.1];
  return [0.35, 0.25, 0.18, 0.12, 0.1];
}

function allocateSeasonPayouts(totalAmount, recipients, scheme) {
  const payoutMap = new Map();
  const shareMap = new Map();
  const preparedRecipients = (Array.isArray(recipients) ? recipients : [])
    .map((recipient) => Number(recipient?.user_id || 0))
    .filter((userId) => userId > 0);
  const payoutFundTotal = roundToKopecks(Math.max(0, Number(totalAmount || 0)));
  const payoutWeights = getSeasonPayoutWeights(scheme, preparedRecipients.length);

  if (preparedRecipients.length === 0 || payoutFundTotal <= 0 || payoutWeights.length !== preparedRecipients.length) {
    return { payoutMap, shareMap, allocatedTotal: 0 };
  }

  const totalKopecks = Math.max(0, Math.round(payoutFundTotal * 100));
  const payoutKopecks = payoutWeights.map((weight) => Math.max(0, Math.floor(totalKopecks * Number(weight || 0))));
  let undistributedKopecks = Math.max(0, totalKopecks - payoutKopecks.reduce((sum, amount) => sum + amount, 0));

  for (let index = 0; undistributedKopecks > 0; index = (index + 1) % payoutKopecks.length) {
    payoutKopecks[index] += 1;
    undistributedKopecks -= 1;
  }

  let allocatedTotal = 0;
  preparedRecipients.forEach((userId, index) => {
    const payoutAmount = roundToKopecks(payoutKopecks[index] / 100);
    shareMap.set(userId, Number(payoutWeights[index] || 0));
    payoutMap.set(userId, payoutAmount);
    allocatedTotal = roundToKopecks(allocatedTotal + payoutAmount);
  });

  return {
    payoutMap,
    shareMap,
    allocatedTotal: roundToKopecks(allocatedTotal),
  };
}

function getActiveSellerMetaMap() {
  const rows = db.prepare(`
    SELECT id, username, zone
    FROM users
    WHERE role = 'seller' AND is_active = 1
  `).all();

  return new Map((rows || []).map((row) => [Number(row.id), row]));
}

function buildCurrentSellerBaseSummary(sellerId, activeSellerMeta) {
  return {
    user_id: sellerId,
    name: activeSellerMeta?.username || `Seller ${sellerId}`,
    zone: activeSellerMeta?.zone || null,
    place: null,
    points: null,
    revenue: null,
    current_payout: 0,
    prize_place: null,
    participating: false,
  };
}

function buildWorkedDaysMap(dateFrom, dateTo, { today, liveTodayRows = null } = {}) {
  const rows = db.prepare(`
    SELECT seller_id, COUNT(*) AS cnt
    FROM seller_day_stats
    WHERE business_day BETWEEN ? AND ?
      AND revenue_day > 0
    GROUP BY seller_id
  `).all(dateFrom, dateTo);

  const result = new Map((rows || []).map((row) => [Number(row.seller_id), Number(row.cnt || 0)]));

  if (
    Array.isArray(liveTodayRows) &&
    String(today || '').trim() &&
    today >= dateFrom &&
    today <= dateTo
  ) {
    for (const row of liveTodayRows) {
      const sellerId = Number(row?.user_id || 0);
      const revenueTotal = Number(row?.revenue_total || 0);
      if (!Number.isFinite(sellerId) || sellerId <= 0 || revenueTotal <= 0) continue;
      result.set(sellerId, Number(result.get(sellerId) || 0) + 1);
    }
  }

  return result;
}

function buildSeasonProgress({
  workedDaysSeason = 0,
  workedDaysSep = 0,
  workedDaysEndSep = 0,
} = {}) {
  const seasonRequired = SELLER_SEASON_RULES.minWorkedDaysSeason;
  const sepRequired = SELLER_SEASON_RULES.minWorkedDaysSep;
  const endSepRequired = SELLER_SEASON_RULES.minWorkedDaysEndSep;

  const remainingSeason = Math.max(0, seasonRequired - Number(workedDaysSeason || 0));
  const remainingSep = Math.max(0, sepRequired - Number(workedDaysSep || 0));
  const remainingEndSep = Math.max(0, endSepRequired - Number(workedDaysEndSep || 0));

  return {
    worked_days_season: Number(workedDaysSeason || 0),
    worked_days_required: seasonRequired,
    remaining_days_season: remainingSeason,
    worked_days_sep: Number(workedDaysSep || 0),
    worked_days_sep_required: sepRequired,
    remaining_days_sep: remainingSep,
    worked_days_end_sep: Number(workedDaysEndSep || 0),
    worked_days_end_sep_required: endSepRequired,
    remaining_days_end_sep: remainingEndSep,
    is_eligible: remainingSeason === 0 && remainingSep === 0 && remainingEndSep === 0 ? 1 : 0,
  };
}

function mapOwnerWeeklySellerRow(row, sellerId, prizes) {
  const sellerNumericId = Number(row?.user_id || 0);
  const place = Number(row?.rank ?? row?.place ?? 0) || null;
  const currentPayout = roundToKopecks(Number(
    row?.weekly_payout_current ??
    row?.weekly_payout ??
    getWeeklyPrizeAmountByPlace(place, prizes)
  ) || 0);

  return {
    user_id: sellerNumericId,
    name: row?.name || `Seller ${sellerNumericId}`,
    zone: row?.zone || null,
    place,
    points: roundToKopecks(Number(row?.points_week_total ?? row?.points_total ?? 0)),
    revenue: roundToKopecks(Number(row?.revenue_total_week ?? row?.revenue_total ?? 0)),
    current_payout: currentPayout,
    prize_place: place && place <= 3 ? place : null,
    is_prize_place: Boolean(place && place <= 3),
    participating: true,
    is_current_seller: sellerNumericId === Number(sellerId || 0),
  };
}

function buildWeeklyMotivationSnapshot({ sellerId, today = null } = {}) {
  const resolvedToday = String(today || '').trim() || getLocalBusinessDay();
  const weekId = getIsoWeekIdForBusinessDay(resolvedToday);
  const ownerWeekly = buildOwnerWeeklyMotivationReadModel({ week: weekId });
  const ownerData = ownerWeekly?.data || {};
  const activeSellerMeta = getActiveSellerMetaMap().get(Number(sellerId || 0)) || null;
  const poolTotalCurrent = roundToKopecks(Number(
    ownerData.weekly_pool_total_current ??
    ownerData.weekly_pool_total ??
    0
  ));
  const prizes = buildCurrentWeeklyPrizes(poolTotalCurrent);
  const sellers = (Array.isArray(ownerData.sellers) ? ownerData.sellers : [])
    .map((row) => mapOwnerWeeklySellerRow(row, sellerId, prizes));

  const currentSeller =
    sellers.find((row) => Number(row.user_id) === Number(sellerId || 0))
    || buildCurrentSellerBaseSummary(Number(sellerId || 0), activeSellerMeta);

  if (!currentSeller.is_current_seller) {
    currentSeller.is_current_seller = true;
  }

  return {
    week_id: ownerData.week_id || weekId,
    date_from: ownerData.date_from || resolvedToday,
    date_to: ownerData.date_to || resolvedToday,
    weekly_percent: Number(ownerData.weekly_percent || 0),
    fund_total: poolTotalCurrent,
    fund_total_ledger: roundToKopecks(Number(ownerData.weekly_pool_total_ledger || 0)),
    fund_total_daily_sum: roundToKopecks(Number(ownerData.weekly_pool_total_daily_sum || 0)),
    prizes,
    total_sellers: Number(ownerData.sellers?.length || sellers.length),
    source: ownerWeekly?.meta?.ranking_source || 'owner_motivation_weekly',
    current_seller: currentSeller,
    sellers,
    owner_meta: ownerWeekly?.meta || null,
  };
}

function buildOwnerSeasonProgress(row, eligibilityRules) {
  const workedDaysSeason = Math.max(0, Number(row?.worked_days_season || 0));
  const workedDaysSep = Math.max(0, Number(row?.worked_days_sep || 0));
  const workedDaysEndSep = Math.max(0, Number(row?.worked_days_end_sep || 0));
  const workedDaysRequired = Math.max(0, Number(eligibilityRules?.min_worked_days_season ?? SELLER_SEASON_RULES.minWorkedDaysSeason));
  const workedDaysSepRequired = Math.max(0, Number(eligibilityRules?.min_worked_days_sep ?? SELLER_SEASON_RULES.minWorkedDaysSep));
  const workedDaysEndSepRequired = Math.max(0, Number(eligibilityRules?.min_worked_days_end_sep ?? 1));

  return {
    worked_days_season: workedDaysSeason,
    worked_days_required: workedDaysRequired,
    remaining_days_season: Math.max(0, workedDaysRequired - workedDaysSeason),
    worked_days_sep: workedDaysSep,
    worked_days_sep_required: workedDaysSepRequired,
    remaining_days_sep: Math.max(0, workedDaysSepRequired - workedDaysSep),
    worked_days_end_sep: workedDaysEndSep,
    worked_days_end_sep_required: workedDaysEndSepRequired,
    remaining_days_end_sep: Math.max(0, workedDaysEndSepRequired - workedDaysEndSep),
    is_eligible: Number(row?.is_eligible || 0) === 1 ? 1 : 0,
  };
}

function mapOwnerSeasonSellerRow(row, sellerId, eligibilityRules) {
  const sellerNumericId = Number(row?.user_id || 0);
  const place = Number(row?.rank ?? row?.place ?? 0) || null;

  return {
    user_id: sellerNumericId,
    name: row?.name || `Seller ${sellerNumericId}`,
    zone: row?.zone || null,
    place,
    points: roundToKopecks(Number(row?.points_total ?? row?.points ?? 0)),
    revenue: roundToKopecks(Number(row?.revenue_total ?? row?.revenue ?? 0)),
    current_payout: roundToKopecks(Number(row?.season_payout ?? row?.current_payout ?? 0)),
    season_share: Number(row?.season_share || 0),
    season_payout_recipient: Number(row?.season_payout_recipient || 0),
    participating: true,
    is_current_seller: sellerNumericId === Number(sellerId || 0),
    ...buildOwnerSeasonProgress(row, eligibilityRules),
  };
}

function buildSeasonMotivationSnapshot({ sellerId, today = null } = {}) {
  const resolvedToday = String(today || '').trim() || getLocalBusinessDay();
  const seasonId = String(resolvedToday || '').slice(0, 4);
  const ownerSeason = buildOwnerSeasonMotivationReadModel({ seasonId });
  const ownerData = ownerSeason?.data || {};
  const eligibilityRules = ownerSeason?.meta?.eligibility_rules || {};
  const activeSellerMetaMap = getActiveSellerMetaMap();
  const rankedSellers = (Array.isArray(ownerData.sellers) ? ownerData.sellers : [])
    .map((row) => mapOwnerSeasonSellerRow(row, sellerId, eligibilityRules));

  const currentSellerId = Number(sellerId || 0);
  const currentSellerMeta = activeSellerMetaMap.get(currentSellerId) || null;
  const currentSellerProgress = buildOwnerSeasonProgress({}, eligibilityRules);
  const currentSeller =
    rankedSellers.find((seller) => Number(seller.user_id) === currentSellerId)
    || {
      user_id: currentSellerId,
      name: currentSellerMeta?.username || `Seller ${currentSellerId}`,
      zone: currentSellerMeta?.zone || null,
      place: null,
      points: null,
      revenue: null,
      current_payout: 0,
      season_share: 0,
      season_payout_recipient: 0,
      participating: false,
      is_current_seller: true,
      ...currentSellerProgress,
    };

  return {
    season_id: ownerData.season_id || seasonId,
    season_from: ownerData.season_from || resolvedToday,
    season_to: ownerData.season_to || resolvedToday,
    payout_scheme: ownerData.season_payout_scheme || ownerSeason?.meta?.season_payout_scheme || 'all',
    payout_mode: ownerSeason?.meta?.season_payout_mode || null,
    fund_total: roundToKopecks(Number(ownerData.season_payout_fund_total || 0)),
    fund_from_revenue_total: roundToKopecks(Number(ownerData.season_pool_from_revenue_total || 0)),
    fund_manual_transfer_total: roundToKopecks(Number(ownerData.season_pool_dispatcher_decision_total || ownerData.season_pool_manual_transfer_total || 0)),
    fund_rounding_total: roundToKopecks(Number(ownerData.season_pool_rounding_total || 0)),
    total_sellers: rankedSellers.length,
    eligible_count: Number(ownerData.eligible_count || 0),
    recipient_count: Number(ownerData.season_payout_recipient_count || 0),
    payouts_sum: roundToKopecks(Number(ownerData.season_payouts_sum || 0)),
    payouts_remainder: roundToKopecks(Number(ownerData.season_payouts_remainder || 0)),
    eligibility_rules: {
      min_worked_days_season: Number(eligibilityRules.min_worked_days_season ?? SELLER_SEASON_RULES.minWorkedDaysSeason),
      min_worked_days_sep: Number(eligibilityRules.min_worked_days_sep ?? SELLER_SEASON_RULES.minWorkedDaysSep),
      min_worked_days_end_sep: Number(eligibilityRules.min_worked_days_end_sep ?? 1),
      end_sep_window_days: Number(eligibilityRules.end_sep_window_days ?? SELLER_SEASON_RULES.endSepWindowDays),
    },
    source: ownerSeason?.meta?.season_stats_source || 'owner_motivation_season',
    current_seller: currentSeller,
    sellers: rankedSellers,
    owner_meta: ownerSeason?.meta || null,
  };
}

function respondShiftClosedIfNeeded(res, error) {
  if (error?.status === 409 && error?.code === SHIFT_CLOSED_CODE) {
    const payload = error?.payload || {
      ok: false,
      code: SHIFT_CLOSED_CODE,
      business_day: error?.business_day || null,
      message: error?.message || 'Shift is closed',
    };
    return res.status(409).json(payload);
  }
  return null;
}

function resolveBusinessDayFromSlot(slotUid, boatSlotId = null) {
  const parsed = parseSlotUid(slotUid);
  if (parsed?.source === 'generated') {
    const row = db.prepare('SELECT trip_date FROM generated_slots WHERE id = ?').get(parsed.id);
    if (row?.trip_date) return row.trip_date;
  } else if (parsed?.source === 'manual') {
    const row = db.prepare('SELECT trip_date FROM boat_slots WHERE id = ?').get(parsed.id);
    if (row?.trip_date) return row.trip_date;
  }

  if (boatSlotId != null) {
    const row = db.prepare('SELECT trip_date FROM boat_slots WHERE id = ?').get(boatSlotId);
    if (row?.trip_date) return row.trip_date;
  }

  return getLocalBusinessDay();
}

function resolveBusinessDayForPresaleRow(presale) {
  const explicit = String(presale?.business_day || '').trim();
  if (explicit) return explicit;
  return resolveBusinessDayFromSlot(presale?.slot_uid, presale?.boat_slot_id);
}

function getUserRoleById(userId) {
  const normalizedUserId = Number(userId || 0);
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) return null;
  try {
    const row = db.prepare('SELECT role FROM users WHERE id = ?').get(normalizedUserId);
    return row?.role ? String(row.role).toLowerCase() : null;
  } catch {
    return null;
  }
}

function resolveSaleMoneyAttribution(attributedUserId, fallbackUserId = null) {
  const candidateUserId = Number(attributedUserId ?? fallbackUserId ?? 0);
  if (!Number.isFinite(candidateUserId) || candidateUserId <= 0) {
    return {
      attributed_user_id: null,
      attributed_role: null,
      ledger_kind: 'DISPATCHER_SHIFT',
      is_seller_attributed: false,
    };
  }

  const attributedRole = getUserRoleById(candidateUserId);
  const isSellerAttributed = attributedRole === 'seller';

  return {
    attributed_user_id: candidateUserId,
    attributed_role: attributedRole,
    ledger_kind: isSellerAttributed ? 'SELLER_SHIFT' : 'DISPATCHER_SHIFT',
    is_seller_attributed: isSellerAttributed,
  };
}

function resolveLedgerKindByActor(actorUserId, fallbackKind = 'DISPATCHER_SHIFT') {
  const actorId = Number(actorUserId || 0);
  if (!Number.isFinite(actorId) || actorId <= 0) return fallbackKind;
  const actorRole = getUserRoleById(actorId);
  if (actorRole === 'seller') return 'SELLER_SHIFT';
  return 'DISPATCHER_SHIFT';
}

function normalizeLedgerCashCardSplit({
  method,
  amount = 0,
  cashAmount = 0,
  cardAmount = 0,
} = {}) {
  const normalizedAmount = Math.max(0, Math.round(Number(amount || 0)));
  const normalizedMethod = String(method || '').toUpperCase();

  if (normalizedAmount <= 0) {
    return { cash: 0, card: 0 };
  }

  if (normalizedMethod === 'CASH') {
    return { cash: normalizedAmount, card: 0 };
  }
  if (normalizedMethod === 'CARD') {
    return { cash: 0, card: normalizedAmount };
  }

  let cash = Math.max(0, Math.round(Number(cashAmount || 0)));
  let card = Math.max(0, Math.round(Number(cardAmount || 0)));
  const splitSum = cash + card;

  if (splitSum <= 0) {
    cash = Math.floor(normalizedAmount / 2);
    card = normalizedAmount - cash;
    return { cash, card };
  }

  if (splitSum !== normalizedAmount) {
    cash = Math.round((normalizedAmount * cash) / splitSum);
    cash = Math.max(0, Math.min(normalizedAmount, cash));
    card = normalizedAmount - cash;
    return { cash, card };
  }

  return { cash, card };
}

function insertSaleMoneyLedgerRow({
  presaleId,
  slotId = null,
  kind,
  type,
  method = null,
  amount = 0,
  sellerId = null,
  businessDay = null,
  tripDay = null,
  cashAmount = 0,
  cardAmount = 0,
  decidedByUserId = null,
} = {}) {
  const columns = [
    'presale_id',
    'slot_id',
    'event_time',
    'kind',
    'type',
    'method',
    'amount',
    'status',
    'seller_id',
    'business_day',
    'trip_day',
  ];
  const placeholders = [
    '?',
    '?',
    "datetime('now','localtime')",
    '?',
    '?',
    '?',
    '?',
    '?',
    '?',
    '?',
    '?',
  ];
  const values = [
    presaleId,
    slotId ?? null,
    kind,
    type,
    method || null,
    Math.round(Number(amount || 0)),
    'POSTED',
    sellerId ?? null,
    businessDay ?? null,
    tripDay ?? null,
  ];

  if (moneyLedgerHasCashAmount) {
    columns.push('cash_amount');
    placeholders.push('?');
    values.push(Math.round(Number(cashAmount || 0)));
  }
  if (moneyLedgerHasCardAmount) {
    columns.push('card_amount');
    placeholders.push('?');
    values.push(Math.round(Number(cardAmount || 0)));
  }
  if (moneyLedgerHasDecidedByUserId) {
    columns.push('decided_by_user_id');
    placeholders.push('?');
    values.push(Number.isFinite(Number(decidedByUserId)) ? Number(decidedByUserId) : null);
  }

  db.prepare(`
    INSERT INTO money_ledger (${columns.join(', ')})
    VALUES (${placeholders.join(', ')})
  `).run(...values);
}

function buildPresalePaymentSnapshot({
  paymentMethod = null,
  paymentCashAmount = 0,
  paymentCardAmount = 0,
  paidAmount = 0,
} = {}) {
  const paid = Math.max(0, Math.round(Number(paidAmount || 0)));
  let method = String(paymentMethod || '').toUpperCase();
  let cash = Math.max(0, Math.round(Number(paymentCashAmount || 0)));
  let card = Math.max(0, Math.round(Number(paymentCardAmount || 0)));

  if (paid <= 0) {
    return {
      method: null,
      cash: 0,
      card: 0,
      paid: 0,
    };
  }

  if (method !== 'CASH' && method !== 'CARD' && method !== 'MIXED') {
    if (cash > 0 && card > 0) method = 'MIXED';
    else if (card > 0) method = 'CARD';
    else method = 'CASH';
  }

  const rawSum = cash + card;
  if (method === 'CARD') {
    cash = 0;
    card = paid;
  } else if (method === 'MIXED') {
    if (rawSum > 0) {
      cash = Math.round((paid * cash) / rawSum);
      cash = Math.max(0, Math.min(paid, cash));
      card = paid - cash;
    } else {
      cash = Math.floor(paid / 2);
      card = paid - cash;
    }
    if (cash <= 0) method = 'CARD';
    else if (card <= 0) method = 'CASH';
  } else {
    method = 'CASH';
    cash = paid;
    card = 0;
  }

  return { method, cash, card, paid };
}

function shrinkPresalePaymentSnapshot({
  paymentMethod = null,
  paymentCashAmount = 0,
  paymentCardAmount = 0,
  paidAmount = 0,
  nextPaidAmount = 0,
} = {}) {
  const current = buildPresalePaymentSnapshot({
    paymentMethod,
    paymentCashAmount,
    paymentCardAmount,
    paidAmount,
  });
  const next = buildPresalePaymentSnapshot({
    paymentMethod: current.method,
    paymentCashAmount: current.cash,
    paymentCardAmount: current.card,
    paidAmount: nextPaidAmount,
  });

  return {
    current,
    next,
    refundCash: Math.max(0, current.cash - next.cash),
    refundCard: Math.max(0, current.card - next.card),
  };
}

function insertPartialSaleCancelReverseRows({
  presaleId,
  slotId = null,
  tripDay = null,
  sellerId = null,
  refundCash = 0,
  refundCard = 0,
} = {}) {
  const cash = Math.max(0, Math.round(Number(refundCash || 0)));
  const card = Math.max(0, Math.round(Number(refundCard || 0)));
  if (cash <= 0 && card <= 0) return;

  const saleAttribution = resolveSaleMoneyAttribution(sellerId, sellerId);
  const ledgerKind = saleAttribution.ledger_kind;
  const ledgerSellerId = saleAttribution.attributed_user_id;
  const refundBusinessDay = getLocalBusinessDay();
  const resolvedTripDay = String(tripDay || '').trim() || refundBusinessDay;
  const insertReverse = db.prepare(`
    INSERT INTO money_ledger
      (business_day, trip_day, kind, method, amount, status, seller_id, presale_id, slot_id, event_time, type, decision_final)
    VALUES
      (?, ?, ?, ?, ?, 'POSTED', ?, ?, ?, CURRENT_TIMESTAMP, 'SALE_CANCEL_REVERSE', 'CANCELLED')
  `);

  if (cash > 0) {
    insertReverse.run(
      refundBusinessDay,
      resolvedTripDay,
      ledgerKind,
      'CASH',
      -cash,
      ledgerSellerId,
      presaleId,
      slotId ?? null,
    );
  }
  if (card > 0) {
    insertReverse.run(
      refundBusinessDay,
      resolvedTripDay,
      ledgerKind,
      'CARD',
      -card,
      ledgerSellerId,
      presaleId,
      slotId ?? null,
    );
  }
}

function assertShiftOpenForPresaleDays(presaleId, primaryBusinessDay, extraBusinessDays = []) {
  const days = new Set();
  const primary = String(primaryBusinessDay || '').trim();
  if (primary) days.add(primary);

  for (const day of extraBusinessDays || []) {
    const normalized = String(day || '').trim();
    if (normalized) days.add(normalized);
  }

  const ledgerDays = db.prepare(`
    SELECT DISTINCT business_day
    FROM money_ledger
    WHERE presale_id = ?
      AND status = 'POSTED'
      AND business_day IS NOT NULL
  `).all(presaleId);

  for (const row of ledgerDays) {
    const normalized = String(row?.business_day || '').trim();
    if (normalized) days.add(normalized);
  }

  if (days.size === 0) {
    const fallbackDay = getLocalBusinessDay();
    if (fallbackDay) days.add(fallbackDay);
  }

  for (const day of days) {
    assertShiftOpen(day);
  }

  return Array.from(days);
}
// ===== SLOT SEATS RECALC (TICKETS SOURCE OF TRUTH) =====
function recalcSlotSeatsLeft(db, boat_slot_id) {
  try {
    const capRow = db.prepare(`SELECT capacity FROM boat_slots WHERE id = ?`).get(boat_slot_id);
    if (!capRow) return;

    const usedTickets = db.prepare(`
      SELECT COUNT(*) as cnt
      FROM tickets
      WHERE boat_slot_id = ?
        AND status IN ('ACTIVE','PAID','UNPAID','RESERVED')
    `).get(boat_slot_id)?.cnt || 0;

    const seatsLeft = Math.max(0, (capRow.capacity || 0) - usedTickets);
    db.prepare(`UPDATE boat_slots SET seats_left = ? WHERE id = ?`).run(seatsLeft, boat_slot_id);
  } catch (e) {
    console.error('[RECALC seats_left]', e);
  }
}


// Helper function to validate time format
const validateTimeFormat = (time) => {
  // Check if time matches HH:MM format
  const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
  if (!timeRegex.test(time)) {
    return false;
  }
  
  // Extract hour and minute
  const [hour, minute] = time.split(':').map(Number);
  
  // Check if hour is in range 08-21
  if (hour < 8 || hour > 21) {
    return false;
  }
  
  // Check if minute is 00 or 30
  if (minute !== 0 && minute !== 30) {
    return false;
  }
  
  return true;
};

// Helper function to determine service type (boat vs banana) based on boat type
const getBoatServiceType = (boatType) => {
  if (boatType === 'banana') {
    return 'BANANA';
  } else {
    // All other types are considered boats
    return 'BOAT';
  }
};

// Helper function to validate ticket breakdown based on service type
const validateTicketBreakdown = (tickets, serviceType, capacity) => {
  if (!tickets) {
    return { valid: true };
  }
  
  const adult = tickets.adult || 0;
  const teen = tickets.teen || 0;
  const child = tickets.child || 0;
  
  // Validate that all values are non-negative integers
  if (!Number.isInteger(adult) || adult < 0 ||
      !Number.isInteger(teen) || teen < 0 ||
      !Number.isInteger(child) || child < 0) {
    return { valid: false, error: 'РљРѕР»РёС‡РµСЃС‚РІРѕ Р±РёР»РµС‚РѕРІ РґРѕР»Р¶РЅРѕ Р±С‹С‚СЊ РЅРµРѕС‚СЂРёС†Р°С‚РµР»СЊРЅС‹Рј С†РµР»С‹Рј С‡РёСЃР»РѕРј' };
  }
  
  const totalSeats = adult + teen + child;
  
  if (serviceType === 'BANANA') {
    // For banana: no teen tickets allowed
    if (teen > 0) {
      return { valid: false, error: 'Р”Р»СЏ Р±Р°РЅР°РЅР° РїРѕРґСЂРѕСЃС‚РєРѕРІС‹Рµ Р±РёР»РµС‚С‹ РЅРµРґРѕСЃС‚СѓРїРЅС‹' };
    }
    
    // For banana: capacity is always 12
    if (totalSeats > 12) {
      return { valid: false, error: 'Р”Р»СЏ Р±Р°РЅР°РЅР° РІРјРµСЃС‚РёРјРѕСЃС‚СЊ РЅРµ РјРѕР¶РµС‚ РїСЂРµРІС‹С€Р°С‚СЊ 12 РјРµСЃС‚' };
    }
  } else {
    // For boats: check against slot capacity
    if (totalSeats > capacity) {
      return { valid: false, error: `РљРѕР»РёС‡РµСЃС‚РІРѕ РјРµСЃС‚ РЅРµ РјРѕР¶РµС‚ РїСЂРµРІС‹С€Р°С‚СЊ РІРјРµСЃС‚РёРјРѕСЃС‚СЊ Р»РѕРґРєРё (${capacity})` };
    }
  }
  
  return { valid: true, totalSeats };
};

// Helper function to validate duration based on service type
const validateDuration = (duration, serviceType) => {
  if (serviceType === 'BANANA') {
    // For banana: duration must be 40 minutes
    if (duration !== 40) {
      return { valid: false, error: 'Р”Р»СЏ Р±Р°РЅР°РЅР° РґР»РёС‚РµР»СЊРЅРѕСЃС‚СЊ РґРѕР»Р¶РЅР° Р±С‹С‚СЊ 40 РјРёРЅСѓС‚' };
    }
  } else {
    // For boats: duration must be 60, 120, or 180 minutes
    if (duration && ![60, 120, 180].includes(duration)) {
      return { valid: false, error: 'Р”Р»СЏ Р»РѕРґРєРё РґР»РёС‚РµР»СЊРЅРѕСЃС‚СЊ РґРѕР»Р¶РЅР° Р±С‹С‚СЊ 60, 120 РёР»Рё 180 РјРёРЅСѓС‚' };
    }
  }
  
  return { valid: true };
};

// Helper function to resolve slot by UID for both manual and generated slots
const resolveSlotByUid = (slotUid, tripDate = null) => {
  console.log(`[RESOLVE_SLOT_START] slotUid=${slotUid}, tripDate=${tripDate}`);
  // Extract the type and id from slotUid
  let slotId, slotType;
  
  if (typeof slotUid !== 'string') {
    throw new Error('SLOT_UID_INVALID: slotUid must be a string');
  }
  
  if (slotUid.startsWith('manual:')) {
    slotType = 'manual';
    slotId = parseInt(slotUid.substring(7));
  } else if (slotUid.startsWith('generated:')) {
    slotType = 'generated';
    slotId = parseInt(slotUid.substring(10));
  } else {
    throw new Error('SLOT_UID_INVALID: slotUid must be manual:<id> or generated:<id>');
  }
  
  if (isNaN(slotId)) {
    throw new Error('SLOT_UID_INVALID: slotUid must be manual:<id> or generated:<id>');
  }
  
  // Query the appropriate table based on slot type
  let slotInfo = null;
  
  if (slotType === 'manual') {
    // Query boat_slots table with boat info
    slotInfo = db.prepare(`
      SELECT bs.id, bs.boat_id, bs.time, bs.price, bs.capacity, bs.seats_left,
             bs.duration_minutes, bs.is_active, bs.price_adult, bs.price_child, bs.price_teen,
             bss.seller_cutoff_minutes, bss.dispatcher_cutoff_minutes,
             b.name as boat_name, b.type as boat_type, b.is_active as boat_is_active
      FROM boat_slots bs
      JOIN boats b ON bs.boat_id = b.id
      LEFT JOIN boat_settings bss ON bss.boat_id = bs.boat_id
      WHERE bs.id = ?
    `).get(slotId);
  } else if (slotType === 'generated') {
    // For generated slots, we need to check both ID and date to avoid picking wrong day's slot
    let query;
    let queryParams;
    
    if (tripDate) {
      // Query with both ID and date for precise matching
      query = `
        SELECT gs.id, gs.boat_id, gs.time, gs.price_adult as price, gs.capacity,
        CASE
          WHEN gs.seats_left IS NULL THEN gs.capacity
          WHEN gs.seats_left = 0 AND (
            SELECT COUNT(*)
            FROM tickets t
            JOIN presales p ON p.id = t.presale_id
            WHERE p.slot_uid = ('generated:' || gs.id)
              AND t.status IN ('ACTIVE','USED')
              AND p.status NOT IN ('CANCELLED','CANCELLED_TRIP_PENDING','REFUNDED')
          ) = 0 THEN gs.capacity
          ELSE gs.seats_left
        END as seats_left,
               gs.duration_minutes, gs.is_active, gs.price_adult, gs.price_child, gs.price_teen,
               bss.seller_cutoff_minutes, bss.dispatcher_cutoff_minutes, gs.trip_date,
               b.name as boat_name, b.type as boat_type, b.is_active as boat_is_active
        FROM generated_slots gs
        JOIN boats b ON gs.boat_id = b.id
        LEFT JOIN boat_settings bss ON bss.boat_id = gs.boat_id
        WHERE gs.id = ? AND gs.trip_date = ?
      `;
      queryParams = [slotId, tripDate];
    } else {
      // Fallback to ID-only query (backward compatibility)
      query = `
        SELECT gs.id, gs.boat_id, gs.time, gs.price_adult as price, gs.capacity,
        CASE
          WHEN gs.seats_left IS NULL THEN gs.capacity
          WHEN gs.seats_left = 0 AND (
            SELECT COUNT(*)
            FROM tickets t
            JOIN presales p ON p.id = t.presale_id
            WHERE p.slot_uid = ('generated:' || gs.id)
              AND t.status IN ('ACTIVE','USED')
              AND p.status NOT IN ('CANCELLED','CANCELLED_TRIP_PENDING','REFUNDED')
          ) = 0 THEN gs.capacity
          ELSE gs.seats_left
        END as seats_left,
               gs.duration_minutes, gs.is_active, gs.price_adult, gs.price_child, gs.price_teen,
               bss.seller_cutoff_minutes, bss.dispatcher_cutoff_minutes, gs.trip_date,
               b.name as boat_name, b.type as boat_type, b.is_active as boat_is_active
        FROM generated_slots gs
        JOIN boats b ON gs.boat_id = b.id
        LEFT JOIN boat_settings bss ON bss.boat_id = gs.boat_id
        WHERE gs.id = ?
      `;
      queryParams = [slotId];
    }
    
    slotInfo = db.prepare(query).get(...queryParams);

    // DEBUG LOG for seller-dispatcher-sync tests
    if (slotType === 'generated' && slotId <= 2) {
      console.log(`[RESOLVE_SLOT_DEBUG] slotId=${slotId}, tripDate=${tripDate}, seats_left_raw=${slotInfo?.seats_left}, capacity=${slotInfo?.capacity}`);
    }

    
    // If we required a specific date but didn't find a match, throw specific error
    if (tripDate && !slotInfo) {
      throw new Error(`SLOT_DATE_MISMATCH: Generated slot ${slotId} not found for date ${tripDate}`);
    }
  }
  
  if (!slotInfo) {
    throw new Error(`SLOT_NOT_FOUND: Slot not found for slotUid=${slotUid}`);
  }
  
  // Return the slot information with source type
  return {
    source_type: slotType,
    slot_id: slotInfo.id,
    boat_id: slotInfo.boat_id,
    time: slotInfo.time,
    trip_date: slotInfo.trip_date, // May be null for manual slots
    price: slotInfo.price,
    // IMPORTANT: needed for correct ticket category pricing (adult/teen/child)
    // If the slot has per-category prices, we must expose them to callers.
    price_adult: slotInfo.price_adult ?? null,
    price_teen: slotInfo.price_teen ?? null,
    price_child: slotInfo.price_child ?? null,
    capacity: slotInfo.capacity,
    seats_left: slotInfo.seats_left,
    duration_minutes: slotInfo.duration_minutes,
    is_active: slotInfo.is_active,
    seller_cutoff_minutes: slotInfo.seller_cutoff_minutes,
    dispatcher_cutoff_minutes: slotInfo.dispatcher_cutoff_minutes,
    boat_name: slotInfo.boat_name,
    boat_type: slotInfo.boat_type,
    boat_is_active: slotInfo.boat_is_active
  };
};

// Middleware to check if user can dispatch manage slots
// Using imported canDispatchManageSlots from auth.js

const router = Router();
// Allow both sellers and dispatchers to use shared selling routes
function canSellOrDispatch(req, res, next) {
  const role = req.user?.role;
  if (role === 'seller' || role === 'dispatcher' || role === 'admin' || role === 'owner') return next();
  return res.status(403).json({ error: 'Forbidden' });
}

function getSlotTargetFromPresale(presale) {
  const slotUid = presale?.slot_uid || '';
  if (slotUid.startsWith('generated:')) {
    const id = Number(slotUid.split(':')[1]);
    return { type: 'generated', id };
  }
  // default to manual slot using boat_slot_id
  return { type: 'manual', id: Number(presale?.boat_slot_id) };
}

function restoreSeatsForPresale(presale) {
  const seats = Number(presale?.number_of_seats || 0);
  if (!seats) return;
  const target = getSlotTargetFromPresale(presale);

  if (target.type === 'generated') {
    db.prepare(`
      UPDATE generated_slots
      SET seats_left = MIN(capacity, COALESCE(seats_left, capacity) + ?)
      WHERE id = ?
    `).run(seats, target.id);
    return;
  }

  db.prepare(`
    UPDATE boat_slots
    SET seats_left = MIN(capacity, COALESCE(seats_left, capacity) + ?)
    WHERE id = ?
  `).run(seats, target.id);
}



// Add route to get all active boats
router.get('/boats', authenticateToken, canSell, (req, res) => {
  try {
    const boats = db.prepare(`
      SELECT id, name, type, NULL AS capacity, is_active
      FROM boats 
      WHERE is_active = 1
      ORDER BY type, name
    `).all();
    
    res.json(boats);
  } catch (error) {
    console.error('[SELLING_500] route=/api/selling/boats message=', error.message, 'stack=', error.stack);
    res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
  }
});

// Track if we've logged the database path for selling requests
let hasLoggedSellingDbPath = false;

// Get slots for a specific boat type
router.get('/boats/:type/slots', authenticateToken, canSell, (req, res) => {
  try {
    const boatType = req.params.type.trim().toLowerCase();
    
    // Validate boat type
    if (!['speed', 'cruise', 'banana'].includes(boatType)) {
      return res.status(400).json({ error: 'РќРµРґРѕРїСѓСЃС‚РёРјС‹Р№ С‚РёРї Р»РѕРґРєРё' });
    }
    
    // [SELLER_ZERO_DEBUG] TEMPORARY diagnostics - run BEFORE returning response
    console.log(`[SELLER_ZERO_DEBUG] Request for boat type: ${boatType}`);
    
    // Log database path on first request
    if (!hasLoggedSellingDbPath) {
      const dbPath = getDatabaseFilePath();
      console.log(`[DB_PATH_SELLING] ${dbPath}`);
      hasLoggedSellingDbPath = true;
    }
    
    // COUNT boats of requested type (normalized)
    const totalBoatsCount = db.prepare(`
      SELECT COUNT(*) as count 
      FROM boats 
      WHERE TRIM(LOWER(type)) = ?
    `).get(boatType).count;
    console.log(`[SELLER_ZERO_DEBUG] Total boats of type '${boatType}': ${totalBoatsCount}`);
    
    // COUNT active boats of requested type
    const activeBoatsCount = db.prepare(`
      SELECT COUNT(*) as count 
      FROM boats 
      WHERE TRIM(LOWER(type)) = ?
        AND CAST(is_active AS INTEGER) = 1
    `).get(boatType).count;
    console.log(`[SELLER_ZERO_DEBUG] Active boats of type '${boatType}': ${activeBoatsCount}`);
    
    // COUNT slots joined to boats of requested type (no active/seats filters)
    const totalManualSlotsCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM boat_slots bs
      JOIN boats b ON bs.boat_id = b.id
      WHERE TRIM(LOWER(b.type)) = ?
    `).get(boatType).count;
    
    const totalGeneratedSlotsCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM generated_slots gs
      JOIN boats b ON gs.boat_id = b.id
      WHERE TRIM(LOWER(b.type)) = ?
    `).get(boatType).count;
    
    console.log(`[SELLER_ZERO_DEBUG] Total manual slots for boats of type '${boatType}': ${totalManualSlotsCount}`);
    console.log(`[SELLER_ZERO_DEBUG] Total generated slots for boats of type '${boatType}': ${totalGeneratedSlotsCount}`);
    
    // COUNT active slots
    const activeManualSlotsCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM boat_slots bs
      JOIN boats b ON bs.boat_id = b.id
      WHERE TRIM(LOWER(b.type)) = ?
        AND CAST(b.is_active AS INTEGER) = 1
        AND CAST(bs.is_active AS INTEGER) = 1
    `).get(boatType).count;
    
    const activeGeneratedSlotsCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM generated_slots gs
      JOIN boats b ON gs.boat_id = b.id
      WHERE TRIM(LOWER(b.type)) = ?
        AND CAST(gs.is_active AS INTEGER) = 1
    `).get(boatType).count;
    
    console.log(`[SELLER_ZERO_DEBUG] Active manual slots for active boats of type '${boatType}': ${activeManualSlotsCount}`);
    console.log(`[SELLER_ZERO_DEBUG] Active generated slots for active boats of type '${boatType}': ${activeGeneratedSlotsCount}`);
    
    // COUNT slots after seats filter (COALESCE > 0)
    const availableManualSlotsCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM boat_slots bs
      JOIN boats b ON bs.boat_id = b.id
      WHERE TRIM(LOWER(b.type)) = ?
        AND CAST(b.is_active AS INTEGER) = 1
        AND CAST(bs.is_active AS INTEGER) = 1
        AND COALESCE(bs.seats_left, bs.capacity) > 0
    `).get(boatType).count;
    
    const availableGeneratedSlotsCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM generated_slots gs
      JOIN boats b ON gs.boat_id = b.id
      WHERE TRIM(LOWER(b.type)) = ?
        AND CAST(gs.is_active AS INTEGER) = 1
        AND COALESCE(gs.seats_left, gs.capacity) > 0
    `).get(boatType).count;
    
    console.log(`[SELLER_ZERO_DEBUG] Available manual slots (COALESCE > 0) for type '${boatType}': ${availableManualSlotsCount}`);
    console.log(`[SELLER_ZERO_DEBUG] Available generated slots (COALESCE > 0) for type '${boatType}': ${availableGeneratedSlotsCount}`);
    
    // Get active slots for active boats of the specified type with available seats
    // IMPORTANT: seats_left is calculated from active tickets, NOT from generated_slots.seats_left column
    // This ensures consistency between seller and dispatcher views
    const rawSlots = db.prepare(`
      SELECT
        gs.id as slot_id,
        ('generated:' || gs.id) as slot_uid,
        gs.id,
        gs.boat_id,
        gs.time,
        gs.price_adult as price,
        gs.capacity,
        gs.seats_left as seats_left_cache,
        (gs.capacity - COALESCE(ticket_counts.active_tickets, 0)) as seats_left,
        gs.duration_minutes,
        gs.price_adult,
        gs.price_child,
        gs.price_teen,
        (gs.capacity - COALESCE(ticket_counts.active_tickets, 0)) as available_seats,
        b.name AS boat_name,
        b.type AS boat_type,
        gs.capacity AS boat_capacity,
        'generated' AS source_type,
        gs.trip_date
      FROM generated_slots gs
      JOIN boats b ON gs.boat_id = b.id
      LEFT JOIN (
        SELECT
          p.slot_uid,
          COUNT(*) as active_tickets
        FROM tickets t
        JOIN presales p ON t.presale_id = p.id
        WHERE t.status IN ('ACTIVE','PAID','UNPAID','RESERVED','PARTIALLY_PAID','CONFIRMED','USED')
        GROUP BY p.slot_uid
      ) ticket_counts ON ('generated:' || gs.id) = ticket_counts.slot_uid
      WHERE TRIM(LOWER(b.type)) = ?
        AND CAST(gs.is_active AS INTEGER) = 1
        AND (
          -- For future dates, show all trips
          gs.trip_date > date('now')
          OR
          -- For today's trips, only show if departure time is more than 10 minutes from now
          (gs.trip_date = date('now') AND time(gs.time) > time(datetime('now', '+10 minutes')))
        )
      ORDER BY gs.trip_date, gs.time
    `).all(boatType);
    const slots = applyTelegramHoldVisibilityToSlots(rawSlots);
    
    console.log(`[SELLER_ZERO_DEBUG] Final slots returned: ${slots.length}`);
    
    // Get metadata
    const metadataActiveBoatsCount = db.prepare(`
      SELECT COUNT(*) as count 
      FROM boats 
      WHERE TRIM(LOWER(type)) = ?
        AND CAST(is_active AS INTEGER) = 1
    `).get(boatType).count;
    
    const activeSlotsResponseCount = slots.length;
    
    const meta = {
      activeBoatsSpeed: boatType === 'speed' ? metadataActiveBoatsCount : 0,
      activeBoatsCruise: boatType === 'cruise' ? metadataActiveBoatsCount : 0,
      activeBoatsBanana: boatType === 'banana' ? metadataActiveBoatsCount : 0,
      activeSlotsSpeed: boatType === 'speed' ? activeSlotsResponseCount : 0,
      activeSlotsCruise: boatType === 'cruise' ? activeSlotsResponseCount : 0,
      activeSlotsBanana: boatType === 'banana' ? activeSlotsResponseCount : 0
    };
    
    res.json({
      slots,
      meta
    });
  } catch (error) {
    console.error('[SELLING_500] route=/api/selling/boats/:type/slots type=' + req.params.type + ' message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
  }
});

// PRESALE ENDPOINTS

// Create a new presale
router.post('/presales', authenticateToken, canSell, async (req, res) => {
  console.log('[PRESALE_CREATE_START] slotUid=', req.body?.slotUid, 'seats=', req.body?.numberOfSeats, 'user=', req.user?.username, 'role=', req.user?.role);
  try {
    const { slotUid, customerName, customerPhone, numberOfSeats, prepaymentAmount, prepaymentComment, sellerId } = req.body;
    
    // Validate required fields - slotUid is now required
    if (!slotUid) {
      return res.status(400).json({ 
        ok: false,
        code: 'SLOT_UID_REQUIRED', 
        message: 'slotUid is required' 
      });
    }
    
    if (!customerName || !customerPhone || !numberOfSeats) {
      if (!customerName || customerName.trim().length === 0) {
        return res.status(400).json({ 
          ok: false,
          code: 'CUSTOMER_NAME_REQUIRED',
          message: 'РўСЂРµР±СѓРµС‚СЃСЏ РёРјСЏ РєР»РёРµРЅС‚Р°' 
        });
      }
      if (!customerPhone || customerPhone.trim().length === 0) {
        return res.status(400).json({ 
          ok: false,
          code: 'CUSTOMER_PHONE_REQUIRED',
          message: 'РўСЂРµР±СѓРµС‚СЃСЏ РЅРѕРјРµСЂ С‚РµР»РµС„РѕРЅР° РєР»РёРµРЅС‚Р°' 
        });
      }
      return res.status(400).json({ 
        ok: false,
        code: 'MISSING_REQUIRED_FIELDS',
        message: 'РћС‚СЃСѓС‚СЃС‚РІСѓСЋС‚ РѕР±СЏР·Р°С‚РµР»СЊРЅС‹Рµ РїРѕР»СЏ' 
      });
    }
    
    // Validate data types
    if (typeof customerName !== 'string' || customerName.trim().length < 2) {
      return res.status(400).json({ 
        ok: false,
        code: 'INVALID_CUSTOMER_NAME',
        message: 'РРјСЏ РєР»РёРµРЅС‚Р° РґРѕР»Р¶РЅРѕ СЃРѕРґРµСЂР¶Р°С‚СЊ РЅРµ РјРµРЅРµРµ 2 СЃРёРјРІРѕР»РѕРІ' 
      });
    }
    
    if (typeof customerPhone !== 'string' || customerPhone.trim().length < 5) {
      return res.status(400).json({ 
        ok: false,
        code: 'INVALID_CUSTOMER_PHONE',
        message: 'РќРѕРјРµСЂ С‚РµР»РµС„РѕРЅР° РєР»РёРµРЅС‚Р° РґРѕР»Р¶РµРЅ СЃРѕРґРµСЂР¶Р°С‚СЊ РЅРµ РјРµРЅРµРµ 5 СЃРёРјРІРѕР»РѕРІ' 
      });
    }
    
    // Input parsing & validation (BEFORE transaction)
    // Check if tickets breakdown is provided
    let seats;
    let ticketsJson = null;
    
    if (req.body.tickets) {
      // Use ticket breakdown instead of numberOfSeats
      const tickets = req.body.tickets;
      
      // Validate ticket structure
      if (typeof tickets !== 'object' || tickets === null) {
        return res.status(400).json({ 
          ok: false,
          code: 'INVALID_TICKET_STRUCTURE',
          message: 'РќРµРєРѕСЂСЂРµРєС‚РЅР°СЏ СЃС‚СЂСѓРєС‚СѓСЂР° Р±РёР»РµС‚РѕРІ' 
        });
      }
      
      // Normalize missing ticket types to 0
      const adult = Number(tickets.adult) || 0;
      const teen = Number(tickets.teen) || 0;
      const child = Number(tickets.child) || 0;
      
      // Validate non-negative integer values
      if (!Number.isInteger(adult) || adult < 0 ||
          !Number.isInteger(teen) || teen < 0 ||
          !Number.isInteger(child) || child < 0) {
        return res.status(400).json({ 
          ok: false,
          code: 'INVALID_TICKET_COUNT',
          message: 'РљРѕР»РёС‡РµСЃС‚РІРѕ Р±РёР»РµС‚РѕРІ РґРѕР»Р¶РЅРѕ Р±С‹С‚СЊ РЅРµРѕС‚СЂРёС†Р°С‚РµР»СЊРЅС‹Рј С†РµР»С‹Рј С‡РёСЃР»РѕРј' 
        });
      }
      
      // Calculate total seats from tickets
      seats = adult + teen + child;
      
      // Store the tickets breakdown as JSON
      ticketsJson = JSON.stringify({ adult, teen, child });
      
      // Validate total seats is at least 1
      if (seats < 1) {
        return res.status(400).json({ 
          ok: false,
          code: 'INVALID_SEAT_COUNT',
          message: 'РљРѕР»РёС‡РµСЃС‚РІРѕ РјРµСЃС‚ РґРѕР»Р¶РЅРѕ Р±С‹С‚СЊ РЅРµ РјРµРЅРµРµ 1' 
        });
      }
    } else {
      // Use the original numberOfSeats approach
      seats = Number(numberOfSeats);
      if (!Number.isInteger(seats) || seats < 1) {
        return res.status(400).json({ 
          ok: false,
          code: 'INVALID_SEAT_COUNT',
          message: 'РќРµРєРѕСЂСЂРµРєС‚РЅРѕРµ РєРѕР»РёС‡РµСЃС‚РІРѕ РјРµСЃС‚' 
        });
      }
    }

    
    const prepayment = parseInt(prepaymentAmount) || 0;
    if (isNaN(prepayment) || prepayment < 0) {
      return res.status(400).json({ 
        ok: false,
        code: 'INVALID_PREPAYMENT_AMOUNT',
        message: 'Invalid prepayment amount' 
      });
    }

    // Payment method for the prepayment part (needed for correct owner cash/card analytics)
    // Accept: CASH / CARD / MIXED
    const rawPaymentMethod = req.body?.payment_method ?? req.body?.paymentMethod ?? req.body?.method ?? null;
    let paymentMethodUpper = rawPaymentMethod ? String(rawPaymentMethod).trim().toUpperCase() : null;
    if (paymentMethodUpper === 'CASH' || paymentMethodUpper === 'CARD' || paymentMethodUpper === 'MIXED') {
      // ok
    } else if (paymentMethodUpper === 'CASHLESS') {
      paymentMethodUpper = 'CARD';
    } else if (paymentMethodUpper) {
      // allow lowercase 'cash'/'card' too
      if (paymentMethodUpper === 'CASH' || paymentMethodUpper === 'CARD') {
        // ok
      } else {
        return res.status(400).json({ ok: false, code: 'INVALID_PAYMENT_METHOD', message: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ СЃРїРѕСЃРѕР± РѕРїР»Р°С‚С‹' });
      }
    }

    let paymentCashAmount = 0;
    let paymentCardAmount = 0;

    if (prepayment > 0) {
      // Backward compatibility: some dispatcher/seller UIs send only prepaymentAmount.
      // In that case, default to CASH so Owner cash/card/pending stay consistent.
      if (!paymentMethodUpper) {
        paymentMethodUpper = 'CASH';
      }

      if (paymentMethodUpper === 'CASH') {
        paymentCashAmount = prepayment;
      } else if (paymentMethodUpper === 'CARD') {
        paymentCardAmount = prepayment;
      } else {
        // MIXED
        const ca = Number(req.body?.cash_amount ?? req.body?.cashAmount ?? 0);
        const cr = Number(req.body?.card_amount ?? req.body?.cardAmount ?? 0);
        if (!Number.isFinite(ca) || !Number.isFinite(cr) || ca < 0 || cr < 0) {
          return res.status(400).json({ ok: false, code: 'INVALID_PAYMENT_SPLIT', message: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ СЃСѓРјРјС‹ РґР»СЏ РєРѕРјР±Рѕ' });
        }
        if (Math.round(ca + cr) !== Math.round(prepayment)) {
          return res.status(400).json({ ok: false, code: 'INVALID_PAYMENT_SPLIT', message: 'РЎСѓРјРјР° РќРђР› + РљРђР РўРђ РґРѕР»Р¶РЅР° Р±С‹С‚СЊ СЂР°РІРЅР° РїСЂРµРґРѕРїР»Р°С‚Рµ' });
        }
        if (ca === 0 || cr === 0) {
          return res.status(400).json({ ok: false, code: 'INVALID_PAYMENT_SPLIT', message: 'Р”Р»СЏ РєРѕРјР±Рѕ СѓРєР°Р¶Рё СЃСѓРјРјС‹ Рё РґР»СЏ РЅР°Р»РёС‡РєРё, Рё РґР»СЏ РєР°СЂС‚С‹' });
        }
        paymentCashAmount = Math.round(ca);
        paymentCardAmount = Math.round(cr);
      }
    } else {
      // no prepayment => don't persist payment method
      paymentMethodUpper = null;
    }
    
    // Extract trip date from request body (accept both trip_date and tripDate)
    const tripDate = req.body.trip_date || req.body.tripDate || null;
    
    // Resolve the slot by UID to get slot information
    let resolvedSlot;
    try {
      resolvedSlot = resolveSlotByUid(slotUid, tripDate);
    } catch (slotResolutionError) {
      // Check if it's our custom error
      if (slotResolutionError.message.includes('SLOT_DATE_MISMATCH')) {
        // Extract slot ID and date from error message for debug info
        const match = slotResolutionError.message.match(/Generated slot (\d+) not found for date (.+)/);
        const errorSlotId = match ? match[1] : null;
        const errorTripDate = match ? match[2] : null;
        
        return res.status(400).json({ 
          ok: false,
          code: 'SLOT_DATE_MISMATCH',
          message: 'Generated slot not found for given date',
          debug: { 
            slotUid, 
            trip_date: tripDate,
            error_details: {
              slotId: errorSlotId,
              requestedDate: errorTripDate
            }
          }
        });
      } else if (slotResolutionError.message.includes('SLOT_NOT_FOUND')) {
        return res.status(404).json({ 
          ok: false,
          code: 'SLOT_NOT_FOUND',
          message: `Slot not found for slotUid=${slotUid}`,
          debug: { slotUid }
        });
      } else if (slotResolutionError.message.includes('SLOT_UID_INVALID')) {
        return res.status(400).json({ 
          ok: false,
          code: 'SLOT_UID_INVALID',
          message: slotResolutionError.message
        });
      } else {
        // Generic error
        return res.status(400).json({ 
          ok: false,
          code: 'SLOT_RESOLUTION_ERROR',
          message: slotResolutionError.message
        });
      }
    }
    
    // Check if slot is active
    if (resolvedSlot.is_active !== 1 || resolvedSlot.boat_is_active !== 1) {
      const debugInfo = {
        slotUid,
        trip_date: resolvedSlot.trip_date,
        trip_time: resolvedSlot.time,
        tripStart: resolvedSlot.trip_date ? new Date(`${resolvedSlot.trip_date} ${resolvedSlot.time}`).toISOString() : null,
        now: new Date().toISOString(),
        serverTimezoneHint: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
        userRole: req.user.role
      };
      
      // Log debug information to console
      console.log('[TRIP_CLOSED_BY_TIME_DEBUG]', debugInfo);
      
      return res.status(403).json({ 
        ok: false,
        code: 'TRIP_CLOSED_BY_TIME',
        message: 'Boat or slot is not active',
        debug: debugInfo
      });
    }
    
    // Role-based time validation: check cutoff times based on user role
    const userRole = req.user.role;
    
    if (resolvedSlot.source_type === 'generated') {
      // For generated slots, check appropriate cutoff based on user role
      let cutoffMinutes = null;
      let isCutoffApplicable = false;
      
      if (userRole === 'seller' && resolvedSlot.seller_cutoff_minutes !== null && resolvedSlot.seller_cutoff_minutes > 0) {
        cutoffMinutes = resolvedSlot.seller_cutoff_minutes;
        isCutoffApplicable = true;
      } else if (userRole === 'dispatcher' && resolvedSlot.dispatcher_cutoff_minutes !== null && resolvedSlot.dispatcher_cutoff_minutes > 0) {
        cutoffMinutes = resolvedSlot.dispatcher_cutoff_minutes;
        isCutoffApplicable = true;
      }
      
      if (isCutoffApplicable) {
        // Calculate the cutoff time (departure time - cutoff_minutes) for proper comparison
        const cutoffDateTime = db.prepare(`
          SELECT datetime(trip_date || ' ' || time, '-' || ? || ' minutes') as cutoff_time
          FROM generated_slots 
          WHERE id = ?
        `).get(cutoffMinutes, resolvedSlot.slot_id);
        
        // Compare with current datetime to see if trip is too close
        const now = db.prepare("SELECT datetime(\'now\') as current_time").get();
        
        // Add debug logging to see the actual values
        console.log('[TRIP_TIME_CHECK] cutoffDateTime:', cutoffDateTime, 'now:', now, 'isCutoffApplicable:', isCutoffApplicable, 'cutoffMinutes:', cutoffMinutes);
        
        if (cutoffDateTime.cutoff_time <= now.current_time) {
          const nowDate = new Date();
          const tripDate = new Date(`${resolvedSlot.trip_date}T${resolvedSlot.time}`);
          
          // Create datetime for debug purposes
          const tripStart = new Date(`${resolvedSlot.trip_date} ${resolvedSlot.time}`).toISOString();
          const serverNow = new Date().toISOString();
          
          const debugInfo = {
            slotUid,
            trip_date: resolvedSlot.trip_date,
            trip_time: resolvedSlot.time,
            tripStart,
            now: serverNow,
            serverTimezoneHint: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
            userRole
          };
          
          // Log debug information to console
          console.log('[TRIP_CLOSED_BY_TIME_DEBUG]', debugInfo);
          
          return res.status(403).json({
            ok: false,
            code: 'TRIP_CLOSED_BY_TIME',
            message: `trip closed (${userRole} cutoff)`,
            debug: debugInfo
          });
        }
      }
    } else {
      // For manual slots, check appropriate cutoff based on user role
      let cutoffMinutes = null;
      let isCutoffApplicable = false;
      
      if (userRole === 'seller' && resolvedSlot.seller_cutoff_minutes !== null && resolvedSlot.seller_cutoff_minutes > 0) {
        cutoffMinutes = resolvedSlot.seller_cutoff_minutes;
        isCutoffApplicable = true;
      } else if (userRole === 'dispatcher' && resolvedSlot.dispatcher_cutoff_minutes !== null && resolvedSlot.dispatcher_cutoff_minutes > 0) {
        cutoffMinutes = resolvedSlot.dispatcher_cutoff_minutes;
        isCutoffApplicable = true;
      }
      
      if (isCutoffApplicable) {
        // Calculate the actual cutoff time for the current day
        const cutoffForToday = db.prepare(`
          SELECT datetime(date('now') || ' ' || time, '-' || ? || ' minutes') as cutoff_time
          FROM boat_slots 
          WHERE id = ?
        `).get(cutoffMinutes, resolvedSlot.slot_id);
        
        // Get the current datetime for comparison
        const now = db.prepare("SELECT datetime(\'now\') as current_time").get();
        
        // Compare with current datetime to see if trip is too close
        if (cutoffForToday.cutoff_time <= now.current_time) {
          // If the current time is at or past the cutoff time, the trip is closed
          const nowDate = new Date();
          
          // Create datetime for debug purposes
          const tripDate = resolvedSlot.trip_date || new Date().toISOString().split('T')[0]; // Use today's date for manual slots
          const tripStart = new Date(`${tripDate} ${resolvedSlot.time}`).toISOString();
          const serverNow = new Date().toISOString();
          
          const debugInfo = {
            slotUid,
            trip_date: tripDate,
            trip_time: resolvedSlot.time,
            tripStart,
            now: serverNow,
            serverTimezoneHint: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
            userRole
          };
          
          // Log debug information to console
          console.log('[TRIP_CLOSED_BY_TIME_DEBUG]', debugInfo);
          
          return res.status(403).json({
            ok: false,
            code: 'TRIP_CLOSED_BY_TIME',
            message: `trip closed (${userRole} cutoff)`,
            debug: debugInfo
          });
        }
      }
    }
    
    // Determine service type based on boat type
    const serviceType = getBoatServiceType(resolvedSlot.boat_type);
    
    // Validate ticket breakdown if provided
    if (req.body.tickets) {
      const validation = validateTicketBreakdown(req.body.tickets, serviceType, resolvedSlot.capacity);
      if (!validation.valid) {
        return res.status(400).json({
          ok: false,
          code: 'INVALID_TICKET_BREAKDOWN',
          message: validation.error
        });
      }
      
      // Use the calculated total seats from validation
      seats = validation.totalSeats;
    } else {
      // Validate seats against capacity for the old flow
      if (seats > resolvedSlot.capacity) {
        return res.status(400).json({
          ok: false,
          code: 'SEAT_CAPACITY_EXCEEDED',
          message: `РљРѕР»РёС‡РµСЃС‚РІРѕ РјРµСЃС‚ РЅРµ РјРѕР¶РµС‚ РїСЂРµРІС‹С€Р°С‚СЊ РІРјРµСЃС‚РёРјРѕСЃС‚СЊ Р»РѕРґРєРё (${resolvedSlot.capacity})`
        });
      }
            
      // For banana type with old flow, ensure we're not selling teen tickets
      if (resolvedSlot.boat_type === 'banana' && !req.body.tickets) {
        // In the old flow, all seats are treated as adult tickets for banana
        // This is allowed since adult tickets are permitted for banana
      }
    }
    

    // Sales time windows:
    // - seller: sales are CLOSED starting 10 minutes before trip start
    // - dispatcher: sales are CLOSED starting 10 minutes AFTER trip start
    // (admin/owner are not restricted here; only enforce for seller/dispatcher)
    if (resolvedSlot?.trip_date && resolvedSlot?.time) {
      const tripStart = new Date(`${resolvedSlot.trip_date}T${resolvedSlot.time}:00`);
      const now = new Date();
      const role = req.user?.role;

      console.log(`[SALES_TIME_CHECK] tripStart=${tripStart.toISOString()}, now=${now.toISOString()}, role=${role}`);

      if (role === 'seller') {
        const closeAt = new Date(tripStart.getTime() - 10 * 60 * 1000);
        console.log(`[SALES_TIME_CHECK] seller closeAt=${closeAt.toISOString()}, now>=closeAt? ${now >= closeAt}`);
        if (now >= closeAt) {
          console.log(`[SALES_CLOSED] Seller sales closed for slot ${slotUid}`);
          return res.status(409).json({
            ok: false,
            code: 'SALES_CLOSED',
            message: 'РџСЂРѕРґР°Р¶Рё Р·Р°РєСЂС‹С‚С‹ Р·Р° 10 РјРёРЅСѓС‚ РґРѕ СЃС‚Р°СЂС‚Р° СЂРµР№СЃР°'
          });
        }
      }

      if (role === 'dispatcher') {
        const closeAt = new Date(tripStart.getTime() + 10 * 60 * 1000);
        if (now > closeAt) {
          return res.status(409).json({
            ok: false,
            code: 'SALES_CLOSED',
            message: 'РџСЂРѕРґР°Р¶Рё Р·Р°РєСЂС‹С‚С‹ С‡РµСЂРµР· 10 РјРёРЅСѓС‚ РїРѕСЃР»Рµ СЃС‚Р°СЂС‚Р° СЂРµР№СЃР°'
          });
        }
      }
    }

    // Check if there are enough seats available
    console.log(`[PRESALE_CAPACITY_CHECK] slotUid=${slotUid}, resolvedSlot.seats_left=${resolvedSlot.seats_left}, seats=${seats}`);
    if (resolvedSlot.seats_left < seats) {
      console.log(`[PRESALE_CAPACITY_FAIL] BEFORE TRANSACTION: seats_left ${resolvedSlot.seats_left} < requested ${seats}`);
      return res.status(409).json({
        ok: false,
        code: 'NO_SEATS',
        message: 'РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ РјРµСЃС‚'
      });
    }
    
    // Calculate total price.
// If ticket breakdown is provided (ticketsJson), use per-type prices for ALL boat types.
// Otherwise fall back to legacy "slot price * seats".
let calculatedTotalPrice = 0;

const boatDefaults = db.prepare('SELECT price_adult, price_child, price_teen FROM boats WHERE id = ?').get(resolvedSlot.boat_id);

// Price inheritance priority:
// 1) generated slot fields (price_adult/teen/child or legacy price)
// 2) boat defaults (price_adult/teen/child)
// 3) legacy slot.price
const legacyBase = resolvedSlot.price || 0;

const adultPrice = (resolvedSlot.price_adult ?? 0) || (boatDefaults?.price_adult ?? 0) || legacyBase;
const teenPrice  = (resolvedSlot.price_teen  ?? 0) || (boatDefaults?.price_teen  ?? 0) || legacyBase;
const childPrice = (resolvedSlot.price_child ?? 0) || (boatDefaults?.price_child ?? 0) || legacyBase;

let breakdown = null;
if (ticketsJson) {
  try {
    breakdown = JSON.parse(ticketsJson);
  } catch {
    breakdown = null;
  }
}

if (breakdown) {
  const adultTickets = parseInt(breakdown.adult || 0) || 0;
  const teenTickets  = parseInt(breakdown.teen  || 0) || 0;
  const childTickets = parseInt(breakdown.child || 0) || 0;

  calculatedTotalPrice = (adultTickets * adultPrice) + (teenTickets * teenPrice) + (childTickets * childPrice);
} else {
  // Legacy flow: single price per seat (keep backwards compatibility)
  const slotPrice = (resolvedSlot.price ?? 0) || (boatDefaults?.price_adult ?? 0) || 0;
  calculatedTotalPrice = slotPrice * seats;
}
    
    // Validate prepayment amount
    if (prepayment > calculatedTotalPrice) {
      return res.status(400).json({ 
        ok: false,
        code: 'PREPAYMENT_EXCEEDS_TOTAL',
        message: 'Prepayment amount cannot exceed total price' 
      });
    }
    
    // Validate sellerId for dispatcher role
    if (req.user?.role === 'dispatcher' && sellerId != null) {
      const sellerIdNum = Number(sellerId);
      if (!Number.isFinite(sellerIdNum) || sellerIdNum <= 0) {
        return res.status(400).json({
          ok: false,
          code: 'INVALID_SELLER_ID',
          message: 'Нельзя оформить продажу: выбранный продавец недоступен'
        });
      }
    
      const sellerRow = db.prepare(`
        SELECT id FROM users 
        WHERE id = ? AND role = 'seller' AND is_active = 1
      `).get(sellerIdNum);
    
      if (!sellerRow) {
        console.error('[PRESALE_CREATE] Invalid seller_id:', { sellerId: sellerIdNum, dispatcher: req.user?.id });
        return res.status(400).json({
          ok: false,
          code: 'SELLER_NOT_FOUND',
          message: 'Нельзя оформить продажу: выбранный продавец недоступен'
        });
      }
    }
    
	// Use transaction to ensure atomicity: decrement seats_left AND create presale
	// sellerId is passed explicitly so we can write money_ledger rows during presale creation
	// lat/lng are GPS coordinates from seller app (nullable)
	// zoneAtSale is seller's zone at sale time (for historical motivation analytics)
	const transaction = db.transaction((slotId, slotType, seats, customerName, customerPhone, prepayment, prepaymentComment, ticketsJson, slotUidInput, paymentMethodUpper, paymentCashAmount, paymentCardAmount, sellerId, latAtSale, lngAtSale, zoneAtSale) => {
  // 1) Decrement seats_left in the correct table
  let updateResult;
  if (slotType === 'generated') {
    updateResult = db.prepare(`
      UPDATE generated_slots
      SET seats_left = (CASE WHEN seats_left IS NULL OR seats_left < 1 THEN capacity ELSE seats_left END) - ?
      WHERE id = ? AND (CASE WHEN seats_left IS NULL OR seats_left < 1 THEN capacity ELSE seats_left END) >= ?
    `).run(seats, slotId, seats);
  } else {
    updateResult = db.prepare(`
      UPDATE boat_slots
      SET seats_left = (CASE WHEN seats_left IS NULL OR seats_left < 1 THEN capacity ELSE seats_left END) - ?
      WHERE id = ? AND (CASE WHEN seats_left IS NULL OR seats_left < 1 THEN capacity ELSE seats_left END) >= ?
    `).run(seats, slotId, seats);
  }

  if (updateResult.changes === 0) {
    throw new Error('NO_SEATS');
  }

  // 2) FK FIX: presales.boat_slot_id MUST reference boat_slots.id
  //    - For manual slots: boatSlotIdForFK = slotId and slot_uid = manual:<id>
  //    - For generated slots: create/find a matching row in boat_slots, but keep slot_uid = generated:<genId>
  let boatSlotIdForFK = slotId;
  let presaleSlotUid = slotUidInput;

  let resolvedCapacityForSlot = null;

  if (typeof slotUidInput === 'string' && slotUidInput.startsWith('generated:')) {
    const genId = Number(slotUidInput.split(':')[1]);

    const gen = db.prepare(`
      SELECT boat_id, time, capacity, seats_left, duration_minutes,
             price_adult, price_teen, price_child, trip_date
      FROM generated_slots
      WHERE id = ?
    `).get(genId);
    resolvedCapacityForSlot = Number(gen?.capacity ?? null);

    if (!gen) {
      throw new Error('GEN_NOT_FOUND');
    }

    // IMPORTANT: keep exact generated slot uid (for correct frontend filtering)
    presaleSlotUid = `generated:${genId}`;

    // Ensure FK points to boat_slots
    const existing = db.prepare(`
      SELECT id FROM boat_slots
      WHERE boat_id = ? AND time = ?
      LIMIT 1
    `).get(gen.boat_id, gen.time);

    if (existing) {
      boatSlotIdForFK = existing.id;
    } else {
      const ins = db.prepare(`
        INSERT INTO boat_slots
          (boat_id, time, capacity, seats_left, duration_minutes, is_active,
           price, price_adult, price_teen, price_child)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
      `);

      const basePrice = (gen.price_adult ?? gen.price_teen ?? gen.price_child ?? 0);

      const r = ins.run(
        gen.boat_id,
        gen.time,
        gen.capacity ?? 0,
        gen.seats_left ?? gen.capacity ?? 0,
        gen.duration_minutes ?? 0,

        // required NOT NULL
        basePrice,

        gen.price_adult ?? null,
        gen.price_teen ?? null,
        gen.price_child ?? null
      );

      boatSlotIdForFK = Number(r.lastInsertRowid);
    }
  }

  // Compute business_day (trip date) for owner analytics
  let presaleBusinessDay = null;
  if (typeof presaleSlotUid === 'string' && presaleSlotUid.startsWith('generated:')) {
    const genId = Number(presaleSlotUid.split(':')[1]);
    const genRow = db.prepare(`SELECT trip_date FROM generated_slots WHERE id = ?`).get(genId);
    presaleBusinessDay = genRow?.trip_date || null;
  } else if (boatSlotIdForFK) {
    const slotRow = db.prepare(`SELECT trip_date FROM boat_slots WHERE id = ?`).get(boatSlotIdForFK);
    presaleBusinessDay = slotRow?.trip_date || null;
  }
  // Fallback to today if no trip_date found
  if (!presaleBusinessDay) {
    presaleBusinessDay = db.prepare(`SELECT DATE('now','localtime') AS d`).get()?.d || null;
  }
  assertShiftOpen(presaleBusinessDay);

  // 3) Create presale
  // For generated slots, do NOT count occupied seats via boat_slots (it aggregates by time-only).
  // Use generated_slots.seats_left/capacity as source of truth.
  assertCapacityForSlotUidOrThrow(presaleSlotUid, boatSlotIdForFK, seats);

  // Schema compatibility: check if presales has business_day column
  const presalesCols = db.prepare("PRAGMA table_info(presales)").all();
  const hasBusinessDay = presalesCols.some(c => c.name === 'business_day');
  const hasZoneGps = presalesCols.some(c => c.name === 'zone_at_sale');

  let presaleStmt, presaleParams;
  if (hasBusinessDay && hasZoneGps) {
    presaleStmt = db.prepare(`
INSERT INTO presales (
      boat_slot_id, slot_uid, seller_id,
      customer_name, customer_phone, number_of_seats,
      total_price, prepayment_amount, prepayment_comment, status, tickets_json,
      payment_method, payment_cash_amount, payment_card_amount, business_day,
      zone_at_sale, lat_at_sale, lng_at_sale
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    presaleParams = [
      boatSlotIdForFK,
      presaleSlotUid,
      sellerId,
      customerName.trim(),
      customerPhone.trim(),
      seats,
      calculatedTotalPrice,
      prepayment,
      prepaymentComment?.trim() || null,
      'ACTIVE',
      ticketsJson || null,
      paymentMethodUpper,
      Math.round(Number(paymentCashAmount || 0)),
      Math.round(Number(paymentCardAmount || 0)),
      presaleBusinessDay,
      zoneAtSale,
      latAtSale,
      lngAtSale
    ];
  } else if (hasBusinessDay) {
    presaleStmt = db.prepare(`
INSERT INTO presales (
      boat_slot_id, slot_uid, seller_id,
      customer_name, customer_phone, number_of_seats,
      total_price, prepayment_amount, prepayment_comment, status, tickets_json,
      payment_method, payment_cash_amount, payment_card_amount, business_day
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    presaleParams = [
      boatSlotIdForFK,
      presaleSlotUid,
      sellerId,
      customerName.trim(),
      customerPhone.trim(),
      seats,
      calculatedTotalPrice,
      prepayment,
      prepaymentComment?.trim() || null,
      'ACTIVE',
      ticketsJson || null,
      paymentMethodUpper,
      Math.round(Number(paymentCashAmount || 0)),
      Math.round(Number(paymentCardAmount || 0)),
      presaleBusinessDay
    ];
  } else {
    presaleStmt = db.prepare(`
INSERT INTO presales (
      boat_slot_id, slot_uid, seller_id,
      customer_name, customer_phone, number_of_seats,
      total_price, prepayment_amount, prepayment_comment, status, tickets_json,
      payment_method, payment_cash_amount, payment_card_amount
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    presaleParams = [
      boatSlotIdForFK,
      presaleSlotUid,
      sellerId,
      customerName.trim(),
      customerPhone.trim(),
      seats,
      calculatedTotalPrice,
      prepayment,
      prepaymentComment?.trim() || null,
      'ACTIVE',
      ticketsJson || null,
      paymentMethodUpper,
      Math.round(Number(paymentCashAmount || 0)),
      Math.round(Number(paymentCardAmount || 0))
    ];
  }

  const presaleResult = presaleStmt.run(...presaleParams);

	  // 3.1) If payment/prepayment is provided at creation time, write SELLER_SHIFT ledger row immediately.
	  // This keeps Dispatcher "Р—Р°РєСЂС‹С‚РёРµ СЃРјРµРЅС‹" (money_ledger based) consistent with presales that are already paid.
	  try {
	    const paidNow = Math.round((Number(paymentCashAmount || 0) + Number(paymentCardAmount || 0)) || 0);
	    if (paidNow > 0 && paymentMethodUpper) {
	      // idempotency: avoid duplicates for same presale
	      const already = db.prepare(`
        SELECT 1
        FROM money_ledger
        WHERE presale_id = ?
          AND type LIKE 'SALE_%'
        LIMIT 1
	      `).get(presaleResult.lastInsertRowid);

	      if (!already) {
          const saleAttribution = resolveSaleMoneyAttribution(sellerId);
	        let ledgerType = 'SALE_PREPAYMENT';
	        if (Number(paymentCashAmount) > 0 && Number(paymentCardAmount) > 0) ledgerType = 'SALE_PREPAYMENT_MIXED';
	        else if (Number(paymentCashAmount) > 0) ledgerType = 'SALE_PREPAYMENT_CASH';
	        else if (Number(paymentCardAmount) > 0) ledgerType = 'SALE_PREPAYMENT_CARD';

	        const bd = (() => {
	          try { return db.prepare(`SELECT DATE('now','localtime') AS d`).get()?.d; } catch { return null; }
	        })();

          const split = normalizeLedgerCashCardSplit({
            method: paymentMethodUpper,
            amount: paidNow,
            cashAmount: paymentCashAmount,
            cardAmount: paymentCardAmount,
          });
          insertSaleMoneyLedgerRow({
            presaleId: presaleResult.lastInsertRowid,
            slotId: boatSlotIdForFK ?? null,
            kind: saleAttribution.ledger_kind,
            type: ledgerType,
            method: paymentMethodUpper || null,
            amount: paidNow,
            sellerId: saleAttribution.attributed_user_id,
            businessDay: bd,
            tripDay: presaleBusinessDay ?? null,
            cashAmount: split.cash,
            cardAmount: split.card,
            decidedByUserId: req.user?.id ?? null,
          });
	      }
	    }
	  } catch (e) {
	    console.warn('[PRESALE_CREATE] ledger prepayment write skipped:', e?.message || e);
	  }

  // 4) Create tickets (always create "seats" count; pricing can be refined later)
  const ticketStmt = db.prepare(`
    INSERT INTO tickets (
      presale_id, boat_slot_id, ticket_code, status, price
    ) VALUES (?, ?, ?, 'ACTIVE', ?)
  `);

    // Create tickets.
  // IMPORTANT: Passenger "type" (adult/teen/child) in the UI is derived from tickets_json + index order.
  // So we must create tickets in deterministic order: adult -> teen -> child.
  let ticketPrices = [];

  if (ticketsJson) {
    let breakdown = null;
    try { breakdown = JSON.parse(ticketsJson); } catch { breakdown = null; }

    if (breakdown) {
      const adultCount = parseInt(breakdown.adult || 0) || 0;
      const teenCount  = parseInt(breakdown.teen  || 0) || 0;
      const childCount = parseInt(breakdown.child || 0) || 0;

      // Recompute prices using same inheritance as total calc
      const boatDefaults = db.prepare('SELECT price_adult, price_child, price_teen FROM boats WHERE id = ?').get(resolvedSlot.boat_id);
      const legacyBase = resolvedSlot.price || 0;

      const adultPrice = (resolvedSlot.price_adult ?? 0) || (boatDefaults?.price_adult ?? 0) || legacyBase;
      const teenPrice  = (resolvedSlot.price_teen  ?? 0) || (boatDefaults?.price_teen  ?? 0) || legacyBase;
      const childPrice = (resolvedSlot.price_child ?? 0) || (boatDefaults?.price_child ?? 0) || legacyBase;

      ticketPrices = [
        ...Array(adultCount).fill(adultPrice),
        ...Array(teenCount).fill(teenPrice),
        ...Array(childCount).fill(childPrice),
      ];
    }
  }

  if (ticketPrices.length === 0) {
    // Legacy: evenly split total across seats
    const pricePerSeat = Math.round(calculatedTotalPrice / Math.max(1, seats));
    ticketPrices = Array(seats).fill(pricePerSeat);
  }

  const insertedTicketIds = [];
  for (let i = 0; i < ticketPrices.length; i++) {
    const ticketCode = `TKT-${presaleResult.lastInsertRowid}-${i + 1}`;
    const r = ticketStmt.run(
      presaleResult.lastInsertRowid,
      boatSlotIdForFK,
      ticketCode,
      ticketPrices[i]
    );
    try {
      if (r && typeof r.lastInsertRowid !== 'undefined') {
        insertedTicketIds.push(Number(r.lastInsertRowid));
      }
    } catch {}
  }

  // Robustness: In some SQLite setups, lastInsertRowid may be unavailable.
  // If we failed to collect all ticket ids, fallback to selecting by presale_id.
  // This prevents missing canonical rows and incorrect Owner cash/card/pending.
  let canonTicketRows = null;
  if (insertedTicketIds.length === ticketPrices.length) {
    canonTicketRows = insertedTicketIds.map((id, idx) => ({
      ticket_id: id,
      amount: Math.round(Number(ticketPrices[idx] || 0)),
    }));
  } else {
    try {
      const rows = db.prepare(`SELECT id, price FROM tickets WHERE presale_id = ? ORDER BY id ASC`).all(presaleResult.lastInsertRowid);
      if (Array.isArray(rows) && rows.length > 0) {
        canonTicketRows = rows.map((r) => ({
          ticket_id: Number(r.id),
          amount: Math.round(Number(r.price || 0)),
        }));
      }
    } catch (e) {
      console.warn('[PRESALE_CREATE] fallback ticket select failed:', e?.message || e);
    }
  }

  // 5) Create canonical money rows (one per ticket) so Owner cash/card/pending are correct immediately.
  //    This is required for prepayment: cash/card must grow by the paid amount, and pending must be reduced.
  try {
    const canonExists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='sales_transactions_canonical'`).get();
    if (canonExists && Array.isArray(canonTicketRows) && canonTicketRows.length > 0) {
      const cols = db.prepare(`PRAGMA table_info(sales_transactions_canonical)`).all().map(r => r.name);
      const has = (c) => cols.includes(c);

      // Build insert columns dynamically (safe across schema versions)
      const insertCols = [];
      if (has('ticket_id')) insertCols.push('ticket_id');
      if (has('presale_id')) insertCols.push('presale_id');
      if (has('slot_id')) insertCols.push('slot_id');
      if (has('boat_id')) insertCols.push('boat_id');
      if (has('slot_uid')) insertCols.push('slot_uid');
      if (has('slot_source')) insertCols.push('slot_source');
      if (has('amount')) insertCols.push('amount');
      if (has('cash_amount')) insertCols.push('cash_amount');
      if (has('card_amount')) insertCols.push('card_amount');
      if (has('method')) insertCols.push('method');
      if (has('status')) insertCols.push('status');
      if (has('business_day')) insertCols.push('business_day');

      const ph = insertCols.map(() => '?').join(',');
      // IMPORTANT: sales_transactions_canonical often already has rows (from backfill/migrations).
      // ticket_id is usually UNIQUE.
      // If we do plain INSERT and it conflicts, we lose prepayment sync (Owner pending becomes too big).
      // So we do INSERT OR IGNORE + UPDATE fallback.
      const insCanon = db.prepare(`INSERT OR IGNORE INTO sales_transactions_canonical (${insertCols.join(',')}) VALUES (${ph})`);

      // Build an UPDATE statement for the same dynamic columns (safe across schema versions)
      const canUpdateByTicketId = has('ticket_id');
      const updCols = insertCols.filter((c) => c !== 'ticket_id');
      const updSet = updCols.map((c) => `${c} = ?`).join(', ');
      const updCanon = (canUpdateByTicketId && updCols.length > 0)
        ? db.prepare(`UPDATE sales_transactions_canonical SET ${updSet} WHERE ticket_id = ?`)
        : null;

      const totalTicketsAmount = canonTicketRows.reduce((s, r) => s + Math.round(Number(r.amount || 0)), 0);
      const cashTotal = Math.round(Number(paymentCashAmount || 0));
      const cardTotal = Math.round(Number(paymentCardAmount || 0));

      // Distribute cash/card across tickets proportionally to ticket amount
      const denom = Math.max(1, totalTicketsAmount);
      const cashRatio = cashTotal / denom;
      const cardRatio = cardTotal / denom;

      let cashRemaining = cashTotal;
      let cardRemaining = cardTotal;

      for (let i = 0; i < canonTicketRows.length; i++) {
        const ticketId = canonTicketRows[i].ticket_id;
        const amt = Math.round(Number(canonTicketRows[i].amount || 0));

        let cashPart = 0;
        let cardPart = 0;

        if (i === canonTicketRows.length - 1) {
          // Last ticket gets РѕСЃС‚Р°С‚РѕРє (ensures sums match exactly)
          cashPart = Math.max(0, Math.min(amt, cashRemaining));
          cardPart = Math.max(0, Math.min(amt - cashPart, cardRemaining));
        } else {
          cashPart = Math.round(amt * cashRatio);
          cardPart = Math.round(amt * cardRatio);

          // Clamp to available remaining and to ticket amount
          cashPart = Math.max(0, Math.min(cashPart, cashRemaining, amt));
          cardPart = Math.max(0, Math.min(cardPart, cardRemaining, amt - cashPart));
        }

        cashRemaining -= cashPart;
        cardRemaining -= cardPart;

        const row = [];
        for (const c of insertCols) {
          if (c === 'ticket_id') row.push(ticketId);
          else if (c === 'presale_id') row.push(presaleResult.lastInsertRowid);
          else if (c === 'slot_id') row.push(boatSlotIdForFK);
          else if (c === 'boat_id') row.push(resolvedSlot.boat_id);
          else if (c === 'slot_uid') row.push(presaleSlotUid);
          else if (c === 'slot_source') row.push(resolvedSlot.source_type);
          else if (c === 'amount') row.push(amt);
          else if (c === 'cash_amount') row.push(cashPart);
          else if (c === 'card_amount') row.push(cardPart);
          else if (c === 'method') row.push(paymentMethodUpper || null);
          else if (c === 'status') row.push('VALID');
          // business_day for canonical money MUST be the TRIP DATE (date of the ride), not the sale date.
          // Priority:
          //  1) tripDate from request body (dispatcher chooses the trip date)
          //  2) resolvedSlot.trip_date (for generated slots and schedule slots)
          //  3) fallback: today (localtime) for manual/offline slots that have no trip_date
          else if (c === 'business_day') row.push(
            tripDate || resolvedSlot?.trip_date || db.prepare(`SELECT DATE('now','localtime') as d`).get().d
          );
          else row.push(null);
        }
        const insRes = insCanon.run(...row);
        // If row already existed (changes===0), update it to reflect current paid split (prepayment).
        if (updCanon && insRes && insRes.changes === 0) {
          const updRow = [];
          for (const c of updCols) {
            // Same order as updCols
            const idx = insertCols.indexOf(c);
            updRow.push(row[idx]);
          }
          updRow.push(ticketId);
          updCanon.run(...updRow);
        }
      }
    }
  } catch (e) {
    console.warn('[PRESALE_CREATE] canonical insert skipped:', e?.message || e);
  }

  // Persist payment method on tickets (some flows read it from tickets)
  // Use lowercase to match existing /paid endpoint behaviour.
  if (paymentMethodUpper) {
    const pmLower = String(paymentMethodUpper).toLowerCase();
    try {
      db.prepare(`UPDATE tickets SET payment_method = ? WHERE presale_id = ?`).run(pmLower, presaleResult.lastInsertRowid);
    } catch (e) {
      // Non-fatal: DB may not have column in older schemas
      console.warn('[PRESALE_CREATE] tickets.payment_method update skipped:', e?.message || e);
    }
  }

  
  // Keep seats_left cache in sync (prevents negative UI values)
  // IMPORTANT: for generated slots, seats_left is already updated in generated_slots (step 1)
  // and must NOT be overwritten from boat_slots (boat_slots is time-only and aggregates seats).
  if (!(typeof slotUidInput === 'string' && slotUidInput.startsWith('generated:'))) {
    syncSeatsLeftCache(boatSlotIdForFK, resolvedCapacityForSlot || undefined);
  }

return { lastInsertRowid: presaleResult.lastInsertRowid, totalPrice: calculatedTotalPrice };
});

// Execute the transaction

    let newPresaleId;
    let effectiveSellerId = null;
    try {
      // Money attribution follows business owner of the sale, not the clicking actor.
      const saleAttribution = resolveSaleMoneyAttribution(
        req.user?.role === 'seller' ? req.user?.id : sellerId,
        req.user?.id
      );
      effectiveSellerId = saleAttribution.attributed_user_id;
      
      let zoneAtSale = null;
      if (effectiveSellerId) {
        try {
          const sellerZoneRow = db.prepare('SELECT zone FROM users WHERE id = ?').get(effectiveSellerId);
          zoneAtSale = sellerZoneRow?.zone || null;
        } catch (e) {
          // zone column may not exist yet, ignore
        }
      }
      
      // Get GPS coordinates from request (nullable)
      const latAtSale = Number(req.body?.lat) || null;
      const lngAtSale = Number(req.body?.lng) || null;
      
	      const result = transaction(
        resolvedSlot.slot_id,
        resolvedSlot.source_type,
        seats,
        customerName,
        customerPhone,
        prepayment,
        prepaymentComment,
        ticketsJson,
        slotUid,
        paymentMethodUpper,
        paymentCashAmount,
	        paymentCardAmount,
	        effectiveSellerId,
        latAtSale,
        lngAtSale,
        zoneAtSale
      );

      newPresaleId = result.lastInsertRowid;
      calculatedTotalPrice = result.totalPrice;
    } catch (transactionError) {
      if (transactionError?.message === 'NO_SEATS') {
        return res.status(400).json({ error: 'Not enough seats available' });
      }

      if (transactionError?.message === 'GEN_NOT_FOUND') {
        return res.status(404).json({ error: 'Generated slot not found' });
      }

      if (transactionError?.message === 'Prepayment amount cannot exceed total price') {
        return res.status(400).json({ error: 'Prepayment amount cannot exceed total price' });
      }

      throw transactionError;
    }

// Get the created presale (without problematic joins)
    const presaleRow = db.prepare(`
      SELECT 
        p.id, p.boat_slot_id, p.customer_name, p.customer_phone, p.number_of_seats,
        p.total_price, p.prepayment_amount, p.prepayment_comment, p.status, p.tickets_json,
        p.payment_method, p.payment_cash_amount, p.payment_card_amount,
        (p.total_price - p.prepayment_amount) as remaining_amount,
        p.created_at, p.updated_at
      FROM presales p
      WHERE p.id = ?
    `).get(newPresaleId);
    
    const buyerTicketCode = buildBuyerTicketCodeFromCanonicalPresaleId(newPresaleId);
    const buyerHandoff = buildSellerBuyerHandoffSummary({
      canonicalPresaleId: newPresaleId,
      buyerTicketCode,
      sellerId: effectiveSellerId,
    });

    // Return success response with structured data
    res.status(201).json({
      ok: true,
      presale: {
        ...presaleRow,
        remaining_amount: calculatedTotalPrice - prepayment,
        buyer_ticket_code: buyerTicketCode,
      },
      slot: {
        slot_uid: slotUid,
        source_type: resolvedSlot.source_type,
        trip_date: resolvedSlot.trip_date,
        time: resolvedSlot.time,
        boat_id: resolvedSlot.boat_id,
        boat_name: resolvedSlot.boat_name,
        price: resolvedSlot.price,
        capacity: resolvedSlot.capacity
      },
      buyer_ticket_code: buyerTicketCode,
      buyer_handoff: buyerHandoff,
      debug: { 
        resolved_slot_kind: resolvedSlot.source_type, 
        sql_path: "SELECT presales row + attach slot info", 
        slotUid 
      }
    });
  } catch (error) {
    const shiftClosedResponse = respondShiftClosedIfNeeded(res, error);
    if (shiftClosedResponse) return shiftClosedResponse;
    console.error('[PRESALE_CREATE_500]', { slotUid: req.body?.slotUid, message: error.message, stack: error.stack });
    if (error?.message === 'CAPACITY_EXCEEDED') {
      return res.status(409).json({ ok: false, code: 'CAPACITY_EXCEEDED', message: 'РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ РјРµСЃС‚ РІ СЂРµР№СЃРµ', details: error.details || null });
    }
    res.status(500).json({
      ok: false,
      code: 'INTERNAL',
      message: error.message,
      debug: {
        route: 'POST /api/selling/presales',
        slotUid: req.body?.slotUid,
        stack: error.stack
      }
    });
  }
});

// Get all presales (for dispatcher view)
router.get('/presales', authenticateToken, canSell, (req, res) => {
  try {
    const where = [];
    const params = [];
    const slotUidFilter = String(req.query?.slot_uid ?? req.query?.slotUid ?? '').trim();
    const rawBoatSlotIdFilter = req.query?.boat_slot_id ?? req.query?.boatSlotId;
    const boatSlotIdFilter = parsePositiveIntegerOrNull(rawBoatSlotIdFilter);

    if (String(req.user?.role || '').toLowerCase() === 'seller') {
      where.push('p.seller_id = ?');
      params.push(Number(req.user.id || 0));
    }

    if (slotUidFilter) {
      if (slotUidFilter.startsWith('generated:')) {
        where.push('p.slot_uid = ?');
        params.push(slotUidFilter);
      } else if (slotUidFilter.startsWith('manual:')) {
        const manualSlotId = parsePositiveIntegerOrNull(slotUidFilter.slice('manual:'.length));
        if (manualSlotId) {
          where.push('(p.slot_uid = ? OR p.boat_slot_id = ?)');
          params.push(slotUidFilter, manualSlotId);
        } else {
          where.push('p.slot_uid = ?');
          params.push(slotUidFilter);
        }
      } else if (boatSlotIdFilter) {
        where.push('(p.slot_uid = ? OR p.boat_slot_id = ?)');
        params.push(slotUidFilter, boatSlotIdFilter);
      } else {
        where.push('p.slot_uid = ?');
        params.push(slotUidFilter);
      }
    } else if (boatSlotIdFilter) {
      where.push('p.boat_slot_id = ?');
      params.push(boatSlotIdFilter);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const presales = db.prepare(`
      SELECT 
        p.id, p.boat_slot_id, p.customer_name, p.customer_phone, p.number_of_seats,
        p.total_price, p.prepayment_amount, p.prepayment_comment, p.status, p.tickets_json,
        p.payment_method, p.payment_cash_amount, p.payment_card_amount,
        p.seller_id as sale_attribution_user_id,
        u.username as sale_attribution_name,
        u.role as sale_attribution_role,
        (p.total_price - p.prepayment_amount) as remaining_amount,
        p.created_at, p.updated_at,
        COALESCE(bs.time, gs.time) as slot_time,
        COALESCE(bs.duration_minutes, gs.duration_minutes) as slot_duration_minutes,
        COALESCE(bs.price_adult, gs.price_adult) as price_adult,
        COALESCE(bs.price_child, gs.price_child) as price_child,
        COALESCE(bs.price_teen, gs.price_teen) as price_teen,
        COALESCE(b.name, gb.name) as boat_name,
        COALESCE(b.type, gb.type) as boat_type,
        COALESCE(b.is_active, gb.is_active) as boat_is_active,
        COALESCE(bs.capacity, gs.capacity) as slot_capacity,
        COALESCE(bs.seats_left, gs.seats_left) as slot_seats_left,
        COALESCE(NULLIF(p.business_day, ''), gs.trip_date) as slot_trip_date,
        COALESCE(bss.seller_cutoff_minutes, gs.seller_cutoff_minutes) as seller_cutoff_minutes,
        COALESCE(bss.dispatcher_cutoff_minutes, gs.dispatcher_cutoff_minutes) as dispatcher_cutoff_minutes,
        CASE 
          WHEN gs.id IS NOT NULL THEN 'generated:' || gs.id
          WHEN bs.id IS NOT NULL THEN 'manual:' || bs.id
          ELSE p.slot_uid  -- fallback to existing stored value if available
        END as slot_uid
      FROM presales p
      LEFT JOIN boat_slots bs ON p.boat_slot_id = bs.id
      LEFT JOIN generated_slots gs ON (p.slot_uid LIKE 'generated:%' AND gs.id = CAST(substr(p.slot_uid, 11) AS INTEGER))
      LEFT JOIN boats b ON bs.boat_id = b.id
      LEFT JOIN boats gb ON gs.boat_id = gb.id
      LEFT JOIN boat_settings bss ON bss.boat_id = COALESCE(bs.boat_id, gs.boat_id)
      LEFT JOIN users u ON u.id = p.seller_id
      ${whereSql}
      ORDER BY p.created_at DESC
    `).all(...params);

    const normalizedPresales = Array.isArray(presales)
      ? presales.map((presale) => {
          let buyerTicketCode = null;
          try {
            buyerTicketCode = buildBuyerTicketCodeFromCanonicalPresaleId(Number(presale?.id));
          } catch {
            buyerTicketCode = null;
          }
          return {
            ...presale,
            buyer_ticket_code: buyerTicketCode,
          };
        })
      : [];

    res.json(normalizedPresales);
  } catch (error) {
    console.error('[SELLING_500] route=/api/selling/presales method=GET message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
  }
});

router.get('/seller-dashboard', authenticateToken, canSell, (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'seller') {
      return res.status(403).json({ ok: false, error: 'Seller dashboard is available only for seller role' });
    }

    const sellerId = Number(req.user?.id || 0);
    if (!Number.isFinite(sellerId) || sellerId <= 0) {
      return res.status(401).json({ ok: false, error: 'Invalid seller user context' });
    }

    const { today, tomorrow } = getLocalBusinessDayWindow();
    const liveTodayRows = hasStoredSellerDayStats(today)
      ? null
      : listCanonicalSellerPointRowsForBusinessDay(today);
    const motivationResult = calcMotivationDay(db, today, {
      profile: 'dispatcher_shift_close',
      persistSnapshot: false,
    });

    if (motivationResult?.error) {
      return res.status(400).json({ ok: false, error: motivationResult.error });
    }

    const dayData = motivationResult?.data || {};
    const sellerPayout = Array.isArray(dayData.payouts)
      ? dayData.payouts.find((row) => Number(row?.user_id) === sellerId)
      : null;

    const todayLeaderboard = listSellerLeaderboardRows({
      dateFrom: today,
      dateTo: today,
      today,
      todayRows: liveTodayRows,
    });

    const todayPointsRow = todayLeaderboard.rows.find((row) => Number(row.user_id) === sellerId) || null;
    const weekData = buildWeeklyMotivationSnapshot({ sellerId, today });
    const seasonData = buildSeasonMotivationSnapshot({ sellerId, today });
    const weekRow = weekData.current_seller || null;
    const seasonRow = seasonData.current_seller || null;

    const sellerState = getSellerState(sellerId);
    const streakCalibrated = Boolean(Number(sellerState?.calibrated || 0));
    const streakLevel = String(sellerState?.current_level || 'NONE');
    const streakDays = streakCalibrated ? Math.max(0, Number(sellerState?.streak_days || 0)) : 0;
    const streakThreshold = streakCalibrated ? Number(getStreakThreshold(streakLevel) || 0) : null;
    const todayRevenue = roundToKopecks(getSellerDayRevenue(today, sellerId));
    const prepaymentsTodayRow = db.prepare(`
      SELECT
        COALESCE(SUM(CASE
          WHEN ml.type = 'SALE_PREPAYMENT_CASH' OR (ml.type = 'SALE_PREPAYMENT' AND ml.method = 'CASH') THEN ABS(ml.amount)
          WHEN ml.type = 'SALE_PREPAYMENT_MIXED' OR (ml.type = 'SALE_PREPAYMENT' AND ml.method = 'MIXED') THEN CASE
            WHEN COALESCE(p.payment_cash_amount, 0) + COALESCE(p.payment_card_amount, 0) > 0
              THEN ROUND(ABS(ml.amount) * COALESCE(p.payment_cash_amount, 0) / (COALESCE(p.payment_cash_amount, 0) + COALESCE(p.payment_card_amount, 0)))
            ELSE 0
          END
          ELSE 0
        END), 0) AS cash,
        COALESCE(SUM(CASE
          WHEN ml.type = 'SALE_PREPAYMENT_CARD' OR (ml.type = 'SALE_PREPAYMENT' AND ml.method = 'CARD') THEN ABS(ml.amount)
          WHEN ml.type = 'SALE_PREPAYMENT_MIXED' OR (ml.type = 'SALE_PREPAYMENT' AND ml.method = 'MIXED') THEN CASE
            WHEN COALESCE(p.payment_cash_amount, 0) + COALESCE(p.payment_card_amount, 0) > 0
              THEN ABS(ml.amount) - ROUND(ABS(ml.amount) * COALESCE(p.payment_cash_amount, 0) / (COALESCE(p.payment_cash_amount, 0) + COALESCE(p.payment_card_amount, 0)))
            ELSE 0
          END
          ELSE 0
        END), 0) AS card
      FROM money_ledger ml
      LEFT JOIN presales p ON p.id = ml.presale_id
      WHERE ml.business_day = ?
        AND ml.seller_id = ?
        AND ml.status = 'POSTED'
        AND ml.type IN ('SALE_PREPAYMENT','SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED')
    `).get(today, sellerId) || {};
    const prepaymentsTodayCash = roundToKopecks(Number(prepaymentsTodayRow.cash || 0));
    const prepaymentsTodayCard = roundToKopecks(Number(prepaymentsTodayRow.card || 0));

    return res.json({
      ok: true,
      data: {
        dates: {
          today,
          tomorrow,
          week_id: weekData.week_id,
          season_id: seasonData.season_id,
          season_from: seasonData.season_from,
          season_to: seasonData.season_to,
        },
        earnings: {
          available: true,
          value: roundToKopecks(Number(sellerPayout?.total || 0)),
          source: 'calcMotivationDay(profile=dispatcher_shift_close).payouts.total',
        },
        points: {
          today: todayPointsRow ? roundToKopecks(Number(todayPointsRow.points_total || 0)) : null,
          source: todayLeaderboard.source,
        },
        prepayments_today: {
          available: true,
          cash: prepaymentsTodayCash,
          card: prepaymentsTodayCard,
          total: roundToKopecks(prepaymentsTodayCash + prepaymentsTodayCard),
          source: 'money_ledger.business_day+SALE_PREPAYMENT*',
        },
        streak: {
          available: Boolean(sellerState),
          calibrated: streakCalibrated,
          calibration_worked_days: Math.max(0, Number(sellerState?.calibration_worked_days || 0)),
          current_level: streakLevel,
          current_series: streakDays,
          multiplier: roundToKopecks(getStreakMultiplier(streakDays)),
          threshold: streakThreshold,
          today_revenue: todayRevenue,
          today_completed: streakThreshold === null ? null : todayRevenue > streakThreshold,
          source: 'seller_motivation_state+money_ledger',
        },
        week: {
          available: true,
          participating: Boolean(weekRow?.participating),
          week_id: weekData.week_id,
          date_from: weekData.date_from,
          date_to: weekData.date_to,
          place: weekRow?.place || null,
          points: weekRow?.points ?? null,
          revenue: weekRow?.revenue ?? null,
          total_sellers: weekData.total_sellers,
          current_payout: roundToKopecks(Number(weekRow?.current_payout || 0)),
          prize_place: weekRow?.prize_place || null,
          prizes: weekData.prizes,
          source: weekData.source,
        },
        season: {
          available: true,
          participating: Boolean(seasonRow?.participating),
          season_id: seasonData.season_id,
          season_from: seasonData.season_from,
          season_to: seasonData.season_to,
          place: seasonRow?.place || null,
          points: seasonRow?.points ?? null,
          revenue: seasonRow?.revenue ?? null,
          total_sellers: seasonData.total_sellers,
          current_payout: roundToKopecks(Number(seasonRow?.current_payout || 0)),
          season_share: Number(seasonRow?.season_share || 0),
          season_payout_recipient: Number(seasonRow?.season_payout_recipient || 0),
          is_eligible: Number(seasonRow?.is_eligible || 0),
          worked_days_season: Number(seasonRow?.worked_days_season || 0),
          worked_days_required: Number(seasonRow?.worked_days_required || 0),
          remaining_days_season: Number(seasonRow?.remaining_days_season || 0),
          worked_days_sep: Number(seasonRow?.worked_days_sep || 0),
          worked_days_sep_required: Number(seasonRow?.worked_days_sep_required || 0),
          remaining_days_sep: Number(seasonRow?.remaining_days_sep || 0),
          worked_days_end_sep: Number(seasonRow?.worked_days_end_sep || 0),
          worked_days_end_sep_required: Number(seasonRow?.worked_days_end_sep_required || 0),
          remaining_days_end_sep: Number(seasonRow?.remaining_days_end_sep || 0),
          payout_scheme: seasonData.payout_scheme,
          payout_mode: seasonData.payout_mode,
          fund_total: seasonData.fund_total,
          eligible_count: seasonData.eligible_count,
          recipient_count: seasonData.recipient_count,
          source: seasonData.source,
        },
        motivation: {
          mode: dayData.mode || null,
          warnings: Array.isArray(motivationResult?.warnings) ? motivationResult.warnings : [],
        },
      },
    });
  } catch (error) {
    console.error('[SELLING_500] route=/api/selling/seller-dashboard method=GET message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

router.get('/seller-dashboard/weekly', authenticateToken, canSell, (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'seller') {
      return res.status(403).json({ ok: false, error: 'Seller weekly motivation is available only for seller role' });
    }

    const sellerId = Number(req.user?.id || 0);
    if (!Number.isFinite(sellerId) || sellerId <= 0) {
      return res.status(401).json({ ok: false, error: 'Invalid seller user context' });
    }

    const { today } = getLocalBusinessDayWindow();
    const weekData = buildWeeklyMotivationSnapshot({ sellerId, today });

    return res.json({
      ok: true,
      data: weekData,
    });
  } catch (error) {
    console.error('[SELLING_500] route=/api/selling/seller-dashboard/weekly method=GET message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

router.get('/seller-dashboard/season', authenticateToken, canSell, (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'seller') {
      return res.status(403).json({ ok: false, error: 'Seller season motivation is available only for seller role' });
    }

    const sellerId = Number(req.user?.id || 0);
    if (!Number.isFinite(sellerId) || sellerId <= 0) {
      return res.status(401).json({ ok: false, error: 'Invalid seller user context' });
    }

    const { today } = getLocalBusinessDayWindow();
    const seasonData = buildSeasonMotivationSnapshot({ sellerId, today });

    return res.json({
      ok: true,
      data: seasonData,
    });
  } catch (error) {
    console.error('[SELLING_500] route=/api/selling/seller-dashboard/season method=GET message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// Get presales from cancelled trips (for dispatcher)
router.get('/presales/cancelled-trip-pending', authenticateToken, canDispatchManageSlots, (req, res) => {

  try {
    const cancelledPresales = db.prepare(`
      SELECT 
        p.id, p.boat_slot_id, p.customer_name, p.customer_phone, p.number_of_seats,
        p.total_price, p.prepayment_amount, p.prepayment_comment, p.status, p.tickets_json,
        p.payment_method, p.payment_cash_amount, p.payment_card_amount,
        (p.total_price - p.prepayment_amount) as remaining_amount,
        p.created_at, p.updated_at,
        COALESCE(bs.time, gs.time) as slot_time,
        COALESCE(bs.duration_minutes, gs.duration_minutes) as slot_duration_minutes,
        COALESCE(bs.price, gs.price_adult) as slot_price,
        COALESCE(bs.capacity, gs.capacity) as slot_capacity,
        COALESCE(bs.price_adult, gs.price_adult) as price_adult,
        COALESCE(bs.price_child, gs.price_child) as price_child,
        COALESCE(bs.price_teen, gs.price_teen) as price_teen,
        COALESCE(b.name, gb.name) as boat_name,
        COALESCE(b.type, gb.type) as boat_type,
        COALESCE(b.is_active, gb.is_active) as boat_is_active,
        COALESCE(bs.seats_left, gs.seats_left) as slot_seats_left,
        gs.trip_date as slot_trip_date,
        COALESCE(bss.seller_cutoff_minutes, gs.seller_cutoff_minutes) as seller_cutoff_minutes,
        COALESCE(bss.dispatcher_cutoff_minutes, gs.dispatcher_cutoff_minutes) as dispatcher_cutoff_minutes,
        CASE 
          WHEN gs.id IS NOT NULL THEN 'generated:' || gs.id
          WHEN bs.id IS NOT NULL THEN 'manual:' || bs.id
          ELSE p.slot_uid  -- fallback to existing stored value if available
        END as slot_uid
      FROM presales p
      LEFT JOIN boat_slots bs ON p.boat_slot_id = bs.id
      LEFT JOIN generated_slots gs ON (p.slot_uid LIKE 'generated:%' AND gs.id = CAST(substr(p.slot_uid, 11) AS INTEGER))
      LEFT JOIN boats b ON bs.boat_id = b.id
      LEFT JOIN boats gb ON gs.boat_id = gb.id
      LEFT JOIN boat_settings bss ON bss.boat_id = COALESCE(bs.boat_id, gs.boat_id)
      WHERE p.status = 'CANCELLED_TRIP_PENDING'
      ORDER BY p.created_at DESC
    `).all();
    
    console.log('[CANCELLED_LIST] rows=', cancelledPresales.length);
    
    res.json(cancelledPresales);
  } catch (error) {
    console.error('[SELLING_500] route=/api/selling/presales/cancelled-trip-pending method=GET message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
  }
});

// Get a specific presale by ID
router.get('/presales/:id', authenticateToken, canSell, (req, res) => {
  try {
    const presaleId = parseInt(req.params.id);
    
    if (isNaN(presaleId)) {
      return res.status(400).json({ error: 'Invalid presale ID' });
    }

    // Get the presale with its associated slot and boat info
    const presale = db.prepare(`
      SELECT 
        p.id, p.boat_slot_id, p.customer_name, p.customer_phone, p.number_of_seats,
        p.total_price, p.prepayment_amount, p.prepayment_comment, p.tickets_json,
        (p.total_price - p.prepayment_amount) as remaining_amount,
        p.status, p.created_at, p.updated_at,
        COALESCE(bs.time, gs.time) as slot_time,
        COALESCE(bs.duration_minutes, gs.duration_minutes) as slot_duration_minutes,
        COALESCE(bs.price, gs.price_adult) as slot_price,
        COALESCE(bs.capacity, gs.capacity) as slot_capacity,
        COALESCE(bs.price_adult, gs.price_adult) as price_adult,
        COALESCE(bs.price_child, gs.price_child) as price_child,
        COALESCE(bs.price_teen, gs.price_teen) as price_teen,
        COALESCE(b.name, gb.name) as boat_name,
        COALESCE(b.type, gb.type) as boat_type,
        COALESCE(b.is_active, gb.is_active) as boat_is_active,
        COALESCE(bs.seats_left, gs.seats_left) as slot_seats_left,
        gs.trip_date as slot_trip_date,
        COALESCE(bss.seller_cutoff_minutes, gs.seller_cutoff_minutes) as seller_cutoff_minutes,
        COALESCE(bss.dispatcher_cutoff_minutes, gs.dispatcher_cutoff_minutes) as dispatcher_cutoff_minutes,
        CASE 
          WHEN gs.id IS NOT NULL THEN 'generated:' || gs.id
          WHEN bs.id IS NOT NULL THEN 'manual:' || bs.id
          ELSE p.slot_uid  -- fallback to existing stored value if available
        END as slot_uid
      FROM presales p
      LEFT JOIN boat_slots bs ON p.boat_slot_id = bs.id
      LEFT JOIN generated_slots gs ON (p.slot_uid LIKE 'generated:%' AND gs.id = CAST(substr(p.slot_uid, 11) AS INTEGER))
      LEFT JOIN boats b ON bs.boat_id = b.id
      LEFT JOIN boats gb ON gs.boat_id = gb.id
      LEFT JOIN boat_settings bss ON bss.boat_id = COALESCE(bs.boat_id, gs.boat_id)
      WHERE p.id = ?
    `).get(presaleId);
    
    if (!presale) {
      return res.status(404).json({ error: 'Presale not found' });
    }
    
    res.json(presale);
  } catch (error) {
    console.error('[SELLING_500] route=/api/selling/presales/:id method=GET id=' + req.params.id + ' message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
  }
});

// =====================
// PUT /api/selling/dispatcher/sellers/:id/zone
// Dispatcher can change seller zone (affects future sales only)
// =====================
router.put('/dispatcher/sellers/:id/zone', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const sellerId = Number(req.params.id);
    let { zone } = req.body || {};
    
    // Validate seller ID
    if (!sellerId || isNaN(sellerId)) {
      return res.status(400).json({ ok: false, error: 'Invalid seller ID' });
    }
    
    // Normalize zone: trim string, empty string -> null
    if (typeof zone === 'string') {
      zone = zone.trim();
      if (zone === '') zone = null;
    }
    
    // Validate zone value
    const validZones = ['hedgehog', 'center', 'sanatorium', 'stationary', null];
    if (zone !== null && !validZones.includes(zone)) {
      return res.status(400).json({ ok: false, error: 'Invalid zone. Must be one of: hedgehog, center, sanatorium, stationary, or null' });
    }
    
    // Check if seller exists and has role='seller'
    const seller = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(sellerId);
    if (!seller) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }
    if (seller.role !== 'seller') {
      return res.status(400).json({ ok: false, error: 'User is not a seller' });
    }
    
    // Update zone
    const result = db.prepare('UPDATE users SET zone = ? WHERE id = ? AND role = ?').run(zone, sellerId, 'seller');
    
    if (result.changes === 0) {
      return res.status(400).json({ ok: false, error: 'Failed to update zone' });
    }
    
    console.log(`[dispatcher/sellers/zone] Updated seller ${sellerId} zone to: ${zone} by dispatcher ${req.user?.id}`);
    
    return res.json({ 
      ok: true, 
      data: { 
        seller_id: sellerId, 
        seller_name: seller.username,
        zone: zone 
      } 
    });
  } catch (e) {
    console.error('[dispatcher/sellers/zone] Error:', e);
    return res.status(500).json({ ok: false, error: e?.message || 'Failed to update zone' });
  }
});

// DISPATCHER SLOT MANAGEMENT ENDPOINTS

// Create a new slot
router.post('/dispatcher/slots', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const { boat_id, time, trip_date, tripDate, capacity, duration_minutes, active = 1, price_adult, price_child, price_teen } = req.body;
    const slotTripDate = trip_date || tripDate;
    
    if (!boat_id || !time || !slotTripDate || capacity === undefined) {
      return res.status(400).json({ error: 'boat_id, trip_date, time, и capacity обязательны' });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(slotTripDate))) {
      return res.status(400).json({ error: 'Некорректная дата рейса. Используйте YYYY-MM-DD' });
    }
    
    // Validate data types
    const boatId = parseInt(boat_id);

    const slotCapacity = parseInt(capacity);
    // Handle active status: default to 1 if undefined, convert truthy values to 1, falsy to 0
    const isActive = active === undefined ? 1 : (active === true || active === 1 || active === '1' || active === 'true') ? 1 : 0;
    
    // Get boat type to validate duration
    const slotBoat = db.prepare('SELECT type FROM boats WHERE id = ?').get(boatId);
    if (!slotBoat) {
      return res.status(404).json({ error: 'Р›РѕРґРєР° РЅРµ РЅР°Р№РґРµРЅР°' });
    }
    
    // Validate duration if provided
    let durationMinutes = null;
    if (duration_minutes !== undefined) {
      durationMinutes = parseInt(duration_minutes);
      const serviceType = getBoatServiceType(slotBoat.type);
      const durationValidation = validateDuration(durationMinutes, serviceType);
      
      if (!durationValidation.valid) {
        return res.status(400).json({ error: durationValidation.error });
      }
    }
    
    // For banana type, validate capacity and set fixed values
    if (slotBoat.type === 'banana') {
      // Validate capacity is 12
      if (slotCapacity !== 12) {
        return res.status(400).json({ error: 'Р”Р»СЏ Р±Р°РЅР°РЅР° РІРјРµСЃС‚РёРјРѕСЃС‚СЊ РґРѕР»Р¶РЅР° Р±С‹С‚СЊ 12 РјРµСЃС‚' });
      }
      
      // For banana: force duration to 40 minutes if not provided or different
      if (durationMinutes !== 40) {
        durationMinutes = 40;
      }
      

    }
    
    // Add debug logging to see the values being processed
    console.log('[CREATE_SLOT_DEBUG] Values:', { boatId, slotTripDate, slotCapacity, durationMinutes, isActive, price_adult, price_child, price_teen });
    
    if (isNaN(boatId) || boatId <= 0) {
      return res.status(400).json({ error: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ ID Р»РѕРґРєРё' });
    }
    
    // Validate category-specific prices instead of legacy price
    if (price_adult === undefined || isNaN(price_adult) || price_adult <= 0) {
      return res.status(400).json({ error: 'РќРµРєРѕСЂСЂРµРєС‚РЅР°СЏ С†РµРЅР° РґР»СЏ РІР·СЂРѕСЃР»С‹С…' });
    }
    if (price_child === undefined || isNaN(price_child) || price_child <= 0) {
      return res.status(400).json({ error: 'РќРµРєРѕСЂСЂРµРєС‚РЅР°СЏ С†РµРЅР° РґР»СЏ СЂРµР±С‘РЅРєР°' });
    }
    
    // Validate teen price for banana boats
    if (slotBoat.type === 'banana' && (price_teen !== undefined && price_teen !== null && price_teen !== 0)) {
      return res.status(400).json({ error: 'РџРѕРґСЂРѕСЃС‚РєРѕРІС‹Р№ Р±РёР»РµС‚ Р·Р°РїСЂРµС‰С‘РЅ РґР»СЏ banana' });
    }
    
    if (isNaN(slotCapacity) || slotCapacity <= 0) {
      return res.status(400).json({ error: 'РќРµРєРѕСЂСЂРµРєС‚РЅР°СЏ РІРјРµСЃС‚РёРјРѕСЃС‚СЊ' });
    }
    
    // Validate time format
    if (!validateTimeFormat(time)) {
      return res.status(400).json({ error: 'РќРµРґРѕРїСѓСЃС‚РёРјРѕРµ РІСЂРµРјСЏ СЂРµР№СЃР°. Р Р°Р·СЂРµС€РµРЅРѕ 08:00вЂ“21:00, С€Р°Рі 30 РјРёРЅСѓС‚.' });
    }
    
    // Check if boat exists and is active
    const boat = db.prepare('SELECT id FROM boats WHERE id = ? AND is_active = 1').get(boatId);
    if (!boat) {
      return res.status(404).json({ error: 'Р›РѕРґРєР° РЅРµ РЅР°Р№РґРµРЅР° РёР»Рё РЅРµР°РєС‚РёРІРЅР°' });
    }
    
    try {
      // Insert the new slot
      const stmt = db.prepare('INSERT INTO boat_slots (boat_id, time, trip_date, price, capacity, seats_left, duration_minutes, is_active, price_adult, price_child, price_teen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      // Set legacy price to price_adult for DB constraint compatibility
      const result = stmt.run(boatId, time, slotTripDate, price_adult, slotCapacity, slotCapacity, durationMinutes, isActive, price_adult, price_child, price_teen);
      console.log('[DISPATCHER_SLOTS] Created slot with legacy price:', price_adult, 'adult:', price_adult, 'child:', price_child, 'teen:', price_teen);
      
      // Get the created slot
      const newSlot = db.prepare(`
        SELECT
          bs.id as slot_id,
          ('manual:' || bs.id) as slot_uid,
          ('manual:' || bs.id) as slotUid,
          bs.id,
          bs.boat_id,
          bs.trip_date,
          bs.time,
          bs.capacity,
          bs.duration_minutes,
          bs.is_active,
          bs.price_adult as price,
          bs.price_adult,
          bs.price_child,
          bs.price_teen,
          b.name as boat_name,
          b.type as boat_type,
          b.is_active as boat_is_active,
          CASE WHEN b.id IS NULL THEN 1 ELSE 0 END as boat_missing,
          'manual' as source_type,
          bs.seats_left
        FROM boat_slots bs
        LEFT JOIN boats b ON b.id = bs.boat_id
        WHERE bs.id = ?
      `).get(result.lastInsertRowid);
      
      res.status(201).json(newSlot);
    } catch (insertError) {
      // Check if this is a UNIQUE constraint error for boat_id and time
      if (insertError.message.includes('UNIQUE constraint failed: boat_slots.boat_id, boat_slots.time')) {
        console.error('[CREATE_SLOT_CONFLICT]', insertError.message);
        return res.status(409).json({
          error: 'Р РµР№СЃ РЅР° СЌС‚Рѕ РІСЂРµРјСЏ СѓР¶Рµ СЃСѓС‰РµСЃС‚РІСѓРµС‚ РґР»СЏ СЌС‚РѕР№ Р»РѕРґРєРё'
        });
      }
      // Re-throw other errors to be caught by the outer catch block
      throw insertError;
    }
  } catch (error) {
    console.error('[SELLING_500] route=/api/selling/dispatcher/slots method=POST message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
  }
});

// Update a slot
router.patch('/dispatcher/slots/:id', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const slotId = parseInt(req.params.id);
    const { time, price, capacity, duration_minutes, active, price_adult, price_child, price_teen } = req.body;
    
    // Add debug logging to identify parameter types
    console.log('[DISPATCHER_SLOT_PATCH_BIND_TYPES]', {
      time, timeType: typeof time,
      price, priceType: typeof price,
      capacity, capacityType: typeof capacity,
      duration_minutes, durationType: typeof duration_minutes,
      active, activeType: typeof active,
      price_adult, price_adultType: typeof price_adult,
      price_child, price_childType: typeof price_child,
      price_teen, price_teenType: typeof price_teen
    });
    
    // Normalize parameters for SQLite binding
    const normalizedTime = time !== undefined ? String(time) : null;
    const normalizedDurationMinutes = duration_minutes !== undefined ? Number(duration_minutes) : null;
    
    // Convert active to 0/1 integer for SQLite
    const activeValue =
      active === undefined ? null :
      (active === true || active === 1 || active === '1' || active === 'true') ? 1 : 0;
    
    if (isNaN(slotId) || slotId <= 0) {
      return res.status(400).json({ error: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ ID СЃР»РѕС‚Р°' });
    }
    
    // Get current slot data
    const currentSlot = db.prepare(`
      SELECT bs.*,
        (SELECT COALESCE(SUM(p.number_of_seats), 0)
         FROM presales p
         WHERE p.boat_slot_id = bs.id
           AND p.status NOT IN ('CANCELLED', 'CANCELLED_TRIP_PENDING', 'REFUNDED')
        ) as sold_seats_from_presales,
        (bs.capacity - bs.seats_left) as sold_seats_from_calc
      FROM boat_slots bs
      WHERE bs.id = ?
      AND NOT EXISTS (
        SELECT 1
        FROM generated_slots gs
        WHERE gs.boat_id = bs.boat_id
          AND gs.time = bs.time
          AND gs.is_active = 1
      )
    `).get(slotId);
    
    // Get boat type to validate duration
    const boat = db.prepare(`
      SELECT b.type
      FROM boat_slots bs
      JOIN boats b ON bs.boat_id = b.id
      WHERE bs.id = ?
    `).get(slotId);
    
    if (!boat) {
      return res.status(404).json({ error: 'РЎР»РѕС‚ РЅРµ РЅР°Р№РґРµРЅ РёР»Рё Р»РѕРґРєР° РЅРµ РЅР°Р№РґРµРЅР°' });
    }
    
    if (!currentSlot) {
      return res.status(404).json({ error: 'РЎР»РѕС‚ РЅРµ РЅР°Р№РґРµРЅ' });
    }
    
    // Validate category-specific prices if they are being updated
    if (price_adult !== undefined && (isNaN(price_adult) || price_adult <= 0)) {
      return res.status(400).json({ error: 'РќРµРєРѕСЂСЂРµРєС‚РЅР°СЏ С†РµРЅР° РґР»СЏ РІР·СЂРѕСЃР»С‹С…' });
    }
    if (price_child !== undefined && (isNaN(price_child) || price_child <= 0)) {
      return res.status(400).json({ error: 'РќРµРєРѕСЂСЂРµРєС‚РЅР°СЏ С†РµРЅР° РґР»СЏ СЂРµР±С‘РЅРєР°' });
    }
    
    // Get boat type to validate teen price for banana boats
    if (price_teen !== undefined && price_teen !== null && price_teen !== 0) {
      if (boat.type === 'banana') {
        return res.status(400).json({ error: 'РџРѕРґСЂРѕСЃС‚РєРѕРІС‹Р№ Р±РёР»РµС‚ Р·Р°РїСЂРµС‰С‘РЅ РґР»СЏ banana' });
      }
    }
    
    // Validate time format if time is being updated
    if (time !== undefined && time !== null) {
      if (!validateTimeFormat(time)) {
        return res.status(400).json({ error: 'РќРµРґРѕРїСѓСЃС‚РёРјРѕРµ РІСЂРµРјСЏ СЂРµР№СЃР°. Р Р°Р·СЂРµС€РµРЅРѕ 08:00вЂ“21:00, С€Р°Рі 30 РјРёРЅСѓС‚.' });
      }
    }
    
    // Validate duration if being updated
    if (duration_minutes !== undefined) {
      const serviceType = getBoatServiceType(boat.type);
      const durationValidation = validateDuration(Number(duration_minutes), serviceType);
      
      if (!durationValidation.valid) {
        return res.status(400).json({ error: durationValidation.error });
      }
    }
    
    // For banana type, validate capacity and set fixed values
    if (boat.type === 'banana') {
      // Validate capacity if being updated
      if (capacity !== undefined) {
        const newCapacity = parseInt(capacity);
        if (newCapacity !== 12) {
          return res.status(400).json({ error: 'Р”Р»СЏ Р±Р°РЅР°РЅР° РІРјРµСЃС‚РёРјРѕСЃС‚СЊ РґРѕР»Р¶РЅР° Р±С‹С‚СЊ 12 РјРµСЃС‚' });
        }
      }
      
      // For banana: force duration to 40 minutes if being updated and different
      if (duration_minutes !== undefined && Number(duration_minutes) !== 40) {
        return res.status(400).json({ error: 'Р”Р»СЏ Р±Р°РЅР°РЅР° РґР»РёС‚РµР»СЊРЅРѕСЃС‚СЊ РґРѕР»Р¶РЅР° Р±С‹С‚СЊ 40 РјРёРЅСѓС‚' });
      }
      

    }
    
    // Check if there are ANY live presales for this slot (ACTIVE, PAID, PARTIALLY_PAID, CONFIRMED)
    const presalesCount = db.prepare(`
      SELECT COUNT(*) as count 
      FROM presales 
      WHERE (boat_slot_id = ? OR slot_uid = ?) 
        AND status IN ('ACTIVE', 'PAID', 'PARTIALLY_PAID', 'CONFIRMED')
    `).get(slotId, `manual:${slotId}`).count;
    
    // Get detailed presales diagnostics before update
    const presalesByStatus = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM presales
      WHERE (boat_slot_id = ? OR slot_uid = ?)
      GROUP BY status
    `).all(slotId, `manual:${slotId}`).reduce((acc, row) => {
      acc[row.status] = row.count;
      return acc;
    }, {});
    
    const presalesLive = db.prepare(`
      SELECT COUNT(*) as count
      FROM presales
      WHERE (boat_slot_id = ? OR slot_uid = ?)
        AND status IN ('ACTIVE','PAID','PARTIALLY_PAID','CONFIRMED')
    `).get(slotId, `manual:${slotId}`).count;
    
    const presalesTotal = db.prepare(`
      SELECT COUNT(*) as count
      FROM presales
      WHERE (boat_slot_id = ? OR slot_uid = ?)
    `).get(slotId, `manual:${slotId}`).count;
    
    let updatedPresalesCount = 0;
    // If trying to deactivate and there are live presales, handle them by setting to CANCELLED_TRIP_PENDING
    if (activeValue === 0 && presalesCount > 0) {
      // Use transaction to ensure atomicity: update presales AND update slot
      const transaction = db.transaction((slotId) => {
        // Update all "live" presales for this slot to CANCELLED_TRIP_PENDING status
        const updatePresalesStmt = db.prepare('UPDATE presales SET status = ? WHERE (boat_slot_id = ? OR slot_uid = ?) AND status IN (?, ?, ?, ?)');
        const result = updatePresalesStmt.run('CANCELLED_TRIP_PENDING', slotId, `manual:${slotId}`, 'ACTIVE', 'PAID', 'PARTIALLY_PAID', 'CONFIRMED');
        console.log('[TRIP_CANCEL] updated presales=', result.changes);
        updatedPresalesCount = result.changes;
      });
      
      // Execute the transaction
      transaction(slotId);
    }
    
    // If capacity is being changed, validate that new capacity is not less than sold seats
    let newCapacity = currentSlot.capacity;
    if (capacity !== undefined) {
      newCapacity = parseInt(capacity);
      if (isNaN(newCapacity) || newCapacity <= 0) {
        return res.status(400).json({ error: 'РќРµРєРѕСЂСЂРµРєС‚РЅР°СЏ РІРјРµСЃС‚РёРјРѕСЃС‚СЊ' });
      }
      // Debug logging to see the values being compared - using more accurate calculation from presales
      const actualSoldSeats = currentSlot.sold_seats_from_presales;
      console.log('[CAPACITY_UPDATE_DEBUG] newCapacity:', newCapacity, 'sold_seats_from_calc:', currentSlot.sold_seats_from_calc, 'sold_seats_from_presales:', actualSoldSeats);
      if (newCapacity < actualSoldSeats) {
        return res.status(400).json({ error: 'РќРѕРІР°СЏ РІРјРµСЃС‚РёРјРѕСЃС‚СЊ РЅРµ РјРѕР¶РµС‚ Р±С‹С‚СЊ РјРµРЅСЊС€Рµ РєРѕР»РёС‡РµСЃС‚РІР° РїСЂРѕРґР°РЅРЅС‹С… РјРµСЃС‚' });
      }
      
      // Adjust seats_left if capacity is increased - using accurate sold seats calculation
      const newSeatsLeft = newCapacity - actualSoldSeats;
      
      // Update the slot with new capacity and adjusted seats_left
      const stmt = db.prepare(`
        UPDATE boat_slots 
        SET time = COALESCE(?, time), 
            price = COALESCE(?, price), 
            capacity = ?, 
            seats_left = ?,
            duration_minutes = COALESCE(?, duration_minutes),
            is_active = COALESCE(?, is_active),
            price_adult = ?,
            price_child = ?,
            price_teen = ?
        WHERE id = ?
      `);
      // Set legacy price to price_adult for DB constraint compatibility when price_adult is provided
      stmt.run(normalizedTime, price_adult, newCapacity, newSeatsLeft, normalizedDurationMinutes, activeValue, price_adult, price_child, price_teen, slotId);
    } else {
      // Update without changing capacity
      const stmt = db.prepare(`
        UPDATE boat_slots 
        SET time = COALESCE(?, time), 
            price = COALESCE(?, price), 
            duration_minutes = COALESCE(?, duration_minutes),
            is_active = COALESCE(?, is_active),
            price_adult = ?,
            price_child = ?,
            price_teen = ?
        WHERE id = ?
      `);
      // Set legacy price to price_adult for DB constraint compatibility when price_adult is provided
      stmt.run(normalizedTime, price_adult, normalizedDurationMinutes, activeValue, price_adult, price_child, price_teen, slotId);
    }
    
    // Keep seats_left consistent after any activation/deactivation or edits
    recalcSlotSeatsLeft(db, slotId);

    // Get the updated slot
    const updatedSlot = db.prepare('SELECT * FROM boat_slots WHERE id = ?').get(slotId);
    
    res.json({
      ...updatedSlot,
      debug: {
        endpoint: 'slots/:id',
        slotId,
        activeValue,
        updatedPresales: updatedPresalesCount,
        presalesTotal,
        presalesLive,
        presalesByStatus
      }
    });
  } catch (error) {
    console.error('[SELLING_500] route=/api/selling/dispatcher/slots/:id method=PATCH id=' + req.params.id + ' message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
  }
});

// Deactivate a slot
router.patch('/dispatcher/slots/:id/active', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const slotId = parseInt(req.params.id);
    const { active } = req.body;
    
    // Convert active to 0/1 integer for SQLite
    const activeValue =
      (active === true || active === 1 || active === '1' || active === 'true') ? 1 : 0;
    
    if (isNaN(slotId) || slotId <= 0) {
      return res.status(400).json({ error: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ ID СЃР»РѕС‚Р°' });
    }
    
    if (active === undefined) {
      return res.status(400).json({ error: 'РџРѕР»Рµ active РѕР±СЏР·Р°С‚РµР»СЊРЅРѕ' });
    }
    
    // Check if slot exists
    const slot = db.prepare('SELECT id, capacity, seats_left FROM boat_slots WHERE id = ?').get(slotId);
    if (!slot) {
      return res.status(404).json({ error: 'РЎР»РѕС‚ РЅРµ РЅР°Р№РґРµРЅ' });
    }
    
    // Get detailed presales diagnostics before update
    const presalesByStatus = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM presales
      WHERE (boat_slot_id = ? OR slot_uid = ?)
      GROUP BY status
    `).all(slotId, `manual:${slotId}`).reduce((acc, row) => {
      acc[row.status] = row.count;
      return acc;
    }, {});
    
    const presalesLive = db.prepare(`
      SELECT COUNT(*) as count
      FROM presales
      WHERE (boat_slot_id = ? OR slot_uid = ?)
        AND status IN ('ACTIVE','PAID','PARTIALLY_PAID','CONFIRMED')
    `).get(slotId, `manual:${slotId}`).count;
    
    const presalesTotal = db.prepare(`
      SELECT COUNT(*) as count
      FROM presales
      WHERE (boat_slot_id = ? OR slot_uid = ?)
    `).get(slotId, `manual:${slotId}`).count;
    
    let updatedPresalesCount = 0;
    // Use transaction to ensure atomicity: update presales AND update slot
    const transaction = db.transaction((slotId, activeValue) => {
      // When cancelling a trip (activeValue === 0), mark all presales as CANCELLED_TRIP_PENDING
      if (activeValue === 0) {
        // Update all "live" presales for this slot to CANCELLED_TRIP_PENDING status
        const updatePresalesStmt = db.prepare('UPDATE presales SET status = ? WHERE (boat_slot_id = ? OR slot_uid = ?) AND status IN (?, ?, ?, ?)');
        const result = updatePresalesStmt.run('CANCELLED_TRIP_PENDING', slotId, `manual:${slotId}`, 'ACTIVE', 'PAID', 'PARTIALLY_PAID', 'CONFIRMED');
        console.log('[TRIP_CANCEL] updated presales=', result.changes);
        updatedPresalesCount = result.changes;
      }
      
      // Update the active status
      const stmt = db.prepare('UPDATE boat_slots SET is_active = ? WHERE id = ?');
      stmt.run(activeValue, slotId);
    });
    
    // Execute the transaction
    transaction(slotId, activeValue);
    
    // Get the updated slot
    const updatedSlot = db.prepare('SELECT * FROM boat_slots WHERE id = ?').get(slotId);
    recalcSlotSeatsLeft(db, slotId);

    
    res.json({
      ...updatedSlot,
      debug: {
        endpoint: 'slots/:id/active',
        slotId,
        activeValue,
        updatedPresales: updatedPresalesCount,
        presalesTotal,
        presalesLive,
        presalesByStatus
      }
    });
  } catch (error) {
    console.error('[SELLING_500] route=/api/selling/dispatcher/slots/:id/active method=PATCH id=' + req.params.id + ' message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
  }
});

// Delete a slot
router.delete('/dispatcher/slots/:id', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const slotId = parseInt(req.params.id);
    
    if (isNaN(slotId) || slotId <= 0) {
      return res.status(400).json({ error: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ ID СЃР»РѕС‚Р°' });
    }
    
    // Check if slot exists
    const slot = db.prepare(`
      SELECT id, boat_id, time, is_active, capacity, seats_left
      FROM boat_slots 
      WHERE id = ?
    `).get(slotId);
    if (!slot) {
      return res.status(404).json({ error: 'Р РµР№СЃ РЅРµ РЅР°Р№РґРµРЅ' });
    }
    
    // Check for any presales (regardless of status) that would prevent hard deletion
    const presalesCount = db.prepare(`
      SELECT COUNT(*) as count 
      FROM presales 
      WHERE boat_slot_id = ?
    `).get(slotId).count;
    
    if (presalesCount > 0) {
      // Instead of hard delete, archive the slot by deactivating it
      const transaction = db.transaction(() => {
        // Update the slot to be inactive (archive it)
        const updateStmt = db.prepare('UPDATE boat_slots SET is_active = 0 WHERE id = ?');
        const updateResult = updateStmt.run(slotId);
        
        // Get the updated slot
        const updatedSlot = db.prepare(`
          SELECT id, boat_id, time, is_active, capacity, seats_left
          FROM boat_slots 
          WHERE id = ?
        `).get(slotId);
        
        return { updateResult, updatedSlot };
      });
      
      const result = transaction();
      
      if (result.updateResult.changes === 0) {
        return res.status(500).json({ error: 'РќРµ СѓРґР°Р»РѕСЃСЊ РґРµР°РєС‚РёРІРёСЂРѕРІР°С‚СЊ СЂРµР№СЃ' });
      }
      
      return res.json({
        ok: true,
        mode: 'archived',
        message: 'Р РµР№СЃ РЅРµР»СЊР·СЏ СѓРґР°Р»РёС‚СЊ, РїРѕС‚РѕРјСѓ С‡С‚Рѕ РїРѕ РЅРµРјСѓ РµСЃС‚СЊ РїСЂРѕРґР°Р¶Рё. Р РµР№СЃ РґРµР°РєС‚РёРІРёСЂРѕРІР°РЅ.',
        slot: result.updatedSlot
      });
    } else {
      // No presales, safe to delete
      const stmt = db.prepare('DELETE FROM boat_slots WHERE id = ?');
      const result = stmt.run(slotId);
      
      if (result.changes === 0) {
        return res.status(404).json({ error: 'Р РµР№СЃ РЅРµ РЅР°Р№РґРµРЅ' });
      }
      
      res.json({ 
        ok: true,
        mode: 'deleted',
        message: 'Р РµР№СЃ СѓРґР°Р»С‘РЅ',
        id: slotId 
      });
    }
  } catch (error) {
    console.error('[SELLING_500] route=/api/selling/dispatcher/slots/:id method=DELETE id=' + req.params.id + ' message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
  }
});

// Get all boats for dispatcher
router.get('/dispatcher/boats', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const boats = db.prepare('SELECT id, name, type, is_active FROM boats ORDER BY name').all();
    res.json(boats);
  } catch (error) {
    console.error('[SELLING_500] route=/api/selling/dispatcher/boats method=GET message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
  }
});

// Get sellers list for dispatcher (for "sell on behalf of seller" feature)
router.get('/dispatcher/sellers', authenticateToken, canSell, (req, res) => {
  try {
    const sellers = db.prepare(`
      SELECT id, username, is_active
      FROM users
      WHERE role = 'seller' AND is_active = 1
      ORDER BY id
    `).all();
    
    res.json({
      ok: true,
      data: {
        items: sellers
      }
    });
  } catch (error) {
    console.error('[SELLING_500] route=/api/selling/dispatcher/sellers method=GET message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ ok: false, error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
  }
});

// Get all slots for dispatcher (including inactive)
router.get('/dispatcher/slots', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const rawRows = db.prepare(`
      SELECT *
      FROM (
        SELECT
          gs.id as slot_id,
          ('generated:' || gs.id) as slot_uid,
          ('generated:' || gs.id) as slotUid,
          gs.id,
          gs.boat_id,
          gs.trip_date,
          gs.time,
          gs.capacity,
          gs.duration_minutes,
          gs.is_active,
          gs.price_adult as price,
          gs.price_adult,
          gs.price_child,
          gs.price_teen,
          b.name as boat_name,
          b.type as boat_type,
          b.is_active as boat_is_active,
          CASE WHEN b.id IS NULL THEN 1 ELSE 0 END as boat_missing,
          'generated' as source_type,
          gs.seats_left as seats_left_cache,
          (gs.capacity - COALESCE(tc.active_tickets, 0)) as seats_left
        FROM generated_slots gs
        LEFT JOIN boats b ON b.id = gs.boat_id
        LEFT JOIN (
          SELECT
            p.slot_uid as slot_uid,
            COUNT(1) as active_tickets
          FROM tickets t
          JOIN presales p ON p.id = t.presale_id
          WHERE t.status IN ('ACTIVE','PAID','UNPAID','RESERVED','PARTIALLY_PAID','CONFIRMED','USED')
          GROUP BY p.slot_uid
        ) tc ON tc.slot_uid = ('generated:' || gs.id)
        WHERE gs.trip_date IS NOT NULL

        UNION ALL

        SELECT
          bs.id as slot_id,
          ('manual:' || bs.id) as slot_uid,
          ('manual:' || bs.id) as slotUid,
          bs.id,
          bs.boat_id,
          bs.trip_date,
          bs.time,
          bs.capacity,
          bs.duration_minutes,
          bs.is_active,
          bs.price_adult as price,
          bs.price_adult,
          bs.price_child,
          bs.price_teen,
          b.name as boat_name,
          b.type as boat_type,
          b.is_active as boat_is_active,
          CASE WHEN b.id IS NULL THEN 1 ELSE 0 END as boat_missing,
          'manual' as source_type,
          bs.seats_left as seats_left_cache,
          (bs.capacity - COALESCE(tc.active_tickets, 0)) as seats_left
        FROM boat_slots bs
        LEFT JOIN boats b ON b.id = bs.boat_id
        LEFT JOIN (
          SELECT
            COALESCE(NULLIF(p.slot_uid, ''), 'manual:' || p.boat_slot_id) as slot_uid,
            COUNT(1) as active_tickets
          FROM tickets t
          JOIN presales p ON p.id = t.presale_id
          WHERE t.status IN ('ACTIVE','PAID','UNPAID','RESERVED','PARTIALLY_PAID','CONFIRMED','USED')
          GROUP BY COALESCE(NULLIF(p.slot_uid, ''), 'manual:' || p.boat_slot_id)
        ) tc ON tc.slot_uid = ('manual:' || bs.id)
        WHERE bs.trip_date IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM generated_slots gs_ref
            WHERE gs_ref.boat_id = bs.boat_id
              AND gs_ref.time = bs.time
              AND gs_ref.trip_date = bs.trip_date
          )
      )
      ORDER BY trip_date, time
    `).all();
    const rows = applyTelegramHoldVisibilityToSlots(rawRows);

    res.json(rows);
  } catch (error) {
    console.error('[SELLING_500] route=/api/selling/dispatcher/slots method=GET message=' + (error?.message || error) + ' stack=' + (error?.stack || ''));
    res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
  }
});

// Get tickets for a specific dispatcher slot
router.get('/dispatcher/ticket-lookup', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const rawQuery = String(req.query?.query ?? req.query?.q ?? '').trim();
    if (!rawQuery) {
      return res.status(400).json({ ok: false, error: 'QUERY_REQUIRED' });
    }

    const candidates = buildDispatcherTicketLookupCandidates(rawQuery);
    if (candidates.length === 0) {
      return res.status(400).json({ ok: false, error: 'QUERY_REQUIRED' });
    }

    let matched = null;
    let matchedBy = null;
    let matchedValue = null;

    for (const candidate of candidates) {
      const presaleIdCandidate = parsePositiveIntegerOrNull(candidate);
      if (presaleIdCandidate) {
        const presaleMatch = findDispatcherLookupByPresaleId(presaleIdCandidate);
        if (presaleMatch) {
          matched = presaleMatch;
          matchedBy = 'presale_id';
          matchedValue = candidate;
          break;
        }

        const ticketIdMatch = findDispatcherLookupByTicketId(presaleIdCandidate);
        if (ticketIdMatch) {
          matched = ticketIdMatch;
          matchedBy = 'ticket_id';
          matchedValue = candidate;
          break;
        }
      }

      try {
        const buyerTicketPresaleId = parseBuyerTicketCodeToCanonicalPresaleId(candidate);
        const buyerTicketMatch = findDispatcherLookupByPresaleId(buyerTicketPresaleId);
        if (buyerTicketMatch) {
          matched = buyerTicketMatch;
          matchedBy = 'buyer_ticket_code';
          matchedValue = candidate;
          break;
        }
      } catch {
        // Ignore unsupported buyer-ticket formats and continue with generic lookup.
      }

      const dispatcherPublicTicketPresaleId = parseDispatcherPublicTicketCodeToPresaleId(candidate);
      if (dispatcherPublicTicketPresaleId) {
        const dispatcherPublicTicketMatch = findDispatcherLookupByPresaleId(dispatcherPublicTicketPresaleId);
        if (dispatcherPublicTicketMatch) {
          matched = dispatcherPublicTicketMatch;
          matchedBy = 'public_ticket_code';
          matchedValue = candidate;
          break;
        }
      }

      const ticketCodeMatch = findDispatcherLookupByTicketCode(candidate);
      if (ticketCodeMatch) {
        matched = ticketCodeMatch;
        matchedBy = 'ticket_code';
        matchedValue = candidate;
        break;
      }
    }

    if (!matched) {
      return res.status(404).json({ ok: false, error: 'TICKET_NOT_FOUND' });
    }

    const resolvedPresaleId = Number(matched.presale_id);
    const buyerTicketCode =
      Number.isInteger(resolvedPresaleId) && resolvedPresaleId > 0
        ? buildBuyerTicketCodeFromCanonicalPresaleId(resolvedPresaleId)
        : null;
    const publicTicketCode = buildDispatcherPublicTicketCodeFromPresaleId(resolvedPresaleId);
    const totalPrice = Number(matched.total_price || 0);
    const prepaymentAmount = Number(matched.prepayment_amount || 0);
    const remainingAmount = Math.max(0, Math.round(totalPrice - prepaymentAmount));

    res.json({
      ok: true,
      query: rawQuery,
      matched_by: matchedBy,
      matched_value: matchedValue,
      match: {
        presale_id: resolvedPresaleId,
        ticket_id: matched.ticket_id != null ? Number(matched.ticket_id) : null,
        ticket_code: matched.ticket_code || null,
        buyer_ticket_code: buyerTicketCode,
        public_ticket_code: publicTicketCode,
        slot_uid: String(matched.slot_uid || ''),
        boat_slot_id: matched.boat_slot_id != null ? Number(matched.boat_slot_id) : null,
        presale_status: matched.presale_status || null,
        total_price: Math.round(totalPrice),
        prepayment_amount: Math.round(prepaymentAmount),
        remaining_amount: remainingAmount,
        payment_method: matched.payment_method || null,
        payment_cash_amount: Math.round(Number(matched.payment_cash_amount || 0)),
        payment_card_amount: Math.round(Number(matched.payment_card_amount || 0)),
        trip: {
          trip_date: matched.slot_trip_date || null,
          time: matched.slot_time || null,
          boat_name: matched.boat_name || null,
          boat_type: matched.boat_type || null,
        },
      },
    });
  } catch (error) {
    console.error('[SELLING_500] route=/api/selling/dispatcher/ticket-lookup method=GET message=' + (error?.message || error) + ' stack=' + (error?.stack || ''));
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// Get tickets for a specific dispatcher slot
router.get('/dispatcher/slots/:slotId/tickets', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const slotId = parseInt(req.params.slotId);
    
    if (isNaN(slotId)) {
      return res.status(400).json({ ok: false, error: 'INVALID_SLOT_ID' });
    }
    
    // Check if slot exists
    const slot = db.prepare('SELECT id FROM generated_slots WHERE id = ?').get(slotId);
    if (!slot) {
      return res.status(404).json({ ok: false, error: 'SLOT_NOT_FOUND' });
    }
    
    const slotUid = `generated:${slotId}`;
    
    // Get all tickets for this slot with presale and seller info
    const tickets = db.prepare(`
      SELECT 
        t.id as ticket_id,
        t.status as ticket_status,
        t.price as ticket_price,
        t.ticket_code,
        p.id as presale_id,
        p.status as presale_status,
        p.number_of_seats,
        p.customer_name,
        p.customer_phone,
        p.total_price,
        p.prepayment_amount,
        p.tickets_json,
        p.seller_id,
        u.username as seller_name,
        p.created_at,
        p.slot_uid
      FROM tickets t
      JOIN presales p ON p.id = t.presale_id
      LEFT JOIN users u ON u.id = p.seller_id
      WHERE p.slot_uid = ?
        AND t.status IN ('ACTIVE','PAID','UNPAID','RESERVED','PARTIALLY_PAID','CONFIRMED','USED')
        AND p.status NOT IN ('CANCELLED')
      ORDER BY p.created_at DESC, t.id ASC
    `).all(slotUid);
    
    // Determine category for each ticket from tickets_json
    const items = tickets.map((ticket, index) => {
      let category = 'adult'; // default
      
      if (ticket.tickets_json) {
        try {
          const breakdown = JSON.parse(ticket.tickets_json);
          const adultCount = parseInt(breakdown.adult || 0) || 0;
          const teenCount = parseInt(breakdown.teen || 0) || 0;
          const childCount = parseInt(breakdown.child || 0) || 0;
          
          // Determine category based on position
          if (index < adultCount) {
            category = 'adult';
          } else if (index < adultCount + teenCount) {
            category = 'teen';
          } else {
            category = 'child';
          }
        } catch (e) {
          // Keep default adult
        }
      }
      
      return {
        ticket_id: ticket.ticket_id,
        id: ticket.ticket_id, // alias for convenience
        status: ticket.ticket_status, // alias for convenience
        ticket_status: ticket.ticket_status,
        ticket_price: ticket.ticket_price,
        ticket_code: ticket.ticket_code,
        presale_id: ticket.presale_id,
        presale_status: ticket.presale_status,
        number_of_seats: ticket.number_of_seats,
        customer_name: ticket.customer_name,
        customer_phone: ticket.customer_phone,
        total_price: ticket.total_price,
        prepayment_amount: ticket.prepayment_amount,
        category,
        seller_id: ticket.seller_id,
        seller_name: ticket.seller_name,
        created_at: ticket.created_at
      };
    });
    
    res.json({
      ok: true,
      data: {
        slot_id: slotId,
        slot_uid: slotUid,
        items
      }
    });
  } catch (error) {
    console.error('[SELLING_500] route=/api/selling/dispatcher/slots/:slotId/tickets method=GET id=' + req.params.slotId + ' message=' + (error?.message || error) + ' stack=' + (error?.stack || ''));
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});



// Update presale payment (complete sale - for dispatcher)
router.patch('/presales/:id/payment', authenticateToken, canSell, (req, res) => {
  try {
    const presaleId = parseInt(req.params.id);
    const { additionalPayment } = req.body;
    const userId = req.user?.id;
    const userRole = req.user?.role;
    
    if (isNaN(presaleId)) {
      return res.status(400).json({ error: 'Invalid presale ID' });
    }
    
    const payment = parseInt(additionalPayment) || 0;
    if (isNaN(payment) || payment < 0) {
      return res.status(400).json({ error: 'Invalid payment amount' });
    }
    
    // Get the presale to check remaining amount and ownership
    const presale = db.prepare(`
      SELECT total_price, prepayment_amount, seller_id, business_day, slot_uid, boat_slot_id,
             payment_method, payment_cash_amount, payment_card_amount
      FROM presales
      WHERE id = ?
    `).get(presaleId);
    
    if (!presale) {
      return res.status(404).json({ error: 'Presale not found' });
    }
    
    // SECURITY: Only presale owner or dispatcher/admin/owner can update payment
    const isOwner = Number(presale.seller_id) === Number(userId);
    const isPrivileged = userRole === 'dispatcher' || userRole === 'admin' || userRole === 'owner';
    if (!isOwner && !isPrivileged) {
      return res.status(403).json({ error: 'Insufficient permissions to update payment for another seller\'s presale' });
    }

    const presaleBusinessDay = resolveBusinessDayForPresaleRow(presale);
    assertShiftOpenForPresaleDays(presaleId, presaleBusinessDay);
    
    const remainingAmount = presale.total_price - presale.prepayment_amount;
    
    if (payment > remainingAmount) {
      return res.status(400).json({ error: 'Payment amount exceeds remaining balance' });
    }
    
    // Update prepayment amount and keep payment split in sync for legacy /payment flow.
    const newPrepaymentAmount = Number(presale.prepayment_amount || 0) + Number(payment || 0);
    const totalPrice = Number(presale.total_price || 0);
    const isFullyPaidNow = newPrepaymentAmount >= totalPrice;

    let paymentMethodUpper = String(presale.payment_method || '').toUpperCase();
    let cashTotal = Math.max(0, Math.round(Number(presale.payment_cash_amount || 0)));
    let cardTotal = Math.max(0, Math.round(Number(presale.payment_card_amount || 0)));

    if (paymentMethodUpper !== 'CASH' && paymentMethodUpper !== 'CARD' && paymentMethodUpper !== 'MIXED') {
      if (cashTotal > 0 && cardTotal > 0) paymentMethodUpper = 'MIXED';
      else if (cardTotal > 0) paymentMethodUpper = 'CARD';
      else paymentMethodUpper = 'CASH';
    }

    let deltaCash = 0;
    let deltaCard = 0;
    if (payment > 0) {
      if (paymentMethodUpper === 'CASH') {
        deltaCash = payment;
      } else if (paymentMethodUpper === 'CARD') {
        deltaCard = payment;
      } else {
        // Keep MIXED split stable across incremental /payment calls.
        const baseCash = Math.max(0, cashTotal);
        const baseCard = Math.max(0, cardTotal);
        const baseSum = baseCash + baseCard;
        if (baseSum > 0) {
          deltaCash = Math.round((payment * baseCash) / baseSum);
          deltaCash = Math.max(0, Math.min(payment, deltaCash));
          deltaCard = payment - deltaCash;
        } else {
          deltaCash = Math.floor(payment / 2);
          deltaCard = payment - deltaCash;
        }
      }
    }

    cashTotal += deltaCash;
    cardTotal += deltaCard;

    const stmt = db.prepare(`
      UPDATE presales 
      SET
        prepayment_amount = ?,
        payment_method = ?,
        payment_cash_amount = ?,
        payment_card_amount = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    
    stmt.run(
      newPrepaymentAmount,
      paymentMethodUpper || null,
      cashTotal,
      cardTotal,
      presaleId
    );

    // Legacy endpoint compatibility: write sale movement to money_ledger too,
    // so shift-close (money_ledger source of truth) never misses accepted money.
    try {
      if (payment > 0) {
        const todayBusinessDay = getLocalBusinessDay();
        const tripBusinessDay = resolveBusinessDayForPresaleRow(presale);
        const saleAttribution = resolveSaleMoneyAttribution(presale.seller_id, userId);
        const ledgerKind = saleAttribution.ledger_kind;
        const ledgerSellerId = saleAttribution.attributed_user_id;

        let ledgerType = isFullyPaidNow ? 'SALE_ACCEPTED' : 'SALE_PREPAYMENT';
        if (paymentMethodUpper === 'MIXED') ledgerType = `${ledgerType}_MIXED`;
        else if (paymentMethodUpper === 'CARD') ledgerType = `${ledgerType}_CARD`;
        else ledgerType = `${ledgerType}_CASH`;

        const ledgerAmount = Math.round(Number(payment || 0));
        const split = normalizeLedgerCashCardSplit({
          method: paymentMethodUpper,
          amount: ledgerAmount,
          cashAmount: deltaCash,
          cardAmount: deltaCard,
        });
        insertSaleMoneyLedgerRow({
          presaleId,
          slotId: presale.boat_slot_id ?? null,
          kind: ledgerKind,
          type: ledgerType,
          method: paymentMethodUpper || null,
          amount: ledgerAmount,
          sellerId: ledgerSellerId,
          businessDay: todayBusinessDay,
          tripDay: tripBusinessDay,
          cashAmount: split.cash,
          cardAmount: split.card,
          decidedByUserId: userId,
        });
      }
    } catch (e) {
      console.warn('[PAYMENT_UPDATE] money_ledger write skipped:', e?.message || e);
    }
    
    // Get the updated presale
    const updatedPresale = db.prepare(`
      SELECT 
        id, boat_slot_id, customer_name, customer_phone, number_of_seats,
        total_price, prepayment_amount, prepayment_comment, status, tickets_json,
        payment_method, payment_cash_amount, payment_card_amount,
        (total_price - prepayment_amount) as remaining_amount,
        created_at, updated_at
      FROM presales 
      WHERE id = ?
    `).get(presaleId);
    
    res.json(updatedPresale);
  } catch (error) {
    const shiftClosedResponse = respondShiftClosedIfNeeded(res, error);
    if (shiftClosedResponse) return shiftClosedResponse;
    console.error('[SELLING_500] route=/api/selling/presales/:id/payment method=PATCH id=' + req.params.id + ' message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
  }
});

// Accept payment without changing status (canonical endpoint)
router.patch('/presales/:id/accept-payment', authenticateToken, canSell, (req, res) => {
  try {
    const presaleId = parseInt(req.params.id);
    const userId = req.user?.id;
    const userRole = req.user?.role;
    
    if (isNaN(presaleId)) {
      return res.status(400).json({ error: 'Invalid presale ID' });
    }
    
    // Find presale by id
    const presale = db.prepare(`
      SELECT id, boat_slot_id, customer_name, customer_phone, number_of_seats,
             total_price, prepayment_amount, prepayment_comment, status, tickets_json,
             payment_method, payment_cash_amount, payment_card_amount,
             (total_price - prepayment_amount) as remaining_amount,
             seller_id, business_day, slot_uid,
             created_at, updated_at
      FROM presales 
      WHERE id = ?
    `).get(presaleId);
    
    // If presale not found
    if (!presale) {
      return res.status(404).json({ error: 'Presale not found' });
    }
    
    // SECURITY: Only presale owner or dispatcher/admin/owner can accept payment
    const isOwner = Number(presale.seller_id) === Number(userId);
    const isPrivileged = userRole === 'dispatcher' || userRole === 'admin' || userRole === 'owner';
    if (!isOwner && !isPrivileged) {
      return res.status(403).json({ error: 'Insufficient permissions to accept payment for another seller\'s presale' });
    }
    
    // If presale.status != 'ACTIVE'
    if (presale.status !== 'ACTIVE') {
      return res.status(400).json({ error: 'Cannot accept payment for this status' });
    }

    const presaleBusinessDay = resolveBusinessDayForPresaleRow(presale);
    assertShiftOpenForPresaleDays(presaleId, presaleBusinessDay);
    
    // Accept remaining payment with method tracking
const remainingToPay = Number(presale.remaining_amount || 0);
const body = req.body || {};
const method = String(body.payment_method || body.method || '').toUpperCase();

if (method !== 'CASH' && method !== 'CARD' && method !== 'MIXED') {
  return res.status(400).json({ error: 'РќРµ СѓРєР°Р·Р°РЅ СЃРїРѕСЃРѕР± РѕРїР»Р°С‚С‹' });
}

let cashAmount = 0;
let cardAmount = 0;

if (method === 'CASH') {
  cashAmount = remainingToPay;
} else if (method === 'CARD') {
  cardAmount = remainingToPay;
} else {
  cashAmount = Number(body.cash_amount ?? body.cashAmount ?? 0);
  cardAmount = Number(body.card_amount ?? body.cardAmount ?? 0);

  if (!Number.isFinite(cashAmount) || !Number.isFinite(cardAmount) || cashAmount < 0 || cardAmount < 0) {
    return res.status(400).json({ error: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ СЃСѓРјРјС‹ РґР»СЏ РєРѕРјР±РёРЅРёСЂРѕРІР°РЅРЅРѕР№ РѕРїР»Р°С‚С‹' });
  }

  if (Math.round(cashAmount + cardAmount) !== Math.round(remainingToPay)) {
    return res.status(400).json({ error: 'РЎСѓРјРјР° РќРђР› + РљРђР РўРђ РґРѕР»Р¶РЅР° Р±С‹С‚СЊ СЂР°РІРЅР° РѕСЃС‚Р°С‚РєСѓ Рє РѕРїР»Р°С‚Рµ' });
  }

  if (cashAmount === 0 || cardAmount === 0) {
    return res.status(400).json({ error: 'Р”Р»СЏ РєРѕРјР±Рѕ СѓРєР°Р¶Рё СЃСѓРјРјС‹ Рё РґР»СЏ РЅР°Р»РёС‡РєРё, Рё РґР»СЏ РєР°СЂС‚С‹' });
  }
}

cashAmount = Math.max(0, Math.round(Number(cashAmount || 0)));
cardAmount = Math.max(0, Math.round(Number(cardAmount || 0)));

const prevCashTotal = Math.max(0, Math.round(Number(presale.payment_cash_amount || 0)));
const prevCardTotal = Math.max(0, Math.round(Number(presale.payment_card_amount || 0)));
const nextCashTotal = prevCashTotal + cashAmount;
const nextCardTotal = prevCardTotal + cardAmount;
let nextPaymentMethodUpper = 'CASH';
if (nextCashTotal > 0 && nextCardTotal > 0) nextPaymentMethodUpper = 'MIXED';
else if (nextCardTotal > 0) nextPaymentMethodUpper = 'CARD';

const stmt = db.prepare(`
  UPDATE presales 
  SET 
    prepayment_amount = total_price,
    payment_method = ?,
    payment_cash_amount = ?,
    payment_card_amount = ?,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

stmt.run(nextPaymentMethodUpper, nextCashTotal, nextCardTotal, presaleId);


    // Write seller money movement to money_ledger (so shift-close / seller balances can be computed)
    try {
      // idempotency: avoid duplicate ledger rows for the same presale accept
      const already = db.prepare(`
        SELECT 1
        FROM money_ledger
        WHERE presale_id = ?
          AND type LIKE 'SALE_ACCEPTED%'
        LIMIT 1
      `).get(presaleId);

      if (!already) {
        const bdRow = (() => {
          try { return db.prepare(`SELECT business_day FROM presales WHERE id = ?`).get(presaleId); }
          catch { return null; }
        })();
        const todayBusinessDay = (() => {
          try { return db.prepare(`SELECT DATE('now','localtime') AS d`).get()?.d; } catch { return null; }
        })() ?? null;
        const tripBusinessDay = (bdRow?.business_day ?? resolveBusinessDayFromSlot(presale?.slot_uid, presale?.boat_slot_id)) ?? null;

        // Keep trip-day attribution in presales.business_day for earned-by-trip-day analytics.
        try {
          if (!bdRow?.business_day && tripBusinessDay) {
            db.prepare(`UPDATE presales SET business_day = ? WHERE id = ? AND (business_day IS NULL OR business_day = '')`).run(tripBusinessDay, presaleId);
          }
        } catch (e) {
          console.warn('[ACCEPT_PAYMENT] presales.business_day backfill skipped:', e?.message || e);
        }

        const totalAccepted = Math.round((Number(cashAmount || 0) + Number(cardAmount || 0)) || 0);

        // Owner-of-money stays tied to sale attribution (seller_id),
        // while kind follows the actor who accepted the payment.
        const saleAttribution = resolveSaleMoneyAttribution(presale.seller_id, userId);
        const ledgerSellerId = saleAttribution.attributed_user_id;

        let ledgerType = 'SALE_ACCEPTED';
        if (Number(cashAmount) > 0 && Number(cardAmount) > 0) ledgerType = 'SALE_ACCEPTED_MIXED';
        else if (Number(cashAmount) > 0) ledgerType = 'SALE_ACCEPTED_CASH';
        else if (Number(cardAmount) > 0) ledgerType = 'SALE_ACCEPTED_CARD';
        const ledgerKind = resolveLedgerKindByActor(userId, saleAttribution.ledger_kind);
        const split = normalizeLedgerCashCardSplit({
          method,
          amount: totalAccepted,
          cashAmount,
          cardAmount,
        });

        insertSaleMoneyLedgerRow({
          presaleId,
          slotId: presale.boat_slot_id ?? null,
          kind: ledgerKind,
          type: ledgerType,
          method: method || null,
          amount: totalAccepted,
          sellerId: ledgerSellerId,
          // business_day in money_ledger is payment/refund cashflow day.
          businessDay: todayBusinessDay,
          // trip_day in money_ledger is the trip date (earned-by-trip-day / reserve semantics).
          tripDay: tripBusinessDay,
          cashAmount: split.cash,
          cardAmount: split.card,
          decidedByUserId: userId,
        });
      }
    } catch (e) {
      console.warn('[LEDGER_ACCEPT_PAYMENT_WRITE_FAIL]', e?.message || e);
    }

    // Persist payment method on tickets + canonical money layer.
    // IMPORTANT: Owner "РќР°Р»/РљР°СЂС‚Р°" Р°РЅР°Р»РёС‚РёРєР° С‡РёС‚Р°РµС‚СЃСЏ РёР· sales_transactions_canonical,
    // РїРѕСЌС‚РѕРјСѓ РїРѕСЃР»Рµ РїСЂРёРЅСЏС‚РёСЏ РѕРїР»Р°С‚С‹ РЅСѓР¶РЅРѕ СЃРёРЅС…СЂРѕРЅРёР·РёСЂРѕРІР°С‚СЊ РґРµРЅСЊРіРё РІ РєР°РЅРѕРЅРµ.
    try {
      const pmLower = String(nextPaymentMethodUpper).toLowerCase();
      // tickets may not have payment_method in older schemas
      try {
        db.prepare(`UPDATE tickets SET payment_method = ? WHERE presale_id = ?`).run(pmLower, presaleId);
      } catch (e) {
        console.warn('[ACCEPT_PAYMENT] tickets.payment_method update skipped:', e?.message || e);
      }

      // Sync sales_transactions_canonical if it exists.
      const canonExists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='sales_transactions_canonical'`).get();
      if (canonExists) {
        // Load ticket amounts from canon (source of truth for amount per ticket)
        const canonRows = db.prepare(`
          SELECT ticket_id, amount
          FROM sales_transactions_canonical
          WHERE presale_id = ? AND status = 'VALID'
          ORDER BY ticket_id ASC
        `).all(presaleId);

        if (canonRows && canonRows.length > 0) {
          const total = canonRows.reduce((s, r) => s + Number(r.amount || 0), 0);

          if (nextPaymentMethodUpper === 'CASH') {
            const upd = db.prepare(`
              UPDATE sales_transactions_canonical
              SET method = 'CASH', cash_amount = amount, card_amount = 0
              WHERE presale_id = ? AND status = 'VALID'
            `);
            upd.run(presaleId);
          } else if (nextPaymentMethodUpper === 'CARD') {
            const upd = db.prepare(`
              UPDATE sales_transactions_canonical
              SET method = 'CARD', cash_amount = 0, card_amount = amount
              WHERE presale_id = ? AND status = 'VALID'
            `);
            upd.run(presaleId);
          } else {
            // MIXED: split final paid cash/card totals proportionally across tickets.
            const cashTotal = Math.max(0, Math.round(Number(nextCashTotal || 0)));
            const denom = Math.max(1, total);
            const cashRatio = cashTotal / denom;

            let cashRemaining = cashTotal;
            const updOne = db.prepare(`
              UPDATE sales_transactions_canonical
              SET method = 'MIXED', cash_amount = ?, card_amount = ?
              WHERE ticket_id = ?
            `);

            for (let i = 0; i < canonRows.length; i++) {
              const row = canonRows[i];
              const amt = Math.round(Number(row.amount || 0));
              if (i === canonRows.length - 1) {
                // last ticket gets the РѕСЃС‚Р°С‚РѕРє
                const cashPart = Math.max(0, Math.min(amt, cashRemaining));
                const cardPart = amt - cashPart;
                updOne.run(cashPart, cardPart, row.ticket_id);
              } else {
                let cashPart = Math.round(amt * cashRatio);
                cashPart = Math.max(0, Math.min(cashPart, cashRemaining, amt));
                const cardPart = amt - cashPart;
                updOne.run(cashPart, cardPart, row.ticket_id);
                cashRemaining -= cashPart;
              }
            }
          }
        } else {
          console.warn('[ACCEPT_PAYMENT] sales_transactions_canonical has no rows for presale_id=', presaleId);
        }
      }
    } catch (syncErr) {
      console.error('[ACCEPT_PAYMENT] sync to canonical failed:', syncErr?.message || syncErr);
    }
    
    // Get the updated presale
    const updatedPresale = db.prepare(`
      SELECT 
        id, boat_slot_id, customer_name, customer_phone, number_of_seats,
        total_price, prepayment_amount, prepayment_comment, status, tickets_json,
        payment_method, payment_cash_amount, payment_card_amount,
        (total_price - prepayment_amount) as remaining_amount,
        created_at, updated_at
      FROM presales 
      WHERE id = ?
    `).get(presaleId);
    
    res.json(updatedPresale);
  } catch (error) {
    const shiftClosedResponse = respondShiftClosedIfNeeded(res, error);
    if (shiftClosedResponse) return shiftClosedResponse;
    console.error('[SELLING_500] route=/api/selling/presales/:id/accept-payment method=PATCH id=' + req.params.id + ' message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'РћС€РёР±РєР° РїСЂРё РїСЂРёРЅСЏС‚РёРё РѕРїР»Р°С‚С‹' });
  }
});

// Cancel presale (seller-initiated)
router.patch('/presales/:id/cancel', authenticateToken, canSell, (req, res) => {
  try {
    const presaleId = Number(req.params.id);

    if (!Number.isFinite(presaleId) || presaleId <= 0) {
      return res.status(400).json({ error: 'Invalid presale ID' });
    }

    const presaleGuardRow = db.prepare(`
      SELECT id, business_day, slot_uid, boat_slot_id
      FROM presales
      WHERE id = ?
    `).get(presaleId);
    if (!presaleGuardRow) {
      return res.status(404).json({ error: 'Presale not found' });
    }
    const presaleBusinessDay = resolveBusinessDayForPresaleRow(presaleGuardRow);
    assertShiftOpenForPresaleDays(presaleId, presaleBusinessDay);

    // Atomic cancel:
    // 1) presale.status -> CANCELLED
    // 2) all presale tickets -> REFUNDED (only those not already REFUNDED)
    // 3) restore seats to the correct slot using slot_uid when present
    // 4) verify ownership (seller can only cancel own presales)
    const transaction = db.transaction(() => {
      const presale = db.prepare(`
        SELECT id, boat_slot_id, slot_uid, business_day, status, seller_id
        FROM presales
        WHERE id = ?
      `).get(presaleId);

      if (!presale) throw Object.assign(new Error('Presale not found'), { code: 404 });
      if (presale.status === 'CANCELLED') throw Object.assign(new Error('Presale already cancelled'), { code: 400 });

      // SECURITY: Only presale owner or dispatcher/admin/owner can cancel
      const userRole = req.user?.role;
      const userId = req.user?.id;
      const isOwner = Number(presale.seller_id) === Number(userId);
      const isPrivileged = userRole === 'dispatcher' || userRole === 'admin' || userRole === 'owner';
      if (!isOwner && !isPrivileged) {
        throw Object.assign(new Error('Недостаточно прав для отмены чужой брони'), { code: 403 });
      }

      db.prepare(`
        UPDATE presales
        SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(presaleId);

      // If there were money movements already POSTED for this presale, reverse them on cancel.
      // We do NOT delete rows (audit). We insert compensating negative rows so totals go down.
      try {
        const ledgerExists = db
          .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='money_ledger'`)
          .get();
        if (ledgerExists) {
          const reverseTripDay = resolveBusinessDayForPresaleRow(presale);
          const nets = db.prepare(`
            SELECT business_day, kind, method, seller_id, slot_id, SUM(amount) AS net_amount
            FROM money_ledger
            WHERE presale_id = ? AND status = 'POSTED'
            GROUP BY business_day, kind, method, seller_id, slot_id
            HAVING net_amount <> 0
          `).all(presaleId);

          const insReverse = db.prepare(`
            INSERT INTO money_ledger
              (business_day, trip_day, kind, method, amount, status, seller_id, presale_id, slot_id, event_time, type, decision_final)
            VALUES
              (?, ?, ?, ?, ?, 'POSTED', ?, ?, ?, CURRENT_TIMESTAMP, 'SALE_CANCEL_REVERSE', 'CANCELLED')
          `);

          const refundBusinessDay = getLocalBusinessDay();
          for (const r of nets) {
            insReverse.run(
              refundBusinessDay,
              reverseTripDay,
              r.kind,
              r.method,
              -Number(r.net_amount || 0),
              r.seller_id ?? null,
              presaleId,
              r.slot_id ?? presale.boat_slot_id ?? null
            );
          }
        }
      } catch (e) {
        console.warn('[CANCEL_PRESALE] money_ledger reverse skipped:', e?.message || e);
      }

      const refunded = db.prepare(`
        UPDATE tickets
        SET status = 'REFUNDED', updated_at = CURRENT_TIMESTAMP
        WHERE presale_id = ? AND status != 'REFUNDED'
      `).run(presaleId).changes;

      const clampUpdateBoat = db.prepare(`
        UPDATE boat_slots
        SET seats_left = CASE
          WHEN seats_left + ? > capacity THEN capacity
          WHEN seats_left + ? < 0 THEN 0
          ELSE seats_left + ?
        END
        WHERE id = ?
      `);

      const clampUpdateGenerated = db.prepare(`
        UPDATE generated_slots
        SET seats_left = CASE
          WHEN seats_left + ? > capacity THEN capacity
          WHEN seats_left + ? < 0 THEN 0
          ELSE seats_left + ?
        END
        WHERE id = ?
      `);

      const delta = Number(refunded || 0);
      const slotUid = presale.slot_uid ? String(presale.slot_uid) : null;

      if (delta > 0) {
        if (slotUid && slotUid.startsWith('generated:')) {
          const id = Number(slotUid.split(':')[1]);
          if (Number.isFinite(id)) clampUpdateGenerated.run(delta, delta, delta, id);
        } else if (slotUid && slotUid.startsWith('manual:')) {
          const id = Number(slotUid.split(':')[1]);
          if (Number.isFinite(id)) clampUpdateBoat.run(delta, delta, delta, id);
        } else if (presale.boat_slot_id) {
          // fallback: legacy FK points to manual slot
          clampUpdateBoat.run(delta, delta, delta, presale.boat_slot_id);
        }
      }

      return { ok: true, id: presaleId, seats_restored: delta };
    });

    const result = transaction();

    const updatedPresale = db.prepare(`
      SELECT 
        id, boat_slot_id, customer_name, customer_phone, number_of_seats,
        total_price, prepayment_amount, prepayment_comment, tickets_json,
        (total_price - prepayment_amount) as remaining_amount,
        status, created_at, updated_at
      FROM presales 
      WHERE id = ?
    `).get(presaleId);

    return res.json({ ...updatedPresale, ...result });
  } catch (error) {
    const shiftClosedResponse = respondShiftClosedIfNeeded(res, error);
    if (shiftClosedResponse) return shiftClosedResponse;
    const code = error?.code && Number.isFinite(Number(error.code)) ? Number(error.code) : 500;
    if (code !== 500) return res.status(code).json({ error: error.message });
    console.error('[SELLING_500] route=/api/selling/presales/:id/cancel method=PATCH id=' + req.params.id + ' message=' + error.message + ' stack=' + error.stack);
    return res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
  }
});

// Move presale to another trip
router.patch('/presales/:id/move', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const presaleId = parseInt(req.params.id);
    const { target_slot_id } = req.body;
    
    if (isNaN(presaleId) || !target_slot_id) {
      return res.status(400).json({ error: 'Invalid presale ID or target slot ID' });
    }

    const presaleGuardRow = db.prepare(`
      SELECT id, business_day, slot_uid, boat_slot_id
      FROM presales
      WHERE id = ?
    `).get(presaleId);
    if (!presaleGuardRow) {
      return res.status(404).json({ error: 'Presale not found' });
    }
    const presaleBusinessDay = resolveBusinessDayForPresaleRow(presaleGuardRow);
    const targetSlotIdNum = Number(target_slot_id);
    const targetManualSlot = db.prepare(`SELECT trip_date FROM boat_slots WHERE id = ?`).get(targetSlotIdNum);
    const targetGeneratedSlot = targetManualSlot ? null : db.prepare(`SELECT trip_date FROM generated_slots WHERE id = ?`).get(targetSlotIdNum);
    const targetBusinessDay = targetManualSlot?.trip_date || targetGeneratedSlot?.trip_date || null;
    assertShiftOpenForPresaleDays(presaleId, presaleBusinessDay, targetBusinessDay ? [targetBusinessDay] : []);
    
    // Use transaction to ensure atomicity: update presale AND adjust seat counts
    const transaction = db.transaction((presaleId, targetSlotId) => {
      // Get the presale and current slot info
      const presale = db.prepare(`
        SELECT id, boat_slot_id, number_of_seats, status
        FROM presales
        WHERE id = ?
      `).get(presaleId);
      
      if (!presale) {
        throw new Error('Presale not found');
      }
      
      if (presale.status !== 'CANCELLED_TRIP_PENDING') {
        throw new Error('Presale must be in CANCELLED_TRIP_PENDING status');
      }
      
      // Determine if target slot is manual or generated
      const isManualSlot = db.prepare(`
        SELECT 1 FROM boat_slots WHERE id = ?
      `).get(targetSlotId);
      
      let targetSlot = null;
      if (isManualSlot) {
        // Get the target slot info from boat_slots
        targetSlot = db.prepare(`
          SELECT id, seats_left, capacity
          FROM boat_slots
          WHERE id = ? AND is_active = 1
        `).get(targetSlotId);
      } else {
        // Get the target slot info from generated_slots
        targetSlot = db.prepare(`
          SELECT id, seats_left, capacity
          FROM generated_slots
          WHERE id = ? AND is_active = 1
        `).get(targetSlotId);
      }
      
      if (!targetSlot) {
        throw new Error('Target slot not found or inactive');
      }
      
      // Check if there are enough seats available in target slot
      if (targetSlot.seats_left < presale.number_of_seats) {
        throw new Error('Not enough seats available in target slot');
      }
      
      // Compute FK-safe boat_slot_id and slot_uid for target
      let targetBoatSlotIdForFK = targetSlotId;
      
      // HARD STOP: prevent oversell on move
      assertCapacityOrThrow(targetBoatSlotIdForFK, presale.number_of_seats);

      let targetSlotUid = `manual:${targetSlotId}`;

      if (!isManualSlot) {
        // For generated slots, presales.boat_slot_id must reference boat_slots (FK).
        const genId = Number(targetSlotId);
        const gen = db.prepare(`
          SELECT boat_id, time, capacity, seats_left, duration_minutes,
                 price_adult, price_teen, price_child
          FROM generated_slots
          WHERE id = ?
        `).get(genId);

        if (!gen) {
          throw new Error('Target generated slot not found');
        }

        // Keep exact generated slot uid
        targetSlotUid = `generated:${genId}`;

        const existing = db.prepare(`
          SELECT id FROM boat_slots
          WHERE boat_id = ? AND time = ?
          LIMIT 1
        `).get(gen.boat_id, gen.time);

        if (existing) {
          targetBoatSlotIdForFK = existing.id;
        } else {
          const basePrice = (gen.price_adult ?? gen.price_teen ?? gen.price_child ?? 0);
          const r = db.prepare(`
            INSERT INTO boat_slots
              (boat_id, time, capacity, seats_left, duration_minutes, is_active,
               price, price_adult, price_teen, price_child)
            VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
          `).run(
            gen.boat_id,
            gen.time,
            gen.capacity ?? 0,
            gen.seats_left ?? gen.capacity ?? 0,
            gen.duration_minutes ?? 0,
            basePrice,
            gen.price_adult ?? null,
            gen.price_teen ?? null,
            gen.price_child ?? null
          );
          targetBoatSlotIdForFK = Number(r.lastInsertRowid);
        }
      }

      // Update the presale to point to the new slot and reactivate it
      const updatePresaleStmt = db.prepare(`
        UPDATE presales
        SET boat_slot_id = ?, slot_uid = ?, status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'CANCELLED_TRIP_PENDING'
      `);

      const presaleUpdateResult = updatePresaleStmt.run(targetBoatSlotIdForFK, targetSlotUid, presaleId);

      if (presaleUpdateResult.changes === 0) {
        throw new Error('Failed to update presale - may have been processed by another request');
      }

      // Revive tickets for this presale (if they exist)
      db.prepare(`
        UPDATE tickets
        SET boat_slot_id = ?, status = 'ACTIVE'
        WHERE presale_id = ?
      `).run(targetBoatSlotIdForFK, presaleId);

      // Reduce seats_left in the target slot
      if (isManualSlot) {
        // Update boat_slots table
        const updateTargetSeatsStmt = db.prepare(`
          UPDATE boat_slots
          SET seats_left = seats_left - ?
          WHERE id = ? AND seats_left >= ?
        `);
        
        const targetSeatsResult = updateTargetSeatsStmt.run(presale.number_of_seats, targetSlotId, presale.number_of_seats);
        
        if (targetSeatsResult.changes === 0) {
          throw new Error('Failed to update target slot seats - may have been updated by another request');
        }
      } else {
        // Update generated_slots table
        const updateGeneratedTargetSeatsStmt = db.prepare(`
          UPDATE generated_slots
          SET seats_left = seats_left - ?
          WHERE id = ? AND seats_left >= ?
        `);
        
        const targetSeatsResult = updateGeneratedTargetSeatsStmt.run(presale.number_of_seats, targetSlotId, presale.number_of_seats);
        
        if (targetSeatsResult.changes === 0) {
          throw new Error('Failed to update target slot seats - may have been updated by another request');
        }
      }
      
      return { presaleId: presaleId, targetSlotId: targetSlotId };
    });
    
    // Execute the transaction
    try {
      transaction(presaleId, target_slot_id);
    } catch (transactionError) {
      if (transactionError.message === 'Presale not found') {
        return res.status(404).json({ error: 'Presale not found' });
      }
      if (transactionError.message === 'Target slot not found or inactive') {
        return res.status(404).json({ error: 'Target slot not found or inactive' });
      }
      if (transactionError.message === 'Not enough seats available in target slot') {
        return res.status(400).json({ error: 'Not enough seats available in target slot' });
      }
      if (transactionError.message.includes('Failed to update')) {
        return res.status(400).json({ error: transactionError.message });
      }
      throw transactionError; // Re-throw other errors
    }
    
    // Get the updated presale
    const updatedPresale = db.prepare(`
      SELECT 
        id, boat_slot_id, customer_name, customer_phone, number_of_seats,
        total_price, prepayment_amount, prepayment_comment, status, tickets_json,
        payment_method, payment_cash_amount, payment_card_amount,
             payment_method, payment_cash_amount, payment_card_amount,
        (total_price - prepayment_amount) as remaining_amount,
        created_at, updated_at
      FROM presales 
      WHERE id = ?
    `).get(presaleId);
    
    res.json(updatedPresale);
  } catch (error) {
    const shiftClosedResponse = respondShiftClosedIfNeeded(res, error);
    if (shiftClosedResponse) return shiftClosedResponse;
    console.error('[SELLING_500] route=/api/selling/presales/:id/move method=PATCH id=' + req.params.id + ' message=' + error.message + ' stack=' + error.stack);
    if (error?.message === 'CAPACITY_EXCEEDED') {
      return res.status(409).json({ ok: false, code: 'CAPACITY_EXCEEDED', message: 'РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ РјРµСЃС‚ РІ СЂРµР№СЃРµ', details: error.details || null });
    }
    res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
  }
});

// Adjust presale seats (reduce only for now)
router.patch('/presales/:id/seats', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const presaleId = parseInt(req.params.id);
    const { number_of_seats, comment } = req.body;
    
    if (isNaN(presaleId)) {
      return res.status(400).json({ error: 'Invalid presale ID' });
    }
    
    if (number_of_seats === undefined || !Number.isInteger(number_of_seats) || number_of_seats < 1) {
      return res.status(400).json({ error: 'РљРѕР»РёС‡РµСЃС‚РІРѕ РјРµСЃС‚ РґРѕР»Р¶РЅРѕ Р±С‹С‚СЊ С†РµР»С‹Рј С‡РёСЃР»РѕРј РЅРµ РјРµРЅРµРµ 1' });
    }

    const presaleGuardRow = db.prepare(`
      SELECT id, business_day, slot_uid, boat_slot_id
      FROM presales
      WHERE id = ?
    `).get(presaleId);
    if (!presaleGuardRow) {
      return res.status(404).json({ error: 'Р‘СЂРѕРЅСЊ РЅРµ РЅР°Р№РґРµРЅР°' });
    }
    const presaleBusinessDay = resolveBusinessDayForPresaleRow(presaleGuardRow);
    assertShiftOpenForPresaleDays(presaleId, presaleBusinessDay);
    
    // Use transaction to ensure atomicity: update presale AND adjust slot seats
    const transaction = db.transaction((presaleId, newSeats) => {
      // Get the current presale to check current seats and boat slot
      const presale = db.prepare(`
        SELECT id, boat_slot_id, number_of_seats as current_seats, total_price
        FROM presales
        WHERE id = ?
      `).get(presaleId);
      
      if (!presale) {
        throw new Error('Presale not found');
      }
      
      // Check that new seats is not greater than current seats (for now only allow reducing)
      if (newSeats > presale.current_seats) {
        throw new Error('РќРѕРІРѕРµ РєРѕР»РёС‡РµСЃС‚РІРѕ РјРµСЃС‚ РЅРµ РјРѕР¶РµС‚ Р±С‹С‚СЊ Р±РѕР»СЊС€Рµ С‚РµРєСѓС‰РµРіРѕ');
      }
      
      // Calculate the difference
      const delta = presale.current_seats - newSeats;
      
      // Calculate new total price based on original price per seat
      const pricePerSeat = presale.total_price / presale.current_seats;
      const newTotalPrice = Math.round(pricePerSeat * newSeats);
      
      // Update the presale with new number of seats and recalculated total price
      const updatePresaleStmt = db.prepare(`
        UPDATE presales
        SET number_of_seats = ?,
            total_price = ?,
            updated_at = CURRENT_TIMESTAMP,
            prepayment_comment = COALESCE(?, prepayment_comment)
        WHERE id = ?
      `);
      
      updatePresaleStmt.run(newSeats, newTotalPrice, comment || null, presaleId);
      
      // Determine if this is a manual or generated slot
      const isManualSlot = db.prepare(`
        SELECT 1 FROM boat_slots WHERE id = ?
      `).get(presale.boat_slot_id);
      
      if (isManualSlot) {
        // Update boat_slots table
        const updateSlotStmt = db.prepare(`
          UPDATE boat_slots
          SET seats_left = seats_left + ?
          WHERE id = ?
        `);
        
        updateSlotStmt.run(delta, presale.boat_slot_id);
      } else {
        // Update generated_slots table
        const updateGeneratedSlotStmt = db.prepare(`
          UPDATE generated_slots
          SET seats_left = seats_left + ?
          WHERE id = ?
        `);
        
        updateGeneratedSlotStmt.run(delta, presale.boat_slot_id);
      }
      
      return { presaleId: presaleId, delta: delta };
    });
    
    // Execute the transaction
    try {
      transaction(presaleId, number_of_seats);
    } catch (transactionError) {
      if (transactionError.message === 'Presale not found') {
        return res.status(404).json({ error: 'Р‘СЂРѕРЅСЊ РЅРµ РЅР°Р№РґРµРЅР°' });
      }
      if (transactionError.message === 'РќРѕРІРѕРµ РєРѕР»РёС‡РµСЃС‚РІРѕ РјРµСЃС‚ РЅРµ РјРѕР¶РµС‚ Р±С‹С‚СЊ Р±РѕР»СЊС€Рµ С‚РµРєСѓС‰РµРіРѕ') {
        return res.status(400).json({ error: transactionError.message });
      }
      throw transactionError; // Re-throw other errors
    }
    
    // Get the updated presale
    const updatedPresale = db.prepare(`
      SELECT 
        id, boat_slot_id, customer_name, customer_phone, number_of_seats,
        total_price, prepayment_amount, prepayment_comment, status, tickets_json,
        payment_method, payment_cash_amount, payment_card_amount,
             payment_method, payment_cash_amount, payment_card_amount,
        (total_price - prepayment_amount) as remaining_amount,
        created_at, updated_at
      FROM presales 
      WHERE id = ?
    `).get(presaleId);
    
    res.json(updatedPresale);
  } catch (error) {
    const shiftClosedResponse = respondShiftClosedIfNeeded(res, error);
    if (shiftClosedResponse) return shiftClosedResponse;
    console.error('[SELLING_500] route=/api/selling/presales/:id/seats method=PATCH id=' + req.params.id + ' message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
  }
});

router.patch('/presales/:id/used', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const presaleId = parseInt(req.params.id);
    
    if (isNaN(presaleId)) {
      return res.status(400).json({ error: 'Invalid presale ID' });
    }
    
    // Get current presale to check status
    const currentPresale = db.prepare(`
      SELECT status, business_day, slot_uid, boat_slot_id FROM presales WHERE id = ?
    `).get(presaleId);
    
    if (!currentPresale) {
      return res.status(404).json({ error: 'Presale not found' });
    }

    const presaleBusinessDay = resolveBusinessDayForPresaleRow(currentPresale);
    assertShiftOpenForPresaleDays(presaleId, presaleBusinessDay);
    
    // Define which statuses are eligible for boarding ("active purchases")
    const eligibleStatuses = ['ACTIVE', 'CONFIRMED', 'PAID', 'PARTIALLY_PAID'];
    
    // Define which statuses are NOT eligible (already processed)
    const blockedStatuses = ['USED', 'CANCELLED', 'REFUNDED'];
    
    if (blockedStatuses.includes(currentPresale.status)) {
      return res.status(400).json({ 
        error: `Cannot mark as used: current status = ${currentPresale.status}` 
      });
    }
    
    if (!eligibleStatuses.includes(currentPresale.status)) {
      // For any other status not explicitly eligible, return error with current status
      return res.status(400).json({ 
        error: `Cannot mark as used: current status = ${currentPresale.status}` 
      });
    }
    
    // Update the presale status to USED
    const updatePresaleStmt = db.prepare(`
      UPDATE presales
      SET status = 'USED', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status IN ('ACTIVE', 'CONFIRMED', 'PAID', 'PARTIALLY_PAID')
    `);
    
    const result = updatePresaleStmt.run(presaleId);
    
    if (result.changes === 0) {
      return res.status(400).json({ error: 'Failed to mark presale as used - may not be in eligible status or already processed' });
    }
    
    // Get the updated presale
    const updatedPresale = db.prepare(`
      SELECT 
        id, boat_slot_id, customer_name, customer_phone, number_of_seats,
        total_price, prepayment_amount, prepayment_comment, status, tickets_json,
        payment_method, payment_cash_amount, payment_card_amount,
             payment_method, payment_cash_amount, payment_card_amount,
        (total_price - prepayment_amount) as remaining_amount,
        created_at, updated_at
      FROM presales 
      WHERE id = ?
    `).get(presaleId);
    
    res.json(updatedPresale);
  } catch (error) {
    const shiftClosedResponse = respondShiftClosedIfNeeded(res, error);
    if (shiftClosedResponse) return shiftClosedResponse;
    console.error('[SELLING_500] route=/api/selling/presales/:id/used method=PATCH id=' + req.params.id + ' message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
  }
});

router.patch('/presales/:id/refund', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const presaleId = parseInt(req.params.id);
    
    if (isNaN(presaleId)) {
      return res.status(400).json({ error: 'Invalid presale ID' });
    }

    const presaleGuardRow = db.prepare(`
      SELECT id, business_day, slot_uid, boat_slot_id
      FROM presales
      WHERE id = ?
    `).get(presaleId);
    if (!presaleGuardRow) {
      return res.status(404).json({ error: 'Presale not found' });
    }
    const presaleBusinessDay = resolveBusinessDayForPresaleRow(presaleGuardRow);
    assertShiftOpenForPresaleDays(presaleId, presaleBusinessDay);
    
    // Use transaction to ensure atomicity: update presale status AND update tickets AND adjust slot capacity
    const transaction = db.transaction((presaleId) => {
      // Get the presale to check its current state and boat slot
      const presale = db.prepare(`
        SELECT id, boat_slot_id, slot_uid, number_of_seats, status
        FROM presales
        WHERE id = ?
      `).get(presaleId);
      
      if (!presale) {
        throw new Error('Presale not found');
      }
      
      if (presale.status !== 'CANCELLED_TRIP_PENDING') {
        throw new Error('Presale must be in CANCELLED_TRIP_PENDING status');
      }
      
      // Determine if this is a manual or generated slot.
      // IMPORTANT: presale.boat_slot_id is a FK to boat_slots even for generated slots.
      // Source of truth for generated is presale.slot_uid like 'generated:<id>' -> generated_slots.id
      const slotUid = String(presale.slot_uid || '');
      const isGeneratedSlot = slotUid.startsWith('generated:');
      
      // Update the presale status to REFUNDED
      const updatePresaleStmt = db.prepare(`
        UPDATE presales
        SET status = 'REFUNDED', updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'CANCELLED_TRIP_PENDING'
      `);
      
      const result = updatePresaleStmt.run(presaleId);
      
      if (result.changes === 0) {
        throw new Error('Failed to refund presale - may not be in CANCELLED_TRIP_PENDING status or already processed');
      }
      
      // Update all ACTIVE tickets in the presale to REFUNDED status
      const updateTicketsStmt = db.prepare(`
        UPDATE tickets
        SET status = 'REFUNDED', updated_at = CURRENT_TIMESTAMP
        WHERE presale_id = ? AND status = 'ACTIVE'
      `);
      
      const ticketsResult = updateTicketsStmt.run(presaleId);

      // Restore the seats.
      // Prefer presales.number_of_seats (source of truth), fallback to refunded tickets count.
      const seatsToRestore = Number(presale.number_of_seats || 0) || Number(ticketsResult.changes || 0);
      if (seatsToRestore > 0) {
        if (isGeneratedSlot) {
          const genId = Number(slotUid.split(':')[1]);
          const updateGeneratedSeatsStmt = db.prepare(`
            UPDATE generated_slots
            SET seats_left = seats_left + ?
            WHERE id = ?
          `);
          updateGeneratedSeatsStmt.run(seatsToRestore, genId);
        } else {
          const updateSeatsStmt = db.prepare(`
            UPDATE boat_slots
            SET seats_left = seats_left + ?
            WHERE id = ?
          `);
          updateSeatsStmt.run(seatsToRestore, presale.boat_slot_id);
        }
      }
      
      // Get the updated presale
      const updatedPresale = db.prepare(`
        SELECT 
          id, boat_slot_id, customer_name, customer_phone, number_of_seats,
          total_price, prepayment_amount, prepayment_comment, status, tickets_json,
             payment_method, payment_cash_amount, payment_card_amount,
          (total_price - prepayment_amount) as remaining_amount,
          created_at, updated_at
        FROM presales 
        WHERE id = ?
      `).get(presaleId);
      
      return updatedPresale;
    });
    
    // Execute the transaction
    let updatedPresale;
    try {
      updatedPresale = transaction(presaleId);
    } catch (transactionError) {
      if (transactionError.message === 'Presale not found') {
        return res.status(404).json({ error: 'Presale not found' });
      }
      if (transactionError.message === 'Presale must be in CANCELLED_TRIP_PENDING status') {
        return res.status(400).json({ error: 'Presale must be in CANCELLED_TRIP_PENDING status' });
      }
      if (transactionError.message === 'Failed to refund presale - may not be in CANCELLED_TRIP_PENDING status or already processed') {
        return res.status(400).json({ error: 'Failed to refund presale - may not be in CANCELLED_TRIP_PENDING status or already processed' });
      }
      if (transactionError.message === 'Boat slot not found') {
        return res.status(404).json({ error: 'Boat slot not found' });
      }
      throw transactionError; // Re-throw other errors
    }
    
    res.json(updatedPresale);
  } catch (error) {
    const shiftClosedResponse = respondShiftClosedIfNeeded(res, error);
    if (shiftClosedResponse) return shiftClosedResponse;
    console.error('[SELLING_500] route=/api/selling/presales/:id/refund method=PATCH id=' + req.params.id + ' message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
  }
});

router.patch('/presales/:id/delete', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const presaleId = Number(req.params.id);
    const decision = String(req.body?.decision || 'REFUND').trim().toUpperCase();
    if (decision !== 'REFUND' && decision !== 'FUND') {
      return res.status(400).json({ error: 'Invalid decision. Use REFUND or FUND' });
    }

    const presale = db.prepare(`SELECT * FROM presales WHERE id = ?`).get(presaleId);
    if (!presale) return res.status(404).json({ error: 'Presale not found' });

    // РЅРµР»СЊР·СЏ "СѓРґР°Р»СЏС‚СЊ" С‚Рѕ, С‡С‚Рѕ СѓР¶Рµ Р·Р°РєСЂС‹С‚Рѕ С„РёРЅР°Р»СЊРЅРѕ
    if (['REFUNDED', 'CANCELLED', 'CANCELLED_TRIP_PENDING'].includes(presale.status)) {
      return res.status(400).json({ error: 'Cannot delete this presale in current status' });
    }

    const presaleBusinessDay = resolveBusinessDayForPresaleRow(presale);
    assertShiftOpenForPresaleDays(presaleId, presaleBusinessDay);

    const transaction = db.transaction(() => {
      // 1) РїРѕРјРµС‡Р°РµРј РїСЂРµСЃРµР№Р» РєР°Рє CANCELLED (СЌС‚Рѕ вЂњСЃР¶РµС‡СЊ Р±РёР»РµС‚вЂќ)
      db.prepare(`UPDATE presales SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(presaleId);

	  // 1.1) РµСЃР»Рё РїРѕ СЌС‚РѕРјСѓ presale СѓР¶Рµ Р±С‹Р»Рё POSTED РґРІРёР¶РµРЅРёСЏ РґРµРЅРµРі, РёС… РЅСѓР¶РЅРѕ СЂРµРІРµСЂСЃРЅСѓС‚СЊ,
	  // РёРЅР°С‡Рµ вЂњРЅР°Р»РёС‡РєР°/РїСЂРµРґРѕРїР»Р°С‚Р°вЂќ РЅРµ СѓРјРµРЅСЊС€РёС‚СЃСЏ РїРѕСЃР»Рµ СѓРґР°Р»РµРЅРёСЏ Р±РёР»РµС‚Р°.
	  // Р СЏРґС‹ РЅРµ СѓРґР°Р»СЏРµРј (audit), РґРѕР±Р°РІР»СЏРµРј РєРѕРјРїРµРЅСЃРёСЂСѓСЋС‰РёРµ РѕС‚СЂРёС†Р°С‚РµР»СЊРЅС‹Рµ СЃС‚СЂРѕРєРё.
	  try {
	    const ledgerExists = db
	      .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='money_ledger'`)
	      .get();
	    if (ledgerExists) {
	      const reverseTripDay = resolveBusinessDayForPresaleRow(presale);
	      const nets = db.prepare(`
	        SELECT business_day, kind, method, seller_id, slot_id, SUM(amount) AS net_amount
	        FROM money_ledger
	        WHERE presale_id = ? AND status = 'POSTED'
	        GROUP BY business_day, kind, method, seller_id, slot_id
	        HAVING net_amount <> 0
	      `).all(presaleId);

	      const insReverse = db.prepare(`
	        INSERT INTO money_ledger
	          (business_day, trip_day, kind, method, amount, status, seller_id, presale_id, slot_id, event_time, type, decision_final)
	        VALUES
	          (?, ?, ?, ?, ?, 'POSTED', ?, ?, ?, CURRENT_TIMESTAMP, 'SALE_CANCEL_REVERSE', 'CANCELLED')
	      `);

	      const refundBusinessDay = getLocalBusinessDay();
	      for (const r of nets) {
	        insReverse.run(
	          refundBusinessDay,
	          reverseTripDay,
	          r.kind,
	          r.method,
	          -Number(r.net_amount || 0),
	          r.seller_id ?? null,
	          presaleId,
	          r.slot_id ?? presale.boat_slot_id ?? null
	        );
	      }
	    }
	  } catch (e) {
	    console.warn('[DELETE_PRESALE] money_ledger reverse skipped:', e?.message || e);
	  }

      // 2) РїРѕРјРµС‡Р°РµРј РІСЃРµ РќР•-REFUNDED С‚РёРєРµС‚С‹ РІ СЌС‚РѕРј РїСЂРµСЃРµР№Р»Рµ РєР°Рє REFUNDED
      // (С‡С‚РѕР±С‹ РѕРЅРё РЅРµ СѓС‡РёС‚С‹РІР°Р»РёСЃСЊ РєР°Рє Р·Р°РЅСЏС‚С‹Рµ РјРµСЃС‚Р° Рё РЅРµ РјРµС€Р°Р»Рё РїРµСЂРµСЃС‡С‘С‚Сѓ seats_left)
      const refundTicketsStmt = db.prepare(`
        UPDATE tickets
        SET status = 'REFUNDED', updated_at = CURRENT_TIMESTAMP
        WHERE presale_id = ? AND status != 'REFUNDED'
      `);
      const refunded = refundTicketsStmt.run(presaleId).changes;

      // 2.1) Р’РђР–РќРћ: РµСЃР»Рё РїСЂРµСЃРµР№Р» СѓРґР°Р»РёР»Рё/РѕС‚РјРµРЅРёР»Рё, РІ money-РєР°РЅРѕРЅРµ РЅРµ РґРѕР»Р¶РЅРѕ РѕСЃС‚Р°РІР°С‚СЊСЃСЏ VALID-СЃС‚СЂРѕРє,
      // РёРЅР°С‡Рµ Owner Р±СѓРґРµС‚ РІРёРґРµС‚СЊ В«РѕР¶РёРґР°РµС‚ РѕРїР»Р°С‚С‹В» РїРѕ СѓР¶Рµ СѓРґР°Р»С‘РЅРЅС‹Рј Р±РёР»РµС‚Р°Рј.
      try {
        const canonExists = db
          .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='sales_transactions_canonical'`)
          .get();
        if (canonExists) {
          db.prepare(`
            UPDATE sales_transactions_canonical
            SET status = 'VOID'
            WHERE presale_id = ? AND status = 'VALID'
          `).run(presaleId);
        }
      } catch (e) {
        console.warn('[DELETE_PRESALE] canonical VOID skipped:', e?.message || e);
      }

      // 2.2) If dispatcher selected "to season fund", move presale prepayment to season fund
      // instead of returning it to customer.
      const prepaymentAmount = Number(presale.prepayment_amount || 0);
      if (decision === 'FUND' && prepaymentAmount > 0) {
        db.prepare(`
          INSERT INTO money_ledger
            (business_day, kind, method, amount, status, seller_id, presale_id, slot_id, event_time, type, decision_final)
          VALUES
            (?, 'FUND', 'INTERNAL', ?, 'POSTED', NULL, ?, ?, CURRENT_TIMESTAMP, 'SEASON_PREPAY_DELETE', 'FUND')
        `).run(
          presaleBusinessDay || getLocalBusinessDay(),
          prepaymentAmount,
          presaleId,
          presale.boat_slot_id ?? null
        );
      }

      // 3) РѕРїСЂРµРґРµР»СЏРµРј СЃР»РѕС‚ (manual/generated) Рё РІРѕР·РІСЂР°С‰Р°РµРј РјРµСЃС‚Р° (clamp 0..capacity)
      const slotUid = presale.slot_uid ? String(presale.slot_uid) : null;

      const clampUpdateBoat = db.prepare(`
        UPDATE boat_slots
        SET seats_left = CASE
          WHEN seats_left + ? > capacity THEN capacity
          WHEN seats_left + ? < 0 THEN 0
          ELSE seats_left + ?
        END
        WHERE id = ?
      `);

      const clampUpdateGenerated = db.prepare(`
        UPDATE generated_slots
        SET seats_left = CASE
          WHEN seats_left + ? > capacity THEN capacity
          WHEN seats_left + ? < 0 THEN 0
          ELSE seats_left + ?
        END
        WHERE id = ?
      `);

      const delta = Number(refunded || 0); // СЃС‚РѕР»СЊРєРѕ РјРµСЃС‚ СЂРµР°Р»СЊРЅРѕ РѕСЃРІРѕР±РѕРґРёР»Рё

      if (delta > 0) {
        if (slotUid && slotUid.startsWith('generated:')) {
          const id = Number(slotUid.split(':')[1]);
          clampUpdateGenerated.run(delta, delta, delta, id);
        } else if (slotUid && slotUid.startsWith('manual:')) {
          const id = Number(slotUid.split(':')[1]);
          clampUpdateBoat.run(delta, delta, delta, id);
        } else if (presale.boat_slot_id) {
          // fallback: СЃС‚Р°СЂРѕРµ РїРѕР»Рµ boat_slot_id (manual)
          clampUpdateBoat.run(delta, delta, delta, presale.boat_slot_id);
        }
      }

      // 4) СЃРёРЅС…СЂРѕРЅРёР·РёСЂСѓРµРј РёС‚РѕРіРѕРІС‹Рµ РїРѕР»СЏ РїСЂРµСЃРµР№Р»Р° (С‡С‚РѕР±С‹ РІ UI РЅРµ РІРёСЃРµР»Рё СЃС‚Р°СЂС‹Рµ вЂњР‘РёР»РµС‚РѕРІ/РЎСѓРјРјР°вЂќ)
      // РїРѕСЃР»Рµ "СѓРґР°Р»РёС‚СЊ Р±РёР»РµС‚" РІ Р°РєС‚РёРІРЅС‹С… РµРіРѕ СѓР¶Рµ РЅРµ РґРѕР»Р¶РЅРѕ Р±С‹С‚СЊ, РЅРѕ РґР°РЅРЅС‹Рµ РґРѕР»Р¶РЅС‹ Р±С‹С‚СЊ РєРѕРЅСЃРёСЃС‚РµРЅС‚РЅС‹
      db.prepare(`
        UPDATE presales
        SET number_of_seats = 0,
            total_price = 0,
            prepayment_amount = 0,
            tickets_json = '{"adult":0,"teen":0,"child":0}',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(presaleId);

      return { ok: true, id: presaleId, status: 'CANCELLED', seats_freed: delta };
    });

    const result = transaction();
    return res.json(result);
  } catch (e) {
    const shiftClosedResponse = respondShiftClosedIfNeeded(res, e);
    if (shiftClosedResponse) return shiftClosedResponse;
    console.error('[DELETE_PRESALE] failed', e);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Get tickets for a specific presale
router.get('/presales/:id/tickets', authenticateToken, canSell, (req, res) => {
  try {
    const presaleId = parseInt(req.params.id);
    
    if (isNaN(presaleId)) {
      return res.status(400).json({ error: 'Invalid presale ID' });
    }
    
    const tickets = db.prepare(`
      SELECT 
        id, presale_id, ticket_code, status, price,
        created_at, updated_at
      FROM tickets 
      WHERE presale_id = ?
      ORDER BY ticket_code
    `).all(presaleId);
    
    res.json(tickets.map((ticket) => ({
      ...ticket,
      public_ticket_code: buildDispatcherPublicTicketCodeFromPresaleId(ticket.presale_id),
    })));
  } catch (error) {
    console.error('[SELLING_500] route=/api/selling/presales/:id/tickets method=GET id=' + req.params.id + ' message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
  }
});

// Get tickets for a specific boat slot (trip)
router.get('/slots/:slotId/tickets', authenticateToken, canSell, (req, res) => {
  try {
    const slotIdRaw = String(req.params.slotId || '').trim();
    const isGenerated = slotIdRaw.startsWith('generated:');
    const isManual = slotIdRaw.startsWith('manual:');
    const slotIdNum = isGenerated
      ? null
      : parseInt(isManual ? slotIdRaw.slice('manual:'.length) : slotIdRaw, 10);

    if (!isGenerated && isNaN(slotIdNum)) {
      return res.status(400).json({ error: 'Invalid slot ID' });
    }

    const tickets = isGenerated
      ? db.prepare(`
          SELECT
            t.id, t.presale_id, t.ticket_code, t.status, t.price,
            t.created_at, t.updated_at,
            p.customer_name, p.customer_phone
          FROM presales p
          JOIN tickets t ON t.presale_id = p.id
          WHERE p.slot_uid = ?
            AND p.status NOT IN ('CANCELLED', 'CANCELLED_TRIP_PENDING', 'REFUNDED')
          ORDER BY t.ticket_code
        `).all(slotIdRaw)
      : db.prepare(`
          SELECT
            t.id, t.presale_id, t.ticket_code, t.status, t.price,
            t.created_at, t.updated_at,
            p.customer_name, p.customer_phone
          FROM tickets t
          JOIN presales p ON t.presale_id = p.id
          WHERE t.boat_slot_id = ?
            AND p.status NOT IN ('CANCELLED', 'CANCELLED_TRIP_PENDING', 'REFUNDED')
          ORDER BY t.ticket_code
        `).all(slotIdNum);

    res.json(tickets.map((ticket) => ({
      ...ticket,
      public_ticket_code: buildDispatcherPublicTicketCodeFromPresaleId(ticket.presale_id),
    })));
  } catch (error) {
    console.error('[SELLING_500] route=/api/selling/slots/:slotId/tickets method=GET id=' + req.params.slotId + ' message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'РћС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
  }
});

// Mark ticket as used
router.patch('/tickets/:ticketId/used', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const ticketId = req.params.ticketId;

    const markUsedTransaction = db.transaction(() => {
      const ticket = db.prepare(`
        SELECT
          t.*,
          CASE WHEN t.status = 'USED' THEN 1 ELSE 0 END as was_used
        FROM tickets t
        WHERE t.id = ?
      `).get(ticketId);

      if (!ticket) {
        res.status(404).json({ error: 'Ticket not found' });
        return null;
      }

      // Mark as used (boarding/attendance). This must NOT change seats_left (seats_left is for selling).
      db.prepare("UPDATE tickets SET status = 'USED' WHERE id = ?").run(ticketId);

      const updatedTicket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
      return updatedTicket;
    });

    const updatedTicket = markUsedTransaction();
    if (!updatedTicket) return;

    res.json({ success: true, ticket: updatedTicket });
  } catch (error) {
    console.error('Error marking ticket as used:', error);
    res.status(500).json({ error: 'Failed to mark ticket as used' });
  }
});

router.patch('/tickets/:ticketId/refund', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const ticketId = req.params.ticketId;

    const refundTransaction = db.transaction(() => {
      const ticket = db.prepare(`
        SELECT
          t.*,
          p.status as presale_status,
          p.prepayment_amount as presale_prepayment_amount,
          p.total_price as presale_total_price,
          p.slot_uid as presale_slot_uid,
          p.boat_slot_id as presale_boat_slot_id,
          p.business_day as presale_business_day,
          p.seller_id as presale_seller_id,
          p.payment_method as presale_payment_method,
          p.payment_cash_amount as presale_payment_cash_amount,
          p.payment_card_amount as presale_payment_card_amount
        FROM tickets t
        JOIN presales p ON p.id = t.presale_id
        WHERE t.id = ?
      `).get(ticketId);

      if (!ticket) {
        res.status(404).json({ error: 'Ticket not found' });
        return null;
      }

      if (ticket.status === 'REFUNDED') {
        return db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
      }

      db.prepare("UPDATE tickets SET status = 'REFUNDED' WHERE id = ?").run(ticketId);

      // If ticket is refunded/deleted, it must not remain VALID in money canonical
      try {
        const canonExists = db
          .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='sales_transactions_canonical'`)
          .get();
        if (canonExists) {
          db.prepare(`
            UPDATE sales_transactions_canonical
            SET status = 'VOID'
            WHERE ticket_id = ? AND status = 'VALID'
          `).run(ticketId);
        }
      } catch (e) {
        console.warn('[TICKET_REFUND] canonical VOID skipped:', e?.message || e);
      }


      // Free 1 seat back to slot inventory
      const slotUid = ticket.presale_slot_uid || '';
      if (slotUid.startsWith('generated:')) {
        const genId = Number(slotUid.split(':')[1]);
        db.prepare(`
          UPDATE generated_slots
          SET seats_left = MIN(capacity, seats_left + 1)
          WHERE id = ?
        `).run(genId);
      } else {
        db.prepare(`
          UPDATE boat_slots
          SET seats_left = MIN(capacity, seats_left + 1)
          WHERE id = ?
        `).run(ticket.presale_boat_slot_id);
      }

      // Recalculate presale total_price and number_of_seats based on remaining ACTIVE tickets
      const presaleId = ticket.presale_id;
      
      // Get slot prices to determine ticket types
      const presaleRow = db.prepare(`
        SELECT p.slot_uid, p.boat_slot_id,
               COALESCE(bs.price_adult, gs.price_adult, 0) as price_adult,
               COALESCE(bs.price_teen, gs.price_teen, 0) as price_teen,
               COALESCE(bs.price_child, gs.price_child, 0) as price_child
        FROM presales p
        LEFT JOIN boat_slots bs ON p.boat_slot_id = bs.id
        LEFT JOIN generated_slots gs ON (p.slot_uid LIKE 'generated:%' AND gs.id = CAST(substr(p.slot_uid, 11) AS INTEGER))
        WHERE p.id = ?
      `).get(presaleId);

      const activeTickets = db.prepare(`
        SELECT id, price
        FROM tickets
        WHERE presale_id = ? AND status = 'ACTIVE'
      `).all(presaleId);

      const newSeats = activeTickets.length;
      const newTotal = activeTickets.reduce((sum, t) => sum + Number(t.price ?? 0), 0);
      const oldPrepay = Number(ticket.presale_prepayment_amount ?? 0);
      const newPrepay = Math.max(0, Math.min(oldPrepay, newTotal));
      const fullDeletion = newSeats === 0;
      const paymentSnapshot = shrinkPresalePaymentSnapshot({
        paymentMethod: ticket.presale_payment_method,
        paymentCashAmount: ticket.presale_payment_cash_amount,
        paymentCardAmount: ticket.presale_payment_card_amount,
        paidAmount: oldPrepay,
        nextPaidAmount: newPrepay,
      });
      const tripDayForRefund =
        String(ticket.presale_business_day || '').trim() ||
        resolveBusinessDayFromSlot(ticket.presale_slot_uid, ticket.presale_boat_slot_id);

      // Recalculate tickets_json by counting ACTIVE tickets by type
      let cAdult = 0, cTeen = 0, cChild = 0;
      const pAdult = Number(presaleRow?.price_adult ?? 0);
      const pTeen = Number(presaleRow?.price_teen ?? 0);
      const pChild = Number(presaleRow?.price_child ?? 0);
      for (const t of activeTickets) {
        const p = Number(t.price ?? 0);
        if (pChild > 0 && p === pChild) cChild++;
        else if (pTeen > 0 && p === pTeen) cTeen++;
        else cAdult++;
      }
      const newTicketsJson = JSON.stringify({ adult: cAdult, teen: cTeen, child: cChild });

      console.log('[TICKET_REFUND recalc presale]', { presaleId, newSeats, newTotal, newTicketsJson });

      insertPartialSaleCancelReverseRows({
        presaleId,
        slotId: ticket.presale_boat_slot_id ?? null,
        tripDay: tripDayForRefund,
        sellerId: ticket.presale_seller_id ?? null,
        refundCash: paymentSnapshot.refundCash,
        refundCard: paymentSnapshot.refundCard,
      });

      db.prepare(`DELETE FROM money_ledger WHERE presale_id = ? AND kind = 'EXPECT_PAYMENT'`).run(presaleId);
      const remainingAfterRefund = Math.max(0, newTotal - newPrepay);
      if (!fullDeletion && remainingAfterRefund > 0) {
        db.prepare(`
          INSERT INTO money_ledger
          (presale_id, slot_id, trip_day, kind, method, amount, status, type)
          VALUES (?, ?, ?, 'EXPECT_PAYMENT', NULL, ?, 'POSTED', 'PENDING')
        `).run(presaleId, ticket.presale_boat_slot_id ?? null, tripDayForRefund, remainingAfterRefund);
      }

      db.prepare(`
        UPDATE presales
        SET number_of_seats = ?,
            total_price = ?,
            prepayment_amount = ?,
            payment_method = ?,
            payment_cash_amount = ?,
            payment_card_amount = ?,
            tickets_json = ?,
            status = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        newSeats,
        newTotal,
        fullDeletion ? 0 : newPrepay,
        paymentSnapshot.next.method,
        paymentSnapshot.next.cash,
        paymentSnapshot.next.card,
        newTicketsJson,
        fullDeletion ? 'CANCELLED' : 'ACTIVE',
        presaleId,
      );

      return db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
    });

    const updatedTicket = refundTransaction();
    if (!updatedTicket) return;

    res.json({ success: true, ticket: updatedTicket });
  } catch (error) {
    console.error('Error refunding ticket:', error);
    res.status(500).json({ error: 'Failed to refund ticket' });
  }
});

router.patch('/tickets/:ticketId/delete', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const ticketId = req.params.ticketId;
    const decision = String(req.body?.decision || 'REFUND').trim().toUpperCase();
    if (decision !== 'REFUND' && decision !== 'FUND') {
      return res.status(400).json({ error: 'Invalid decision. Use REFUND or FUND' });
    }

    const refundTransaction = db.transaction(() => {
      const ticket = db.prepare(`
        SELECT
          t.*,
          p.status as presale_status,
          p.prepayment_amount as presale_prepayment_amount,
          p.total_price as presale_total_price,
          p.slot_uid as presale_slot_uid,
          p.boat_slot_id as presale_boat_slot_id,
          p.business_day as presale_business_day,
          p.seller_id as presale_seller_id,
          p.payment_method as presale_payment_method,
          p.payment_cash_amount as presale_payment_cash_amount,
          p.payment_card_amount as presale_payment_card_amount
        FROM tickets t
        JOIN presales p ON p.id = t.presale_id
        WHERE t.id = ?
      `).get(ticketId);

      if (!ticket) {
        res.status(404).json({ error: 'Ticket not found' });
        return null;
      }

      const presaleStatus = String(ticket.presale_status || 'ACTIVE');
      if (presaleStatus !== 'ACTIVE') {
        res.status(409).json({ error: `Cannot modify ticket when presale status is ${presaleStatus}` });
        return null;
      }

      if (ticket.status === 'REFUNDED') {
        return db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
      }

      db.prepare("UPDATE tickets SET status = 'REFUNDED' WHERE id = ?").run(ticketId);

      // If ticket is refunded/deleted, it must not remain VALID in money canonical
      try {
        const canonExists = db
          .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='sales_transactions_canonical'`)
          .get();
        if (canonExists) {
          db.prepare(`
            UPDATE sales_transactions_canonical
            SET status = 'VOID'
            WHERE ticket_id = ? AND status = 'VALID'
          `).run(ticketId);
        }
      } catch (e) {
        console.warn('[TICKET_REFUND] canonical VOID skipped:', e?.message || e);
      }


      // Free 1 seat back to slot inventory
      const slotUid = ticket.presale_slot_uid || '';
      if (slotUid.startsWith('generated:')) {
        const genId = Number(slotUid.split(':')[1]);
        db.prepare(`
          UPDATE generated_slots
          SET seats_left = MIN(capacity, seats_left + 1)
          WHERE id = ?
        `).run(genId);
      } else {
        db.prepare(`
          UPDATE boat_slots
          SET seats_left = MIN(capacity, seats_left + 1)
          WHERE id = ?
        `).run(ticket.presale_boat_slot_id);
      }

      // Recalculate presale total_price and number_of_seats based on remaining ACTIVE tickets
      const presaleId = ticket.presale_id;
      
      // Get slot prices to determine ticket types
      const presaleRow = db.prepare(`
        SELECT p.slot_uid, p.boat_slot_id,
               COALESCE(bs.price_adult, gs.price_adult, 0) as price_adult,
               COALESCE(bs.price_teen, gs.price_teen, 0) as price_teen,
               COALESCE(bs.price_child, gs.price_child, 0) as price_child
        FROM presales p
        LEFT JOIN boat_slots bs ON p.boat_slot_id = bs.id
        LEFT JOIN generated_slots gs ON (p.slot_uid LIKE 'generated:%' AND gs.id = CAST(substr(p.slot_uid, 11) AS INTEGER))
        WHERE p.id = ?
      `).get(presaleId);

      const activeTickets = db.prepare(`
        SELECT id, price
        FROM tickets
        WHERE presale_id = ? AND status = 'ACTIVE'
      `).all(presaleId);

      const newSeats = activeTickets.length;
      const newTotal = activeTickets.reduce((sum, t) => sum + Number(t.price ?? 0), 0);
      const oldPrepay = Number(ticket.presale_prepayment_amount ?? 0);
      const newPrepay = Math.max(0, Math.min(oldPrepay, newTotal));
      const fullDeletion = newSeats === 0;
      const moveToSeasonFund = fullDeletion && decision === 'FUND' && oldPrepay > 0;
      const paymentSnapshot = shrinkPresalePaymentSnapshot({
        paymentMethod: ticket.presale_payment_method,
        paymentCashAmount: ticket.presale_payment_cash_amount,
        paymentCardAmount: ticket.presale_payment_card_amount,
        paidAmount: oldPrepay,
        nextPaidAmount: newPrepay,
      });
      const tripDayForDelete =
        String(ticket.presale_business_day || '').trim() ||
        resolveBusinessDayFromSlot(ticket.presale_slot_uid, ticket.presale_boat_slot_id);

      // Recalculate tickets_json by counting ACTIVE tickets by type
      let cAdult = 0, cTeen = 0, cChild = 0;
      const pAdult = Number(presaleRow?.price_adult ?? 0);
      const pTeen = Number(presaleRow?.price_teen ?? 0);
      const pChild = Number(presaleRow?.price_child ?? 0);
      for (const t of activeTickets) {
        const p = Number(t.price ?? 0);
        if (pChild > 0 && p === pChild) cChild++;
        else if (pTeen > 0 && p === pTeen) cTeen++;
        else cAdult++;
      }
      const newTicketsJson = JSON.stringify({ adult: cAdult, teen: cTeen, child: cChild });

      console.log('[TICKET_DELETE recalc presale]', { presaleId, newSeats, newTotal, newTicketsJson });

      if (!fullDeletion) {
        insertPartialSaleCancelReverseRows({
          presaleId,
          slotId: ticket.presale_boat_slot_id ?? null,
          tripDay: tripDayForDelete,
          sellerId: ticket.presale_seller_id ?? null,
          refundCash: paymentSnapshot.refundCash,
          refundCard: paymentSnapshot.refundCard,
        });
      }

      // If this was the last active ticket in presale, fully cancel presale finance and optionally move prepayment to season fund.
      if (fullDeletion) {
        try {
          const ledgerExists = db
            .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='money_ledger'`)
            .get();
          if (ledgerExists) {
            const reverseTripDay =
              String(ticket.presale_business_day || '').trim() ||
              resolveBusinessDayFromSlot(ticket.presale_slot_uid, ticket.presale_boat_slot_id);
            const nets = db.prepare(`
              SELECT business_day, kind, method, seller_id, slot_id, SUM(amount) AS net_amount
              FROM money_ledger
              WHERE presale_id = ? AND status = 'POSTED'
              GROUP BY business_day, kind, method, seller_id, slot_id
              HAVING net_amount <> 0
            `).all(presaleId);

            const insReverse = db.prepare(`
              INSERT INTO money_ledger
                (business_day, trip_day, kind, method, amount, status, seller_id, presale_id, slot_id, event_time, type, decision_final)
              VALUES
                (?, ?, ?, ?, ?, 'POSTED', ?, ?, ?, CURRENT_TIMESTAMP, 'SALE_CANCEL_REVERSE', 'CANCELLED')
            `);

            const refundBusinessDay = getLocalBusinessDay();
            for (const r of nets) {
              insReverse.run(
                refundBusinessDay,
                reverseTripDay,
                r.kind,
                r.method,
                -Number(r.net_amount || 0),
                r.seller_id ?? null,
                presaleId,
                r.slot_id ?? ticket.presale_boat_slot_id ?? null
              );
            }
          }
        } catch (e) {
          console.warn('[TICKET_DELETE] money_ledger reverse skipped:', e?.message || e);
        }
      }

      // Keep EXPECT_PAYMENT in sync with new order totals.
      db.prepare(`DELETE FROM money_ledger WHERE presale_id = ? AND kind = 'EXPECT_PAYMENT'`).run(presaleId);
      const remainingAfterDelete = Math.max(0, newTotal - newPrepay);
      if (!fullDeletion && remainingAfterDelete > 0) {
        db.prepare(`
          INSERT INTO money_ledger
          (presale_id, slot_id, trip_day, kind, method, amount, status, type)
          VALUES (?, ?, ?, 'EXPECT_PAYMENT', NULL, ?, 'POSTED', 'PENDING')
        `).run(presaleId, ticket.presale_boat_slot_id ?? null, tripDayForDelete, remainingAfterDelete);
      }

      if (fullDeletion) {
        try {
          const canonExists = db
            .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='sales_transactions_canonical'`)
            .get();
          if (canonExists) {
            db.prepare(`
              UPDATE sales_transactions_canonical
              SET status = 'VOID'
              WHERE presale_id = ? AND status = 'VALID'
            `).run(presaleId);
          }
        } catch (e) {
          console.warn('[TICKET_DELETE] canonical VOID skipped:', e?.message || e);
        }

        if (moveToSeasonFund) {
          const businessDay = resolveBusinessDayFromSlot(ticket.presale_slot_uid, ticket.presale_boat_slot_id);
          db.prepare(`
            INSERT INTO money_ledger
              (business_day, kind, method, amount, status, seller_id, presale_id, slot_id, event_time, type, decision_final)
            VALUES
              (?, 'FUND', 'INTERNAL', ?, 'POSTED', NULL, ?, ?, CURRENT_TIMESTAMP, 'SEASON_PREPAY_DELETE', 'FUND')
          `).run(
            businessDay || getLocalBusinessDay(),
            oldPrepay,
            presaleId,
            ticket.presale_boat_slot_id ?? null
          );
        }
      }

      const presaleStatusNext = fullDeletion ? 'CANCELLED' : 'ACTIVE';
      const prepayNext = fullDeletion ? 0 : newPrepay;
      db.prepare(`
        UPDATE presales
        SET number_of_seats = ?,
            total_price = ?,
            prepayment_amount = ?,
            payment_method = ?,
            payment_cash_amount = ?,
            payment_card_amount = ?,
            tickets_json = ?,
            status = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        newSeats,
        newTotal,
        prepayNext,
        paymentSnapshot.next.method,
        paymentSnapshot.next.cash,
        paymentSnapshot.next.card,
        newTicketsJson,
        presaleStatusNext,
        presaleId,
      );

      // Return updated presale in response for verification
      const updatedPresale = db.prepare('SELECT * FROM presales WHERE id = ?').get(presaleId);
      console.log('[TICKET_DELETE updated presale]', updatedPresale);

      return { ticket: db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId), presale: updatedPresale };
    });

    const result = refundTransaction();
    if (!result) return;

    res.json({ success: true, ticket: result.ticket, presale: result.presale });
  } catch (error) {
    console.error('Error refunding ticket:', error);
    res.status(500).json({ error: 'Failed to refund ticket' });
  }
});


function transferTicketToAnotherSlot(req, res) {
  try {
    const ticketId = Number(req.params.ticketId);
    const toSlotUid = req.body?.to_slot_uid;

    if (!toSlotUid) return res.status(400).json({ error: 'to_slot_uid required' });

    const tx = db.transaction(() => {
      // Load ticket + presale + slot prices to infer ticket type
      const row = db.prepare(`
        SELECT
          t.*,
          p.customer_name, p.customer_phone,
          p.seller_id as presale_seller_id,
          p.zone_at_sale as presale_zone_at_sale,
          p.boat_slot_id as presale_boat_slot_id,
          p.slot_uid as presale_slot_uid,
          p.tickets_json as presale_tickets_json,
          p.number_of_seats as presale_number_of_seats,
          p.total_price as presale_total_price,
          p.prepayment_amount as presale_prepayment_amount,
          p.status as presale_status,
          COALESCE(bs.price_adult, gs.price_adult) as price_adult,
          COALESCE(bs.price_teen, gs.price_teen) as price_teen,
          COALESCE(bs.price_child, gs.price_child) as price_child
        FROM tickets t
        JOIN presales p ON p.id = t.presale_id
        LEFT JOIN boat_slots bs ON (p.boat_slot_id = bs.id)
        LEFT JOIN generated_slots gs ON (p.slot_uid LIKE 'generated:%' AND gs.id = CAST(substr(p.slot_uid, 11) AS INTEGER))
        WHERE t.id = ?
      `).get(ticketId);

      if (!row) return { error: 'Ticket not found', code: 404 };
      if (String(row.status) !== 'ACTIVE') return { error: 'Ticket not ACTIVE', code: 400 };
      if (String(row.presale_status || 'ACTIVE') !== 'ACTIVE') return { error: `Cannot transfer ticket when presale status is ${row.presale_status}`, code: 409 };

      const fromSlotUid = String(row.presale_slot_uid || (row.presale_boat_slot_id ? `manual:${row.presale_boat_slot_id}` : ''));
      if (!fromSlotUid) return { error: 'Source СЂРµР№СЃ not found', code: 400 };
      if (String(fromSlotUid) === String(toSlotUid)) return { error: 'Cannot transfer to same СЂРµР№СЃ', code: 400 };

      const toParsed = parseSlotUid(toSlotUid);
      if (!toParsed) return { error: 'Invalid to_slot_uid', code: 400 };

      // Check target availability (need 1 seat)
      let targetSeatsLeft = 0;
      if (toParsed.source === 'generated') {
        const r = db.prepare(`SELECT seats_left FROM generated_slots WHERE id = ?`).get(toParsed.id);
        targetSeatsLeft = Number(r?.seats_left ?? 0);
      } else {
        const r = db.prepare(`SELECT seats_left FROM boat_slots WHERE id = ?`).get(toParsed.id);
        targetSeatsLeft = Number(r?.seats_left ?? 0);
      }
      if (targetSeatsLeft < 1) return { error: 'Not enough seats in target СЂРµР№СЃ', code: 400 };

      const targetBaseBoatSlotId = getBaseBoatSlotIdForSlot(toSlotUid);
      if (!targetBaseBoatSlotId) return { error: 'Target СЂРµР№СЃ base slot not found', code: 400 };

      // Infer ticket_type by price (fallback to adult)
      const pAdult = Number(row.price_adult ?? 0);
      const pTeen  = Number(row.price_teen ?? 0);
      const pChild = Number(row.price_child ?? 0);
      const tPrice = Number(row.price ?? 0);

      let ticketType = 'adult';
      if (pChild > 0 && tPrice === pChild) ticketType = 'child';
      else if (pTeen > 0 && tPrice === pTeen) ticketType = 'teen';

      
      // IMPORTANT: do NOT merge transfers into a single "aggregate" presale.
      // Merging caused confusing pending/owner analytics when old transferred tickets were deleted/cancelled.
      // Always create a fresh presale per transferred ticket.
      const transferMarker = 'TRANSFER_SINGLE';

      const newTicketsJson = JSON.stringify({
        adult: ticketType === 'adult' ? 1 : 0,
        teen:  ticketType === 'teen'  ? 1 : 0,
        child: ticketType === 'child' ? 1 : 0
      });

      // IMPORTANT: business_day for transferred presales must follow the СЂРµР№СЃ date (trip_date),
      // not the timestamp of the transfer operation. Otherwise Owner "revenue by day" keeps
      // the amount in the old day after moving the ticket to tomorrow.
      let targetBusinessDay = null;
      try {
        if (toParsed.source === 'generated') {
          // Schema-safe: some DBs may have trip_day/date column instead of trip_date.
          const cols = db
            .prepare(`PRAGMA table_info(generated_slots)`)
            .all()
            .map((r) => String(r.name || '').toLowerCase());

          const candidates = ['trip_date', 'trip_day', 'day', 'date'];
          const col = candidates.find((c) => cols.includes(c)) || null;
          if (col) {
            const d = db.prepare(`SELECT ${col} AS d FROM generated_slots WHERE id = ?`).get(toParsed.id);
            targetBusinessDay = String(d?.d || '') || null;
          }
        }
      } catch {
        targetBusinessDay = null;
      }
      if (!targetBusinessDay) {
        targetBusinessDay = db.prepare(`SELECT date('now','localtime') AS d`).get()?.d || null;
      }

      const ins = db.prepare(`
        INSERT INTO presales (
          boat_slot_id, slot_uid, customer_name, customer_phone,
          number_of_seats, total_price, prepayment_amount, prepayment_comment, status,
          tickets_json, business_day, seller_id, zone_at_sale, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?,
          1, ?, 0, ?, 'ACTIVE',
          ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `).run(
        targetBaseBoatSlotId,
        String(toSlotUid),
        row.customer_name || '',
        row.customer_phone || '',
        tPrice,
        transferMarker,
        newTicketsJson,
        targetBusinessDay,
        row.presale_seller_id ?? null,
        row.presale_zone_at_sale ?? null,
      );

      const newPresaleId = Number(ins.lastInsertRowid);

      // Move the ticket to new presale & update its base boat_slot_id
      db.prepare(`
        UPDATE tickets
        SET presale_id = ?, boat_slot_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(newPresaleId, targetBaseBoatSlotId, ticketId);

      // Update old presale aggregates
      const oldPresaleId = Number(row.presale_id);
      const oldSeats = Number(row.presale_number_of_seats ?? 0);
      const newOldSeats = Math.max(0, oldSeats - 1);

      const oldTotal = Number(row.presale_total_price ?? 0);
      const newOldTotal = Math.max(0, oldTotal - tPrice);

      const oldPrepay = Number(row.presale_prepayment_amount ?? 0);
      const newOldPrepay = Math.min(oldPrepay, newOldTotal);

      let oldCounts = null;
      try { oldCounts = row.presale_tickets_json ? JSON.parse(row.presale_tickets_json) : null; } catch { oldCounts = null; }
      const counts = {
        adult: Math.max(0, Number(oldCounts?.adult ?? 0)),
        teen:  Math.max(0, Number(oldCounts?.teen ?? 0)),
        child: Math.max(0, Number(oldCounts?.child ?? 0))
      };
      if (ticketType === 'adult') counts.adult = Math.max(0, counts.adult - 1);
      if (ticketType === 'teen')  counts.teen  = Math.max(0, counts.teen  - 1);
      if (ticketType === 'child') counts.child = Math.max(0, counts.child - 1);

      const newOldTicketsJson = JSON.stringify(counts);
      const newStatus = newOldSeats === 0 ? 'CANCELLED' : 'ACTIVE';

      db.prepare(`
        UPDATE presales
        SET number_of_seats = ?, total_price = ?, prepayment_amount = ?, tickets_json = ?, status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(newOldSeats, newOldTotal, newOldPrepay, newOldTicketsJson, newStatus, oldPresaleId);

      // Seats: free 1 in old СЂРµР№СЃ and take 1 in new СЂРµР№СЃ
      applySeatsDelta(fromSlotUid, +1);
      applySeatsDelta(toSlotUid, -1);

      // Recalc pending for the new presale (transferred ticket)
      recalcPendingForTransfer(newPresaleId, String(toSlotUid), targetBaseBoatSlotId, tPrice, 0);

      // Recalc pending for the old presale (remaining balance may have changed)
      // Need to get the old slot's trip_day for proper cleanup
      let oldTripDay = null;
      try {
        if (fromSlotUid && typeof fromSlotUid === 'string' && fromSlotUid.startsWith('generated:')) {
          const genId = Number(String(fromSlotUid).slice('generated:'.length));
          if (Number.isFinite(genId)) {
            const row = db.prepare('SELECT trip_date FROM generated_slots WHERE id = ?').get(genId);
            if (row?.trip_date) oldTripDay = row.trip_date;
          }
        }
      } catch (_) {}
      if (!oldTripDay && row?.presale_boat_slot_id) {
        try {
          const row = db.prepare('SELECT trip_date FROM boat_slots WHERE id = ?').get(row.presale_boat_slot_id);
          if (row?.trip_date) oldTripDay = row.trip_date;
        } catch (_) {}
      }
      // Delete old EXPECT_PAYMENT for old presale and re-create if needed
      db.prepare(`DELETE FROM money_ledger WHERE presale_id = ? AND kind = 'EXPECT_PAYMENT'`).run(oldPresaleId);
      const oldRemaining = Math.max(0, newOldTotal - newOldPrepay);
      if (oldRemaining > 0 && newStatus !== 'CANCELLED') {
        db.prepare(`
          INSERT INTO money_ledger
          (presale_id, slot_id, trip_day, kind, method, amount, status, type)
          VALUES (?, ?, ?, 'EXPECT_PAYMENT', NULL, ?, 'POSTED', 'PENDING')
        `).run(oldPresaleId, row?.presale_boat_slot_id ?? null, oldTripDay, oldRemaining);
      }

      const updatedTicket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
      return {
        ok: true,
        ticket: updatedTicket,
        new_presale_id: newPresaleId,
        affected_days: {
          old_day: oldTripDay,
          new_day: targetBusinessDay
        }
      };
    });

    const result = tx();
    if (result?.error) return res.status(result.code || 400).json({ error: result.error });

    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error transferring ticket:', error);
    res.status(500).json({ error: error.message || 'Failed to transfer ticket' });
  }
}

router.post('/tickets/:ticketId/transfer', authenticateToken, canDispatchManageSlots, transferTicketToAnotherSlot);
router.patch('/tickets/:ticketId/transfer', authenticateToken, canDispatchManageSlots, transferTicketToAnotherSlot);



// Transfer options for UI dropdown (only СЂРµР№СЃС‹ where sales are open: is_active=1)
router.get('/transfer-options', authenticateToken, canSellOrDispatch, (req, res) => {
  try {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    // We'll include:
    // - manual slots (boat_slots) where is_active=1
    // - generated slots where is_active=1 AND trip_date >= today (and if today, time >= now time)
    const currentTimeHHMM = now.toTimeString().slice(0, 5);

    const rows = db.prepare(`
      SELECT
        bs.id as slot_id,
        'manual:' || bs.id as slot_uid,
        date('now','localtime') as trip_date,
        bs.time as time,
        b.name as boat_name,
        b.type as boat_type,
        bs.duration_minutes as duration_minutes,
        bs.seats_left as seats_left,
        bs.is_active as is_active
      FROM boat_slots bs
      JOIN boats b ON b.id = bs.boat_id
      WHERE bs.is_active = 1 AND b.is_active = 1

      UNION ALL

      SELECT
        gs.id as slot_id,
        ('generated:' || gs.id) as slot_uid,
        gs.trip_date as trip_date,
        gs.time as time,
        b.name as boat_name,
        b.type as boat_type,
        gs.duration_minutes as duration_minutes,
        gs.seats_left as seats_left,
        gs.is_active as is_active
      FROM generated_slots gs
      JOIN boats b ON b.id = gs.boat_id
      WHERE gs.is_active = 1 AND b.is_active = 1
        AND gs.trip_date >= ?
        AND (gs.trip_date > ? OR gs.time >= ?)
      ORDER BY
        (trip_date IS NULL) ASC,
        trip_date ASC,
        time ASC
    `).all(todayStr, todayStr, currentTimeHHMM);

    const options = (rows || []).map(r => {
      let dayLabel = '';
      if (!r.trip_date) {
        dayLabel = 'РЎРµРіРѕРґРЅСЏ';
      } else if (r.trip_date === todayStr) {
        dayLabel = 'РЎРµРіРѕРґРЅСЏ';
      } else {
        const tomorrow = new Date(now);
        tomorrow.setDate(now.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().slice(0, 10);
        if (r.trip_date === tomorrowStr) {
          dayLabel = 'Р—Р°РІС‚СЂР°';
        } else {
          // DD.MM
          const [y, m, d] = String(r.trip_date).split('-');
          dayLabel = `${d}.${m}`;
        }
      }

      const seatsLeft = Number(r.seats_left ?? 0);
      const label = `${dayLabel} ${r.time} вЂў ${r.boat_name} вЂў СЃРІРѕР±РѕРґРЅРѕ ${seatsLeft}`;

      return {
        slot_uid: r.slot_uid,
        trip_date: r.trip_date,
        time: r.time,
        boat_name: r.boat_name,
        boat_type: r.boat_type,
        duration_minutes: r.duration_minutes,
        seats_left: seatsLeft,
        label
      };
    });

    res.json({ options });
  } catch (error) {
    console.error('Error building transfer options:', error);
    res.status(500).json({ error: 'Failed to load transfer options' });
  }
});

// Helper: parse slot_uid and return { source, id }
function parseSlotUid(slotUid) {
  const s = String(slotUid || '');
  const [src, idStr] = s.split(':');
  const id = Number(idStr);
  if (!src || !Number.isFinite(id)) return null;
  if (src !== 'manual' && src !== 'generated') return null;
  return { source: src, id };
}

// Helper: get base boat_slot_id for a target slot_uid
function getBaseBoatSlotIdForSlot(slotUid) {
  const parsed = parseSlotUid(slotUid);
  if (!parsed) return null;

  if (parsed.source === 'manual') return parsed.id;

  // generated slot -> map to base boat_slots by (boat_id, time)
  const row = db.prepare(`
    SELECT bs_ref.id as base_boat_slot_id
    FROM generated_slots gs
    LEFT JOIN boat_slots bs_ref ON (bs_ref.boat_id = gs.boat_id AND bs_ref.time = gs.time)
    WHERE gs.id = ?
  `).get(parsed.id);

  if (row?.base_boat_slot_id) return row.base_boat_slot_id;

  // If missing base slot, create it once (does NOT show in dispatcher list because dispatcher uses generated_slots)
  const gs = db.prepare(`
    SELECT boat_id, time, capacity, seats_left, duration_minutes,
           price_adult, price_child, price_teen, seller_cutoff_minutes
    FROM generated_slots
    WHERE id = ?
  `).get(parsed.id);

  if (!gs?.boat_id || !gs?.time) return null;

  const price = Number(gs.price_adult ?? gs.price_teen ?? gs.price_child ?? 0);

  // boat_slots.price is NOT NULL in schema -> always set
  db.prepare(`
    INSERT OR IGNORE INTO boat_slots (
      boat_id, time, price, is_active, seats_left, capacity, duration_minutes,
      price_adult, price_child, price_teen, seller_cutoff_minutes
    ) VALUES (
      ?, ?, ?, 1, ?, ?, ?,
      ?, ?, ?, ?
    )
  `).run(
    gs.boat_id,
    String(gs.time),
    price,
    Number(gs.seats_left ?? gs.capacity ?? 0),
    Number(gs.capacity ?? 0),
    Number(gs.duration_minutes ?? 0),
    gs.price_adult ?? null,
    gs.price_child ?? null,
    gs.price_teen ?? null,
    gs.seller_cutoff_minutes ?? null
  );

  const created = db.prepare(`
    SELECT id
    FROM boat_slots
    WHERE boat_id = ? AND time = ?
  `).get(gs.boat_id, String(gs.time));

  return created?.id ?? null;
}


// Helper: change seats_left for slot_uid (delta can be + or -)
function applySeatsDelta(slotUid, delta) {
  const parsed = parseSlotUid(slotUid);
  if (!parsed) throw new Error('Invalid slot_uid');

  const d = Number(delta || 0);
  if (!Number.isFinite(d) || d === 0) return;

  if (parsed.source === 'generated') {
    db.prepare(`
      UPDATE generated_slots
      SET seats_left = MAX(0, MIN(capacity, seats_left + ?))
      WHERE id = ?
    `).run(d, parsed.id);
  } else {
    db.prepare(`
      UPDATE boat_slots
      SET seats_left = MAX(0, MIN(capacity, seats_left + ?))
      WHERE id = ?
    `).run(d, parsed.id);
  }
}

// Transfer whole presale to another slot_uid (new РїРµСЂРµРЅРѕСЃ, no cancelled tabs)
function doTransferPresaleToSlot(presaleId, toSlotUid) {
  const toParsed = parseSlotUid(toSlotUid);
  if (!toParsed) throw new Error('Invalid to_slot_uid');

  const presale = db.prepare(`
    SELECT id, boat_slot_id, slot_uid, number_of_seats, status, tickets_json, total_price, prepayment_amount
    FROM presales
    WHERE id = ?
  `).get(presaleId);

  if (!presale) return { error: 'Presale not found', code: 404 };

  if (String(presale.status) !== 'ACTIVE') return { error: 'Presale not ACTIVE', code: 400 };

  const fromSlotUid = String(presale.slot_uid || (presale.boat_slot_id ? `manual:${presale.boat_slot_id}` : ''));
  const fromParsed = parseSlotUid(fromSlotUid);
  if (!fromParsed) throw new Error('Invalid source slot for presale');

  if (String(fromSlotUid) === String(toSlotUid)) return { error: 'Cannot transfer to same СЂРµР№СЃ', code: 400 };

  // Get old trip day before transfer
  let oldTripDay = null;
  try {
    if (fromSlotUid && typeof fromSlotUid === 'string' && fromSlotUid.startsWith('generated:')) {
      const genId = Number(String(fromSlotUid).slice('generated:'.length));
      if (Number.isFinite(genId)) {
        const row = db.prepare('SELECT trip_date FROM generated_slots WHERE id = ?').get(genId);
        if (row?.trip_date) oldTripDay = row.trip_date;
      }
    }
  } catch (_) {}
  if (!oldTripDay && presale?.boat_slot_id) {
    try {
      const row = db.prepare('SELECT trip_date FROM boat_slots WHERE id = ?').get(presale.boat_slot_id);
      if (row?.trip_date) oldTripDay = row.trip_date;
    } catch (_) {}
  }

  // Count active tickets inside presale
  const activeCountRow = db.prepare(`
    SELECT COUNT(*) as cnt
    FROM tickets
    WHERE presale_id = ? AND status = 'ACTIVE'
  `).get(presaleId);
  const movedSeats = Number(activeCountRow?.cnt ?? 0);

  if (movedSeats <= 0) return { error: 'No active tickets to transfer', code: 400 };

  // Check target availability
  let targetSeatsLeft = 0;
  if (toParsed.source === 'generated') {
    const r = db.prepare(`SELECT seats_left FROM generated_slots WHERE id = ?`).get(toParsed.id);
    targetSeatsLeft = Number(r?.seats_left ?? 0);
  } else {
    const r = db.prepare(`SELECT seats_left FROM boat_slots WHERE id = ?`).get(toParsed.id);
    targetSeatsLeft = Number(r?.seats_left ?? 0);
  }
  if (targetSeatsLeft < movedSeats) return { error: 'Not enough seats in target СЂРµР№СЃ', code: 400 };

  const targetBaseBoatSlotId = getBaseBoatSlotIdForSlot(toSlotUid);
  if (!targetBaseBoatSlotId) return { error: 'Target СЂРµР№СЃ base slot not found', code: 400 };

  // Update presale + all tickets to target
  db.prepare(`
    UPDATE presales
    SET boat_slot_id = ?, slot_uid = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(targetBaseBoatSlotId, String(toSlotUid), presaleId);

  db.prepare(`
    UPDATE tickets
    SET boat_slot_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE presale_id = ?
  `).run(targetBaseBoatSlotId, presaleId);


  // === FIX: recalc prices when transferring a whole presale between СЂРµР№СЃС‹ ===
  // If you move 2h(3000) -> 1h(2000), totals and per-ticket prices must change.
  try {
    const getSlotPrices = (slotUid) => {
      const p = parseSlotUid(slotUid);
      if (!p) return { adult: 0, teen: 0, child: 0 };
      if (p.source === 'generated') {
        const r = db.prepare(`SELECT price_adult, price_teen, price_child FROM generated_slots WHERE id = ?`).get(p.id);
        return { adult: Number(r?.price_adult ?? 0), teen: Number(r?.price_teen ?? 0), child: Number(r?.price_child ?? 0) };
      }
      const r = db.prepare(`SELECT price_adult, price_teen, price_child FROM boat_slots WHERE id = ?`).get(p.id);
      return { adult: Number(r?.price_adult ?? 0), teen: Number(r?.price_teen ?? 0), child: Number(r?.price_child ?? 0) };
    };

    const fromPrices = getSlotPrices(fromSlotUid);
    const toPrices   = getSlotPrices(toSlotUid);

    // Count ACTIVE tickets by type from database (not stale tickets_json)
    const activeTicketsForCount = db.prepare(`
      SELECT id, price
      FROM tickets
      WHERE presale_id = ? AND status = 'ACTIVE'
    `).all(presaleId);

    let cAdult = 0, cTeen = 0, cChild = 0;
    for (const t of activeTicketsForCount) {
      const p = Number(t.price ?? 0);
      if (fromPrices.child > 0 && p === fromPrices.child) cChild++;
      else if (fromPrices.teen > 0 && p === fromPrices.teen) cTeen++;
      else cAdult++;
    }

    console.log('[PRESALE_TRANSFER] active ticket counts:', { cAdult, cTeen, cChild, movedSeats });

    const computedTotal =
      (cAdult * (toPrices.adult || fromPrices.adult || 0)) +
      (cTeen  * (toPrices.teen  || fromPrices.teen  || 0)) +
      (cChild * (toPrices.child || fromPrices.child || 0));

    if (computedTotal > 0) {
      const oldPrepay = Number(presale.prepayment_amount ?? 0);
      const newPrepay = Math.min(oldPrepay, computedTotal);

      // Update tickets_json with ACTIVE counts
      const newTicketsJson = JSON.stringify({ adult: cAdult, teen: cTeen, child: cChild });

      db.prepare(`
        UPDATE presales
        SET total_price = ?,
            prepayment_amount = ?,
            number_of_seats = ?,
            tickets_json = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(computedTotal, newPrepay, movedSeats, newTicketsJson, presaleId);

      console.log('[PRESALE_TRANSFER] updated presale:', { presaleId, computedTotal, movedSeats, newTicketsJson });

      // Update each ticket.price by matching its old price to old slot prices (fallback adult)
      const tickets = db.prepare(`
        SELECT id, price
        FROM tickets
        WHERE presale_id = ? AND status = 'ACTIVE'
      `).all(presaleId);

      const updTicket = db.prepare(`UPDATE tickets SET price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
      const findCanon = db.prepare(`
        SELECT rowid AS rid, cash_amount, card_amount
        FROM sales_transactions_canonical
        WHERE ticket_id = ? AND status = 'VALID'
        ORDER BY created_at DESC
        LIMIT 1
      `);
      const updCanon = db.prepare(`
        UPDATE sales_transactions_canonical
        SET amount = ?, cash_amount = ?, card_amount = ?
        WHERE rowid = ?
      `);

      for (const t of tickets) {
        const cur = Number(t.price ?? 0);
        let type = 'adult';
        if (fromPrices.child > 0 && cur == fromPrices.child) type = 'child';
        else if (fromPrices.teen > 0 && cur == fromPrices.teen) type = 'teen';

        let newPrice = (type === 'child') ? (toPrices.child || cur) : (type === 'teen') ? (toPrices.teen || cur) : (toPrices.adult || cur);
        if (!newPrice || newPrice <= 0) newPrice = cur;

        updTicket.run(newPrice, t.id);

        try {
          const canon = findCanon.get(t.id);
          if (canon && canon.rid) {
            const cash = Number(canon.cash_amount ?? 0);
            const card = Number(canon.card_amount ?? 0);
            const paid = cash + card;
            let newCash = cash, newCard = card;

            if (paid > newPrice) {
              if (cash > 0 && card > 0) {
                newCash = Math.round(newPrice * (cash / paid));
                newCard = Math.max(0, Math.round(newPrice - newCash));
              } else if (cash > 0) {
                newCash = Math.round(newPrice);
                newCard = 0;
              } else {
                newCash = 0;
                newCard = Math.round(newPrice);
              }
            }
            updCanon.run(newPrice, newCash, newCard, canon.rid);
          }
        } catch (e) {
          console.log('[PRESALE_TRANSFER_SYNC_CANON] skipped', e?.message || e);
        }
      }
    }
  } catch (e) {
    console.log('[PRESALE_TRANSFER_REPRICE] skipped', e?.message || e);
  }

  // === Helper functions for trip day and slot resolution (shared by SYNC and PENDING blocks) ===
  const getGeneratedSlotIdFromUid = (slotUid) => {
    if (!slotUid || typeof slotUid !== 'string') return null;
    if (slotUid.startsWith('generated:')) {
      const genId = Number(slotUid.slice('generated:'.length));
      return Number.isFinite(genId) ? genId : null;
    }
    return null;
  };

  const resolveTripDayForSlot = (slotUid) => {
    if (!slotUid) return null;
    if (typeof slotUid === 'string' && slotUid.startsWith('generated:')) {
      const genId = Number(slotUid.slice('generated:'.length));
      if (Number.isFinite(genId)) {
        const row = db.prepare('SELECT trip_date FROM generated_slots WHERE id = ?').get(genId);
        if (row?.trip_date) return row.trip_date;
      }
    }
    const baseSlotId = getBaseBoatSlotIdForSlot(slotUid);
    if (baseSlotId) {
      const row = db.prepare('SELECT trip_date FROM boat_slots WHERE id = ?').get(baseSlotId);
      if (row?.trip_date) return row.trip_date;
    }
    return db.prepare("SELECT DATE('now','localtime') AS d").get()?.d || null;
  };

  // === SYNC VALID CANONICAL to target slot ===
  // Update slot_uid, slot_id, business_day for all VALID rows of this presale
  try {
    const targetSlotId = getGeneratedSlotIdFromUid(toSlotUid) || getBaseBoatSlotIdForSlot(toSlotUid) || null;
    const targetBusinessDay = resolveTripDayForSlot(toSlotUid);

    db.prepare(`
      UPDATE sales_transactions_canonical
      SET slot_uid = ?, slot_id = ?, business_day = ?
      WHERE presale_id = ? AND status = 'VALID'
    `).run(toSlotUid, targetSlotId, targetBusinessDay, presaleId);

    console.log('[PRESALE_TRANSFER_VALID_CANON] synced:', { presaleId, toSlotUid, targetSlotId, targetBusinessDay });
  } catch (e) {
    console.log('[PRESALE_TRANSFER_VALID_CANON] skipped', e?.message || e);
  }

  // Seats: free in old, take in new
  applySeatsDelta(fromSlotUid, +movedSeats);
  applySeatsDelta(toSlotUid, -movedSeats);

  // Reuse helper functions defined above
  const targetBusinessDay = resolveTripDayForSlot(toSlotUid);
  const targetSlotId = getGeneratedSlotIdFromUid(toSlotUid) || getBaseBoatSlotIdForSlot(toSlotUid) || null;

  // === PENDING CANONICAL: keep "РѕР¶РёРґР°РµС‚ РѕРїР»Р°С‚С‹" tied to trip_date after transfer ===
  // Owner pending-by-trip-date relies on canonical rows with status='PENDING'.
  // When a presale moves to another slot, its unpaid remainder must follow the new slot.
  try {
    const cur = db.prepare(`
      SELECT id, boat_slot_id, slot_uid, number_of_seats, total_price, prepayment_amount
      FROM presales
      WHERE id = ?
    `).get(presaleId);

    const total = Number(cur?.total_price ?? 0);
    const prepay = Number(cur?.prepayment_amount ?? 0);
    const remainder = Math.max(0, total - prepay);

    // Remove old PENDING (it belonged to the previous slot/date)
    db.prepare("DELETE FROM sales_transactions_canonical WHERE presale_id = ? AND status = 'PENDING'")
      .run(presaleId);

    if (remainder > 0) {
      db.prepare(`
        INSERT INTO sales_transactions_canonical
        (
          business_day,
          status,
          amount,
          qty,
          ticket_id,
          presale_id,
          slot_uid,
          slot_id,
          created_at
        )
        VALUES (?, 'PENDING', ?, ?, NULL, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        targetBusinessDay,
        remainder,
        Number(cur?.number_of_seats ?? movedSeats) || 1,
        presaleId,
        toSlotUid,
        targetSlotId
      );
    }
  } catch (e) {
    console.log('[PRESALE_TRANSFER_PENDING_CANON] skipped', e?.message || e);
  }

  // === UPDATE PRESALES to target slot (Owner pending-by-day reads presales.business_day) ===
  try {
    const presaleBoatSlotId = getBaseBoatSlotIdForSlot(toSlotUid) || null;
    console.log('[PRESALE_TRANSFER_PRESALE] before update:', { presaleId, toSlotUid, presaleBoatSlotId, targetBusinessDay });
    const updRes = db.prepare(`
      UPDATE presales
      SET business_day = ?, slot_uid = ?, boat_slot_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(targetBusinessDay, toSlotUid, presaleBoatSlotId, presaleId);
    console.log('[PRESALE_TRANSFER_PRESALE] after update:', { changes: updRes.changes, lastInsertRowid: updRes.lastInsertRowid });
  } catch (e) {
    console.log('[PRESALE_TRANSFER_PRESALE] skipped', e?.message || e);
  }

  // === Recalc EXPECT_PAYMENT in money_ledger for owner pending-by-day ===
  let newTripDay = null;
  try {
    const cur = db.prepare(`
      SELECT id, boat_slot_id, slot_uid, total_price, prepayment_amount
      FROM presales
      WHERE id = ?
    `).get(presaleId);
    
    if (cur) {
      recalcPendingForTransfer(
        presaleId,
        String(cur?.slot_uid ?? toSlotUid),
        Number(cur?.boat_slot_id ?? 0) || getBaseBoatSlotIdForSlot(toSlotUid) || null,
        cur?.total_price ?? 0,
        cur?.prepayment_amount ?? 0
      );
      
      // Get new trip day after transfer
      if (cur?.slot_uid && typeof cur.slot_uid === 'string' && cur.slot_uid.startsWith('generated:')) {
        const genId = Number(String(cur.slot_uid).slice('generated:'.length));
        if (Number.isFinite(genId)) {
          const row = db.prepare('SELECT trip_date FROM generated_slots WHERE id = ?').get(genId);
          if (row?.trip_date) newTripDay = row.trip_date;
        }
      }
      if (!newTripDay && cur?.boat_slot_id) {
        const row = db.prepare('SELECT trip_date FROM boat_slots WHERE id = ?').get(cur.boat_slot_id);
        if (row?.trip_date) newTripDay = row.trip_date;
      }
    }
  } catch (e) {
    console.log('[PRESALE_TRANSFER_PENDING_LEDGER] skipped', e?.message || e);
  }

  return { ok: true, movedSeats, affected_days: { old_day: oldTripDay, new_day: newTripDay } };
}

router.post('/presales/:id/transfer', authenticateToken, canSellOrDispatch, (req, res) => {
  try {
    const presaleId = Number(req.params.id);
    const toSlotUid = req.body?.to_slot_uid;

    if (!toSlotUid) return res.status(400).json({ error: 'to_slot_uid required' });

    const presale = db.prepare(`
      SELECT id, business_day, slot_uid, boat_slot_id
      FROM presales
      WHERE id = ?
    `).get(presaleId);
    if (!presale) return res.status(404).json({ error: 'Presale not found' });
    const sourceBusinessDay = resolveBusinessDayForPresaleRow(presale);
    const targetBusinessDay = resolveBusinessDayFromSlot(toSlotUid);
    assertShiftOpenForPresaleDays(presaleId, sourceBusinessDay, targetBusinessDay ? [targetBusinessDay] : []);

    const tx = db.transaction(() => {
      const result = doTransferPresaleToSlot(presaleId, toSlotUid);
      if (result?.error) throw Object.assign(new Error(result.error), { code: result.code || 400 });
      return result;
    });

    const result = tx();
    res.json({ success: true, ...result });
  } catch (error) {
    const shiftClosedResponse = respondShiftClosedIfNeeded(res, error);
    if (shiftClosedResponse) return shiftClosedResponse;
    const code = error?.code && Number.isFinite(Number(error.code)) ? Number(error.code) : 500;
    res.status(code === 500 ? 500 : code).json({ error: error.message || 'Failed to transfer presale' });
  }
});

// Backward compatible: PATCH /presales/:id/transfer (now С‚СЂРµР±СѓРµС‚ body.to_slot_uid)
router.patch('/presales/:id/transfer', authenticateToken, canSellOrDispatch, (req, res) => {
  try {
    const presaleId = Number(req.params.id);
    const toSlotUid = req.body?.to_slot_uid;

    if (!toSlotUid) return res.status(400).json({ error: 'to_slot_uid required' });

    // Check ownership before transfer
    const presale = db.prepare('SELECT id, seller_id, business_day, slot_uid, boat_slot_id FROM presales WHERE id = ?').get(presaleId);
    if (!presale) return res.status(404).json({ error: 'Presale not found' });
    if (presale.seller_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const sourceBusinessDay = resolveBusinessDayForPresaleRow(presale);
    const targetBusinessDay = resolveBusinessDayFromSlot(toSlotUid);
    assertShiftOpenForPresaleDays(presaleId, sourceBusinessDay, targetBusinessDay ? [targetBusinessDay] : []);

    const tx = db.transaction(() => {
      const result = doTransferPresaleToSlot(presaleId, toSlotUid);
      if (result?.error) throw Object.assign(new Error(result.error), { code: result.code || 400 });
      return result;
    });

    const result = tx();
    res.json({ success: true, ...result });
  } catch (error) {
    const shiftClosedResponse = respondShiftClosedIfNeeded(res, error);
    if (shiftClosedResponse) return shiftClosedResponse;
    const code = error?.code && Number.isFinite(Number(error.code)) ? Number(error.code) : 500;
    res.status(code === 500 ? 500 : code).json({ error: error.message || 'Failed to transfer presale' });
  }
});


router.patch('/presales/:id/cancel-trip-pending', authenticateToken, canSellOrDispatch, (req, res) => {
  try {
    const presaleId = Number(req.params.id);
    if (!Number.isFinite(presaleId) || presaleId <= 0) {
      return res.status(400).json({ error: 'Invalid presale ID' });
    }
    const presaleGuardRow = db.prepare(
      'SELECT id, boat_slot_id, slot_uid, business_day FROM presales WHERE id = ?'
    ).get(presaleId);
    if (!presaleGuardRow) {
      return res.status(404).json({ error: 'Presale not found' });
    }
    const presaleBusinessDay = resolveBusinessDayForPresaleRow(presaleGuardRow);
    assertShiftOpenForPresaleDays(presaleId, presaleBusinessDay);

    const cancelTransaction = db.transaction(() => {
      const presale = db.prepare(
        'SELECT id, boat_slot_id, slot_uid, number_of_seats, total_price, prepayment_amount, status FROM presales WHERE id = ?'
      ).get(presaleId);
      if (!presale) {
        res.status(404).json({ error: 'Presale not found' });
        return null;
      }

      if (presale.status === 'CANCELLED_TRIP_PENDING') {
        return presale;
      }

      db.prepare("UPDATE presales SET status = 'CANCELLED_TRIP_PENDING' WHERE id = ?").run(presaleId);

      // Free seats back to the slot so they can be resold (if the trip time still allows)
      restoreSeatsForPresale(presale);

      return { ...presale, status: 'CANCELLED_TRIP_PENDING' };
    });

    const result = cancelTransaction();
    if (!result) return;

    // IMPORTANT:
    // Owner analytics "РћР¶РёРґР°РµС‚ РѕРїР»Р°С‚С‹ (РїРѕ РґР°С‚Рµ СЂРµР№СЃР°)" is based on money_ledger rows (not sales_transactions_canonical).
    // When a presale is moved into "CANCELLED_TRIP_PENDING" (transfer without payment), we must record an expected payment.
    // Do this OUTSIDE of the transaction so seat-restore edge cases do not rollback the money_ledger write.
    try {
      const getTripDay = (slotUid, slotId) => {
        try {
          if (slotUid && typeof slotUid === 'string' && slotUid.startsWith('generated:')) {
            const genId = Number(String(slotUid).slice('generated:'.length));
            if (Number.isFinite(genId)) {
              const row = db.prepare('SELECT trip_date FROM generated_slots WHERE id = ?').get(genId);
              if (row?.trip_date) return row.trip_date;
            }
          }
        } catch (_) {
          // ignore
        }
        try {
          if (slotId != null) {
            const row = db.prepare('SELECT trip_date FROM boat_slots WHERE id = ?').get(slotId);
            if (row?.trip_date) return row.trip_date;
          }
        } catch (_) {
          // ignore
        }
        return null;
      };

      const tripDay = getTripDay(result.slot_uid, result.boat_slot_id);
      const expectedAmount = Math.max(
        0,
        Number(result.total_price || 0) - Number(result.prepayment_amount || 0)
      );

      const existsLedger = db.prepare(
        "SELECT 1 FROM money_ledger WHERE presale_id = ? AND kind = 'EXPECT_PAYMENT' AND status = 'POSTED' LIMIT 1"
      ).get(result.id);

      if (!existsLedger && expectedAmount > 0) {
        db.prepare(`
          INSERT INTO money_ledger
          (
            presale_id,
            slot_id,
            trip_day,
            kind,
            method,
            amount,
            status,
            type
          )
          VALUES
          (
            ?,
            ?,
            ?,
            'EXPECT_PAYMENT',
            NULL,
            ?,
            'POSTED',
            'PENDING'
          )
        `).run(
          result.id,
          result.boat_slot_id ?? null,
          tripDay,
          expectedAmount
        );
      }
    } catch (e) {
      console.error('[cancel-trip-pending] Failed to write money_ledger EXPECT_PAYMENT row:', e);
      // Do not fail the API call: presale status update already succeeded.
    }

    res.json({ success: true, message: 'Presale marked as cancelled trip pending' });
  } catch (error) {
    const shiftClosedResponse = respondShiftClosedIfNeeded(res, error);
    if (shiftClosedResponse) return shiftClosedResponse;
    console.error('Error marking presale as cancelled trip pending:', error);
    res.status(500).json({ error: 'Failed to mark presale as cancelled trip pending' });
  }
});


export default router;
