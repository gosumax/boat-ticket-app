import {
  buildTelegramLatestTimestampSummary,
  freezeTelegramHandoffValue,
} from '../../../shared/telegram/index.js';

export const TELEGRAM_MINI_APP_REQUESTED_TRIP_SLOT_REFERENCE_TYPE =
  'telegram_requested_trip_slot_reference';
export const TELEGRAM_MINI_APP_TRIP_AVAILABILITY_STATES = Object.freeze([
  'bookable',
  'low_availability',
  'unavailable',
]);
export const TELEGRAM_MINI_APP_LOW_AVAILABILITY_SEAT_THRESHOLD = 3;

const SLOT_UID_PATTERN = /^(manual|generated):\d+$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sortMiniAppValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortMiniAppValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortMiniAppValue(value[key])])
  );
}

export function freezeMiniAppValue(value) {
  return freezeTelegramHandoffValue(sortMiniAppValue(value));
}

export function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizePositiveInteger(value, label, reject) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    reject(`${label} must be a positive integer`);
  }

  return normalized;
}

function normalizeDateOnly(value, label, reject) {
  const normalized = normalizeString(value);
  if (!normalized || !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    reject(`${label} must be YYYY-MM-DD`);
  }

  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    reject(`${label} must be a valid calendar date`);
  }

  return normalized;
}

function assertTimeSlotPart(value, label, reject) {
  const [hourPart, minutePart] = value.split(':');
  const hour = Number(hourPart);
  const minute = Number(minutePart);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    reject(`${label} must be a valid HH:mm time`);
  }
}

function normalizeTimeSlot(value, label, reject) {
  const normalized = normalizeString(value);
  if (!normalized || !/^\d{2}:\d{2}$/.test(normalized)) {
    reject(`${label} must be HH:mm`);
  }
  assertTimeSlotPart(normalized, label, reject);
  return normalized;
}

export function normalizeMiniAppTripTypeFilter(value, reject) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const normalized = normalizeString(value)?.toLowerCase();
  if (!normalized || !/^[a-z0-9_-]+$/.test(normalized)) {
    reject('trip_type filter must be a normalized identifier');
  }

  return normalized;
}

export function normalizeMiniAppDateFilter(value, reject, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) {
      reject('date filter is required');
    }
    return null;
  }

  return normalizeDateOnly(value, 'date', reject);
}

export function normalizeMiniAppOnlyBookableFilter(value, reject) {
  if (value === undefined || value === null || value === '') {
    return true;
  }
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = normalizeString(value)?.toLowerCase();
  if (normalized === '1' || normalized === 'true') {
    return true;
  }
  if (normalized === '0' || normalized === 'false') {
    return false;
  }

  reject('only_active_bookable must be boolean');
  return true;
}

function parseSlotUid(slotUid, reject) {
  const normalized = normalizeString(slotUid);
  if (!normalized || !SLOT_UID_PATTERN.test(normalized)) {
    reject('slot_uid must match manual:<id> or generated:<id>');
  }

  const [sourceType, idPart] = normalized.split(':');
  return freezeMiniAppValue({
    slot_uid: normalized,
    slot_source: sourceType,
    slot_id: normalizePositiveInteger(idPart, 'slot_uid id', reject),
  });
}

function pickTripSlotReference(input = {}) {
  return (
    input.requested_trip_slot_reference ??
    input.requestedTripSlotReference ??
    input.trip_slot_reference ??
    input.tripSlotReference ??
    input.trip_reference ??
    input.tripReference ??
    null
  );
}

export function normalizeMiniAppTripSlotReference(input = {}, reject, options = {}) {
  const referenceInput = pickTripSlotReference(input) || input;
  if (!isPlainObject(referenceInput)) {
    reject('trip/slot reference is required');
  }

  const referenceType = normalizeString(referenceInput.reference_type);
  if (
    referenceType &&
    referenceType !== TELEGRAM_MINI_APP_REQUESTED_TRIP_SLOT_REFERENCE_TYPE
  ) {
    reject(`Unsupported trip/slot reference type: ${referenceType}`);
  }

  const slotUid = normalizeString(referenceInput.slot_uid ?? referenceInput.slotUid);
  const boatSlotIdRaw =
    referenceInput.boat_slot_id ?? referenceInput.boatSlotId ?? null;
  const boatSlotId =
    boatSlotIdRaw === null || boatSlotIdRaw === undefined || boatSlotIdRaw === ''
      ? null
      : normalizePositiveInteger(boatSlotIdRaw, 'boat_slot_id', reject);

  let normalizedSlotUid = slotUid;
  let slotSource = null;
  let slotId = null;
  if (slotUid) {
    const parsed = parseSlotUid(slotUid, reject);
    normalizedSlotUid = parsed.slot_uid;
    slotSource = parsed.slot_source;
    slotId = parsed.slot_id;
  } else if (boatSlotId) {
    normalizedSlotUid = `manual:${boatSlotId}`;
    slotSource = 'manual';
    slotId = boatSlotId;
  } else {
    reject('trip/slot reference must include slot_uid or boat_slot_id');
  }

  if (slotSource === 'manual' && boatSlotId !== null && slotId !== boatSlotId) {
    reject('manual slot_uid does not match boat_slot_id');
  }

  const requestedTripDateRaw =
    referenceInput.requested_trip_date ??
    referenceInput.requestedTripDate ??
    referenceInput.trip_date ??
    referenceInput.tripDate ??
    null;
  const requestedTimeSlotRaw =
    referenceInput.requested_time_slot ??
    referenceInput.requestedTimeSlot ??
    referenceInput.time_slot ??
    referenceInput.timeSlot ??
    null;
  const requireDateTime = options.requireDateTime === true;
  const hasDate = requestedTripDateRaw !== null && requestedTripDateRaw !== undefined && requestedTripDateRaw !== '';
  const hasTime = requestedTimeSlotRaw !== null && requestedTimeSlotRaw !== undefined && requestedTimeSlotRaw !== '';
  if (requireDateTime && (!hasDate || !hasTime)) {
    reject('trip/slot reference must include requested_trip_date and requested_time_slot');
  }
  if ((hasDate && !hasTime) || (!hasDate && hasTime)) {
    reject('requested_trip_date and requested_time_slot must be provided together');
  }

  const requestedTripDate = hasDate
    ? normalizeDateOnly(requestedTripDateRaw, 'requested_trip_date', reject)
    : null;
  const requestedTimeSlot = hasTime
    ? normalizeTimeSlot(requestedTimeSlotRaw, 'requested_time_slot', reject)
    : null;

  return freezeMiniAppValue({
    reference_type: TELEGRAM_MINI_APP_REQUESTED_TRIP_SLOT_REFERENCE_TYPE,
    requested_trip_date: requestedTripDate,
    requested_time_slot: requestedTimeSlot,
    slot_uid: normalizedSlotUid,
    boat_slot_id: slotSource === 'manual' ? slotId : boatSlotId,
  });
}

function listTableColumns(db, tableName) {
  try {
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName);
    if (!table) {
      return new Set();
    }
    return new Set(
      db
        .prepare(`PRAGMA table_info(${tableName})`)
        .all()
        .map((column) => column.name)
    );
  } catch {
    return new Set();
  }
}

function hasAllColumns(columns, requiredColumns = []) {
  return requiredColumns.every((column) => columns.has(column));
}

function buildGeneratedRowsQueryContext(db) {
  const generatedColumns = listTableColumns(db, 'generated_slots');
  if (
    generatedColumns.size === 0 ||
    !hasAllColumns(generatedColumns, [
      'id',
      'boat_id',
      'trip_date',
      'time',
      'capacity',
      'seats_left',
      'is_active',
    ])
  ) {
    return null;
  }

  const boatsColumns = listTableColumns(db, 'boats');
  if (
    boatsColumns.size === 0 ||
    !hasAllColumns(boatsColumns, ['id', 'name', 'is_active'])
  ) {
    return null;
  }

  const scheduleTemplateColumns = listTableColumns(db, 'schedule_templates');
  const canJoinScheduleTemplates =
    scheduleTemplateColumns.size > 0 &&
    hasAllColumns(scheduleTemplateColumns, ['id']);
  const scheduleTemplateJoin = canJoinScheduleTemplates
    ? 'LEFT JOIN schedule_templates st ON st.id = gs.schedule_template_id'
    : '';
  const productTypeExpression = canJoinScheduleTemplates
    ? "LOWER(TRIM(COALESCE(st.product_type, b.type, '')))"
    : "LOWER(TRIM(COALESCE(b.type, '')))";
  const boatTypeExpression = canJoinScheduleTemplates
    ? 'COALESCE(st.product_type, b.type)'
    : 'b.type';

  const templateItemsColumns = listTableColumns(db, 'schedule_template_items');
  const canJoinTemplateItems =
    canJoinScheduleTemplates &&
    templateItemsColumns.size > 0 &&
    hasAllColumns(templateItemsColumns, ['schedule_template_id', 'name']);
  const templateItemsJoin = canJoinTemplateItems
    ? `
      LEFT JOIN (
        SELECT
          schedule_template_id,
          MIN(name) AS template_item_name
        FROM schedule_template_items
        WHERE COALESCE(is_active, 1) = 1
        GROUP BY schedule_template_id
      ) sti ON sti.schedule_template_id = gs.schedule_template_id
    `
    : '';
  const templateItemNameSelect = canJoinTemplateItems
    ? 'sti.template_item_name'
    : 'NULL';

  const updatedAtExpression = generatedColumns.has('updated_at')
    ? 'gs.updated_at'
    : 'NULL';
  const createdAtExpression = generatedColumns.has('created_at')
    ? 'gs.created_at'
    : 'NULL';
  const durationExpression = generatedColumns.has('duration_minutes')
    ? 'gs.duration_minutes'
    : 'NULL';
  const priceAdultExpression = generatedColumns.has('price_adult')
    ? 'gs.price_adult'
    : 'NULL';
  const priceChildExpression = generatedColumns.has('price_child')
    ? 'gs.price_child'
    : 'NULL';
  const priceTeenExpression = generatedColumns.has('price_teen')
    ? 'gs.price_teen'
    : 'NULL';

  return freezeMiniAppValue({
    productTypeExpression,
    boatTypeExpression,
    scheduleTemplateJoin,
    templateItemsJoin,
    templateItemNameSelect,
    updatedAtExpression,
    createdAtExpression,
    durationExpression,
    priceAdultExpression,
    priceChildExpression,
    priceTeenExpression,
  });
}

function buildManualRowsQueryContext(db) {
  const manualColumns = listTableColumns(db, 'boat_slots');
  if (
    manualColumns.size === 0 ||
    !hasAllColumns(manualColumns, [
      'id',
      'boat_id',
      'trip_date',
      'time',
      'capacity',
      'seats_left',
      'is_active',
    ])
  ) {
    return null;
  }
  const boatsColumns = listTableColumns(db, 'boats');
  if (
    boatsColumns.size === 0 ||
    !hasAllColumns(boatsColumns, ['id', 'name', 'is_active'])
  ) {
    return null;
  }

  const updatedAtExpression = manualColumns.has('updated_at')
    ? 'bs.updated_at'
    : 'NULL';
  const createdAtExpression = manualColumns.has('created_at')
    ? 'bs.created_at'
    : 'NULL';
  const durationExpression = manualColumns.has('duration_minutes')
    ? 'bs.duration_minutes'
    : 'NULL';
  const priceAdultExpression = manualColumns.has('price_adult')
    ? 'bs.price_adult'
    : 'NULL';
  const priceChildExpression = manualColumns.has('price_child')
    ? 'bs.price_child'
    : 'NULL';
  const priceTeenExpression = manualColumns.has('price_teen')
    ? 'bs.price_teen'
    : 'NULL';
  const legacyPriceExpression = manualColumns.has('price') ? 'bs.price' : 'NULL';

  return freezeMiniAppValue({
    updatedAtExpression,
    createdAtExpression,
    durationExpression,
    priceAdultExpression,
    priceChildExpression,
    priceTeenExpression,
    legacyPriceExpression,
  });
}

function buildGeneratedRowsQuery(filters, context) {
  const whereParts = ['1 = 1'];
  const params = [];

  if (filters.requested_trip_date) {
    whereParts.push('gs.trip_date = ?');
    params.push(filters.requested_trip_date);
  }
  if (filters.trip_type_filter) {
    whereParts.push(`${context.productTypeExpression} = ?`);
    params.push(filters.trip_type_filter);
  }

  return {
    sql: `
      SELECT
        'generated' AS slot_source,
        ('generated:' || gs.id) AS slot_uid,
        NULL AS boat_slot_id,
        gs.id AS slot_id,
        gs.trip_date AS requested_trip_date,
        gs.time AS requested_time_slot,
        COALESCE(gs.is_active, 0) AS slot_is_active,
        COALESCE(b.is_active, 0) AS boat_is_active,
        COALESCE(gs.capacity, 0) AS capacity_total,
        CASE
          WHEN gs.seats_left IS NULL THEN COALESCE(gs.capacity, 0)
          WHEN gs.seats_left < 0 THEN 0
          ELSE gs.seats_left
        END AS seats_left,
        ${context.priceAdultExpression} AS price_adult,
        ${context.priceChildExpression} AS price_child,
        ${context.priceTeenExpression} AS price_teen,
        NULL AS legacy_price,
        ${context.durationExpression} AS duration_minutes,
        b.name AS boat_name,
        ${context.boatTypeExpression} AS trip_type,
        ${context.templateItemNameSelect} AS template_item_name,
        CASE
          WHEN gs.trip_date > DATE('now', 'localtime')
            OR (
              gs.trip_date = DATE('now', 'localtime')
              AND time(gs.time) >= time('now', 'localtime')
            )
            THEN 1
          ELSE 0
        END AS is_upcoming,
        ${context.updatedAtExpression} AS slot_updated_at,
        ${context.createdAtExpression} AS slot_created_at
      FROM generated_slots gs
      INNER JOIN boats b
        ON b.id = gs.boat_id
      ${context.scheduleTemplateJoin}
      ${context.templateItemsJoin}
      WHERE ${whereParts.join(' AND ')}
    `,
    params,
  };
}

function buildManualRowsQuery(filters, context) {
  const whereParts = ['1 = 1', 'bs.trip_date IS NOT NULL', 'bs.time IS NOT NULL'];
  const params = [];

  if (filters.requested_trip_date) {
    whereParts.push('bs.trip_date = ?');
    params.push(filters.requested_trip_date);
  }
  if (filters.trip_type_filter) {
    whereParts.push("LOWER(TRIM(COALESCE(b.type, ''))) = ?");
    params.push(filters.trip_type_filter);
  }

  return {
    sql: `
      SELECT
        'manual' AS slot_source,
        ('manual:' || bs.id) AS slot_uid,
        bs.id AS boat_slot_id,
        bs.id AS slot_id,
        bs.trip_date AS requested_trip_date,
        bs.time AS requested_time_slot,
        COALESCE(bs.is_active, 0) AS slot_is_active,
        COALESCE(b.is_active, 0) AS boat_is_active,
        COALESCE(bs.capacity, 0) AS capacity_total,
        CASE
          WHEN bs.seats_left IS NULL THEN COALESCE(bs.capacity, 0)
          WHEN bs.seats_left < 0 THEN 0
          ELSE bs.seats_left
        END AS seats_left,
        ${context.priceAdultExpression} AS price_adult,
        ${context.priceChildExpression} AS price_child,
        ${context.priceTeenExpression} AS price_teen,
        ${context.legacyPriceExpression} AS legacy_price,
        ${context.durationExpression} AS duration_minutes,
        b.name AS boat_name,
        b.type AS trip_type,
        NULL AS template_item_name,
        CASE
          WHEN bs.trip_date > DATE('now', 'localtime')
            OR (
              bs.trip_date = DATE('now', 'localtime')
              AND time(bs.time) >= time('now', 'localtime')
            )
            THEN 1
          ELSE 0
        END AS is_upcoming,
        ${context.updatedAtExpression} AS slot_updated_at,
        ${context.createdAtExpression} AS slot_created_at
      FROM boat_slots bs
      INNER JOIN boats b
        ON b.id = bs.boat_id
      WHERE ${whereParts.join(' AND ')}
    `,
    params,
  };
}

function normalizePriceValue(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return null;
  }

  return Math.trunc(normalized);
}

function toSafeNonNegativeInteger(value, fallback = 0) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0) {
    return fallback;
  }

  return normalized;
}

function buildTripTypeSummary(row) {
  const tripType = normalizeString(row.trip_type)?.toLowerCase() || null;
  if (!tripType) {
    return freezeMiniAppValue({
      summary_type: 'unavailable',
      trip_type: null,
    });
  }

  return freezeMiniAppValue({
    summary_type: 'available',
    trip_type: tripType,
  });
}

function buildPriceSummary(row) {
  const legacyPrice = normalizePriceValue(row.legacy_price);
  const adultPrice = normalizePriceValue(row.price_adult ?? legacyPrice);
  const childPrice = normalizePriceValue(row.price_child);
  const teenPrice = normalizePriceValue(row.price_teen);
  const hasAtLeastOnePrice =
    adultPrice !== null || childPrice !== null || teenPrice !== null;

  if (!hasAtLeastOnePrice) {
    return freezeMiniAppValue({
      summary_type: 'unavailable',
      currency: 'RUB',
      adult_price: null,
      child_price: null,
      teen_price: null,
      legacy_price: null,
    });
  }

  return freezeMiniAppValue({
    summary_type: 'available',
    currency: 'RUB',
    adult_price: adultPrice,
    child_price: childPrice,
    teen_price: teenPrice,
    legacy_price: legacyPrice,
  });
}

function deriveAvailabilityState(row) {
  const seatsLeft = toSafeNonNegativeInteger(row.seats_left ?? 0, 0);
  const slotActive = Number(row.slot_is_active) === 1;
  const boatActive = Number(row.boat_is_active) === 1;
  const isUpcoming = Number(row.is_upcoming) === 1;

  if (!slotActive || !boatActive || !isUpcoming || seatsLeft <= 0) {
    return 'unavailable';
  }
  if (seatsLeft <= TELEGRAM_MINI_APP_LOW_AVAILABILITY_SEAT_THRESHOLD) {
    return 'low_availability';
  }

  return 'bookable';
}

function buildDateTimeSummary(row) {
  return freezeMiniAppValue({
    requested_trip_date: normalizeString(row.requested_trip_date),
    requested_time_slot: normalizeString(row.requested_time_slot),
    duration_minutes: normalizePriceValue(row.duration_minutes),
    display_text: `${normalizeString(row.requested_trip_date) || ''} ${normalizeString(
      row.requested_time_slot
    ) || ''}`.trim(),
  });
}

function buildTripTitleSummary(row) {
  const boatName = normalizeString(row.boat_name);
  const tripType = normalizeString(row.trip_type);
  const titleBase = row.template_item_name ? normalizeString(row.template_item_name) : null;
  const title = titleBase || boatName || 'Trip';
  const summaryParts = [tripType, normalizeString(row.requested_time_slot)].filter(Boolean);

  return freezeMiniAppValue({
    title,
    summary: summaryParts.join(' • ') || null,
    boat_name: boatName,
  });
}

function buildSeatsSummary(row, availabilityState) {
  const capacityTotal = toSafeNonNegativeInteger(row.capacity_total ?? 0, 0);
  const seatsLeft = toSafeNonNegativeInteger(row.seats_left ?? 0, 0);
  const seatsSold = Math.max(0, capacityTotal - seatsLeft);

  return freezeMiniAppValue({
    capacity_total: capacityTotal,
    seats_left: seatsLeft,
    seats_sold: seatsSold,
    low_availability_threshold: TELEGRAM_MINI_APP_LOW_AVAILABILITY_SEAT_THRESHOLD,
    availability_state: availabilityState,
  });
}

function compareTripRows(left, right) {
  const leftDate = normalizeString(left.requested_trip_date) || '';
  const rightDate = normalizeString(right.requested_trip_date) || '';
  if (leftDate !== rightDate) {
    return leftDate < rightDate ? -1 : 1;
  }

  const leftTime = normalizeString(left.requested_time_slot) || '';
  const rightTime = normalizeString(right.requested_time_slot) || '';
  if (leftTime !== rightTime) {
    return leftTime < rightTime ? -1 : 1;
  }

  const leftUid = normalizeString(left.slot_uid) || '';
  const rightUid = normalizeString(right.slot_uid) || '';
  if (leftUid !== rightUid) {
    return leftUid < rightUid ? -1 : 1;
  }

  return 0;
}

export function projectMiniAppTripItem(row, nowIso) {
  const bookingAvailabilityState = deriveAvailabilityState(row);

  return freezeMiniAppValue({
    trip_slot_reference: {
      reference_type: TELEGRAM_MINI_APP_REQUESTED_TRIP_SLOT_REFERENCE_TYPE,
      requested_trip_date: normalizeString(row.requested_trip_date),
      requested_time_slot: normalizeString(row.requested_time_slot),
      slot_uid: normalizeString(row.slot_uid),
      boat_slot_id:
        row.boat_slot_id === null || row.boat_slot_id === undefined
          ? null
          : Number(row.boat_slot_id),
    },
    trip_title_summary: buildTripTitleSummary(row),
    date_time_summary: buildDateTimeSummary(row),
    trip_type_summary: buildTripTypeSummary(row),
    seats_availability_summary: buildSeatsSummary(row, bookingAvailabilityState),
    price_summary: buildPriceSummary(row),
    short_booking_availability_state: bookingAvailabilityState,
    booking_availability_state: bookingAvailabilityState,
    latest_timestamp_summary: buildTelegramLatestTimestampSummary(
      row.slot_updated_at,
      row.slot_created_at,
      nowIso
    ),
  });
}

export function listMiniAppTripRows(db, filters, reject) {
  const generatedContext = buildGeneratedRowsQueryContext(db);
  const manualContext = buildManualRowsQueryContext(db);
  if (!generatedContext && !manualContext) {
    reject('Trip-slot catalog source is unavailable');
  }

  const rows = [];
  if (generatedContext) {
    const generatedQuery = buildGeneratedRowsQuery(filters, generatedContext);
    rows.push(...db.prepare(generatedQuery.sql).all(...generatedQuery.params));
  }
  if (manualContext) {
    const manualQuery = buildManualRowsQuery(filters, manualContext);
    rows.push(...db.prepare(manualQuery.sql).all(...manualQuery.params));
  }

  return rows.sort(compareTripRows);
}

function buildGeneratedTripRowById(db, generatedSlotId) {
  const context = buildGeneratedRowsQueryContext(db);
  if (!context) {
    return null;
  }

  const row = db
    .prepare(
      `
        SELECT
          'generated' AS slot_source,
          ('generated:' || gs.id) AS slot_uid,
          NULL AS boat_slot_id,
          gs.id AS slot_id,
          gs.trip_date AS requested_trip_date,
          gs.time AS requested_time_slot,
          COALESCE(gs.is_active, 0) AS slot_is_active,
          COALESCE(b.is_active, 0) AS boat_is_active,
          COALESCE(gs.capacity, 0) AS capacity_total,
          CASE
            WHEN gs.seats_left IS NULL THEN COALESCE(gs.capacity, 0)
            WHEN gs.seats_left < 0 THEN 0
            ELSE gs.seats_left
          END AS seats_left,
          ${context.priceAdultExpression} AS price_adult,
          ${context.priceChildExpression} AS price_child,
          ${context.priceTeenExpression} AS price_teen,
          NULL AS legacy_price,
          ${context.durationExpression} AS duration_minutes,
          b.name AS boat_name,
          ${context.boatTypeExpression} AS trip_type,
          ${context.templateItemNameSelect} AS template_item_name,
          CASE
            WHEN gs.trip_date > DATE('now', 'localtime')
              OR (
                gs.trip_date = DATE('now', 'localtime')
                AND time(gs.time) >= time('now', 'localtime')
              )
              THEN 1
            ELSE 0
          END AS is_upcoming,
          ${context.updatedAtExpression} AS slot_updated_at,
          ${context.createdAtExpression} AS slot_created_at
        FROM generated_slots gs
        INNER JOIN boats b
          ON b.id = gs.boat_id
        ${context.scheduleTemplateJoin}
        ${context.templateItemsJoin}
        WHERE gs.id = ?
      `
    )
    .get(generatedSlotId);

  return row || null;
}

function buildManualTripRowById(db, boatSlotId) {
  const context = buildManualRowsQueryContext(db);
  if (!context) {
    return null;
  }

  const row = db
    .prepare(
      `
        SELECT
          'manual' AS slot_source,
          ('manual:' || bs.id) AS slot_uid,
          bs.id AS boat_slot_id,
          bs.id AS slot_id,
          bs.trip_date AS requested_trip_date,
          bs.time AS requested_time_slot,
          COALESCE(bs.is_active, 0) AS slot_is_active,
          COALESCE(b.is_active, 0) AS boat_is_active,
          COALESCE(bs.capacity, 0) AS capacity_total,
          CASE
            WHEN bs.seats_left IS NULL THEN COALESCE(bs.capacity, 0)
            WHEN bs.seats_left < 0 THEN 0
            ELSE bs.seats_left
          END AS seats_left,
          ${context.priceAdultExpression} AS price_adult,
          ${context.priceChildExpression} AS price_child,
          ${context.priceTeenExpression} AS price_teen,
          ${context.legacyPriceExpression} AS legacy_price,
          ${context.durationExpression} AS duration_minutes,
          b.name AS boat_name,
          b.type AS trip_type,
          NULL AS template_item_name,
          CASE
            WHEN bs.trip_date > DATE('now', 'localtime')
              OR (
                bs.trip_date = DATE('now', 'localtime')
                AND time(bs.time) >= time('now', 'localtime')
              )
              THEN 1
            ELSE 0
          END AS is_upcoming,
          ${context.updatedAtExpression} AS slot_updated_at,
          ${context.createdAtExpression} AS slot_created_at
        FROM boat_slots bs
        INNER JOIN boats b
          ON b.id = bs.boat_id
        WHERE bs.id = ?
      `
    )
    .get(boatSlotId);

  return row || null;
}

export function readMiniAppTripRowByReference(db, tripSlotReference, reject) {
  const slotUid = normalizeString(tripSlotReference.slot_uid);
  const parsedUid = parseSlotUid(slotUid, reject);
  const row =
    parsedUid.slot_source === 'generated'
      ? buildGeneratedTripRowById(db, parsedUid.slot_id)
      : buildManualTripRowById(db, parsedUid.slot_id);
  if (!row) {
    reject(`Invalid trip/slot reference: ${slotUid}`);
  }

  if (!normalizeString(row.requested_trip_date) || !normalizeString(row.requested_time_slot)) {
    reject(`Trip/slot reference is non-projectable: ${slotUid}`);
  }
  if (
    tripSlotReference.requested_trip_date &&
    tripSlotReference.requested_trip_date !== row.requested_trip_date
  ) {
    reject(`Trip/slot date mismatch for reference: ${slotUid}`);
  }
  if (
    tripSlotReference.requested_time_slot &&
    tripSlotReference.requested_time_slot !== row.requested_time_slot
  ) {
    reject(`Trip/slot time mismatch for reference: ${slotUid}`);
  }

  return row;
}
