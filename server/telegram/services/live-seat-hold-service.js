const SLOT_UID_PATTERN = /^(manual|generated):(\d+)$/;

export const TELEGRAM_LIVE_SEAT_HOLD_SUMMARY_TYPE =
  'telegram_live_slot_seat_hold_summary.v1';

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function toNonNegativeInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  const normalized = Math.trunc(numeric);
  return normalized < 0 ? fallback : normalized;
}

function fail(errorPrefix, code, message, details = null) {
  const error = new Error(`${errorPrefix} ${message}`);
  error.code = code;
  if (details) {
    error.details = details;
  }
  throw error;
}

function parseSlotUidOrThrow(slotUid, errorPrefix) {
  const normalizedSlotUid = normalizeString(slotUid);
  if (!normalizedSlotUid) {
    fail(errorPrefix, 'SLOT_UID_REQUIRED', 'slot_uid is required for live seat hold');
  }

  const match = normalizedSlotUid.match(SLOT_UID_PATTERN);
  if (!match) {
    fail(
      errorPrefix,
      'SLOT_UID_INVALID',
      'slot_uid must match manual:<id> or generated:<id>'
    );
  }

  return {
    slot_uid: normalizedSlotUid,
    slot_source: match[1],
    slot_id: toNonNegativeInteger(match[2], 0),
  };
}

function parseRequestedTimeSlotForMatching(timeSlot) {
  const normalized = normalizeString(timeSlot);
  if (!normalized) {
    return null;
  }

  const [startTime] = normalized.split('-', 1);
  return normalizeString(startTime);
}

function parseRequestedTripSlotReferenceOrThrow(reference, errorPrefix) {
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
    fail(errorPrefix, 'TRIP_SLOT_REFERENCE_REQUIRED', 'requested trip slot reference is required');
  }

  const parsedSlot = parseSlotUidOrThrow(reference.slot_uid, errorPrefix);
  return {
    ...parsedSlot,
    requested_trip_date: normalizeString(reference.requested_trip_date),
    requested_time_slot: normalizeString(reference.requested_time_slot),
    requested_time_slot_for_match: parseRequestedTimeSlotForMatching(
      reference.requested_time_slot
    ),
  };
}

function resolveSlotTableBySource(slotSource) {
  if (slotSource === 'generated') {
    return 'generated_slots';
  }
  if (slotSource === 'manual') {
    return 'boat_slots';
  }

  return null;
}

function normalizeRequestedSeatsOrThrow(requestedSeats, errorPrefix) {
  const normalizedSeats = Number(requestedSeats);
  if (!Number.isInteger(normalizedSeats) || normalizedSeats <= 0) {
    fail(
      errorPrefix,
      'REQUESTED_SEATS_INVALID',
      'requested_seats must be a positive integer for live seat hold'
    );
  }

  return normalizedSeats;
}

function getCurrentSeatsLeft(row = {}) {
  const capacityTotal = toNonNegativeInteger(row.capacity, 0);
  if (row.seats_left === null || row.seats_left === undefined) {
    return capacityTotal;
  }

  return Math.min(capacityTotal, toNonNegativeInteger(row.seats_left, 0));
}

function readSlotRowById(db, tableName, slotId) {
  return db
    .prepare(
      `
        SELECT id, trip_date, time, capacity, seats_left
        FROM ${tableName}
        WHERE id = ?
      `
    )
    .get(slotId);
}

function assertSlotReferenceMatchesRowOrThrow({
  row,
  parsedReference,
  errorPrefix,
}) {
  if (!row) {
    fail(
      errorPrefix,
      'SLOT_NOT_FOUND',
      `Live slot not found for ${parsedReference.slot_uid}`,
      {
        slot_uid: parsedReference.slot_uid,
        slot_id: parsedReference.slot_id,
        slot_source: parsedReference.slot_source,
      }
    );
  }

  if (
    parsedReference.requested_trip_date &&
    normalizeString(row.trip_date) !== parsedReference.requested_trip_date
  ) {
    fail(
      errorPrefix,
      'SLOT_DATE_MISMATCH',
      `Live slot date mismatch for ${parsedReference.slot_uid}`,
      {
        slot_uid: parsedReference.slot_uid,
        requested_trip_date: parsedReference.requested_trip_date,
        live_trip_date: normalizeString(row.trip_date),
      }
    );
  }

  if (
    parsedReference.requested_time_slot_for_match &&
    normalizeString(row.time) !== parsedReference.requested_time_slot_for_match
  ) {
    fail(
      errorPrefix,
      'SLOT_TIME_MISMATCH',
      `Live slot time mismatch for ${parsedReference.slot_uid}`,
      {
        slot_uid: parsedReference.slot_uid,
        requested_time_slot: parsedReference.requested_time_slot_for_match,
        live_time_slot: normalizeString(row.time),
      }
    );
  }
}

function runReserveUpdate({
  db,
  tableName,
  parsedReference,
  requestedSeats,
}) {
  const params = {
    requested_seats: requestedSeats,
    slot_id: parsedReference.slot_id,
    requested_trip_date: parsedReference.requested_trip_date,
    requested_time_slot: parsedReference.requested_time_slot_for_match,
  };
  const whereParts = ['id = @slot_id'];
  if (parsedReference.requested_trip_date) {
    whereParts.push('trip_date = @requested_trip_date');
  }
  if (parsedReference.requested_time_slot_for_match) {
    whereParts.push('time = @requested_time_slot');
  }
  const seatsLeftExpr =
    '(CASE WHEN seats_left IS NULL THEN capacity WHEN seats_left < 0 THEN 0 ELSE seats_left END)';

  return db
    .prepare(
      `
        UPDATE ${tableName}
        SET seats_left = ${seatsLeftExpr} - @requested_seats
        WHERE ${whereParts.join(' AND ')}
          AND ${seatsLeftExpr} >= @requested_seats
      `
    )
    .run(params);
}

function runReleaseUpdate({
  db,
  tableName,
  parsedReference,
  requestedSeats,
}) {
  const params = {
    requested_seats: requestedSeats,
    slot_id: parsedReference.slot_id,
    requested_trip_date: parsedReference.requested_trip_date,
    requested_time_slot: parsedReference.requested_time_slot_for_match,
  };
  const whereParts = ['id = @slot_id'];
  if (parsedReference.requested_trip_date) {
    whereParts.push('trip_date = @requested_trip_date');
  }
  if (parsedReference.requested_time_slot_for_match) {
    whereParts.push('time = @requested_time_slot');
  }
  const seatsLeftExpr =
    '(CASE WHEN seats_left IS NULL THEN capacity WHEN seats_left < 0 THEN 0 ELSE seats_left END)';

  return db
    .prepare(
      `
        UPDATE ${tableName}
        SET seats_left = MIN(capacity, ${seatsLeftExpr} + @requested_seats)
        WHERE ${whereParts.join(' AND ')}
      `
    )
    .run(params);
}

function buildHoldSummary({
  parsedReference,
  tableName,
  requestedSeats,
  rowBefore,
  rowAfter,
  reservedAt = null,
  releasedAt = null,
}) {
  return Object.freeze({
    summary_type: TELEGRAM_LIVE_SEAT_HOLD_SUMMARY_TYPE,
    seat_hold_applied: true,
    slot_uid: parsedReference.slot_uid,
    slot_source: parsedReference.slot_source,
    slot_table: tableName,
    slot_id: parsedReference.slot_id,
    requested_trip_date: parsedReference.requested_trip_date,
    requested_time_slot: parsedReference.requested_time_slot,
    held_seats: requestedSeats,
    released_seats: 0,
    capacity_total: toNonNegativeInteger(rowAfter?.capacity ?? rowBefore?.capacity, 0),
    seats_left_before: getCurrentSeatsLeft(rowBefore),
    seats_left_after: getCurrentSeatsLeft(rowAfter),
    reserved_at: reservedAt,
    released_at: releasedAt,
  });
}

export function reserveLiveSeatHold({
  db,
  requestedTripSlotReference,
  requestedSeats,
  errorPrefix = '[TELEGRAM_LIVE_SEAT_HOLD]',
  reservedAt = null,
}) {
  if (!db?.prepare) {
    fail(errorPrefix, 'PERSISTENCE_CONTEXT_REQUIRED', 'SQLite persistence context is required');
  }

  const parsedReference = parseRequestedTripSlotReferenceOrThrow(
    requestedTripSlotReference,
    errorPrefix
  );
  const normalizedRequestedSeats = normalizeRequestedSeatsOrThrow(
    requestedSeats,
    errorPrefix
  );
  const tableName = resolveSlotTableBySource(parsedReference.slot_source);
  if (!tableName) {
    fail(
      errorPrefix,
      'SLOT_SOURCE_UNSUPPORTED',
      `Unsupported slot source for live seat hold: ${parsedReference.slot_source}`
    );
  }

  const rowBefore = readSlotRowById(db, tableName, parsedReference.slot_id);
  assertSlotReferenceMatchesRowOrThrow({
    row: rowBefore,
    parsedReference,
    errorPrefix,
  });

  const updateResult = runReserveUpdate({
    db,
    tableName,
    parsedReference,
    requestedSeats: normalizedRequestedSeats,
  });
  if (!updateResult || Number(updateResult.changes || 0) !== 1) {
    const currentRow = readSlotRowById(db, tableName, parsedReference.slot_id);
    assertSlotReferenceMatchesRowOrThrow({
      row: currentRow,
      parsedReference,
      errorPrefix,
    });
    const seatsLeft = getCurrentSeatsLeft(currentRow);
    if (normalizedRequestedSeats > seatsLeft) {
      fail(
        errorPrefix,
        'NO_SEATS',
        `Not enough seats available for live hold (${normalizedRequestedSeats} > ${seatsLeft})`,
        {
          slot_uid: parsedReference.slot_uid,
          requested_seats: normalizedRequestedSeats,
          seats_left: seatsLeft,
          capacity_total: toNonNegativeInteger(currentRow?.capacity, 0),
        }
      );
    }

    fail(
      errorPrefix,
      'SEAT_HOLD_UPDATE_CONFLICT',
      `Live seat hold update conflict for ${parsedReference.slot_uid}`
    );
  }

  const rowAfter = readSlotRowById(db, tableName, parsedReference.slot_id);
  assertSlotReferenceMatchesRowOrThrow({
    row: rowAfter,
    parsedReference,
    errorPrefix,
  });

  return buildHoldSummary({
    parsedReference,
    tableName,
    requestedSeats: normalizedRequestedSeats,
    rowBefore,
    rowAfter,
    reservedAt,
  });
}

export function releaseLiveSeatHold({
  db,
  requestedTripSlotReference,
  requestedSeats,
  errorPrefix = '[TELEGRAM_LIVE_SEAT_HOLD]',
  releasedAt = null,
}) {
  if (!db?.prepare) {
    fail(errorPrefix, 'PERSISTENCE_CONTEXT_REQUIRED', 'SQLite persistence context is required');
  }

  const parsedReference = parseRequestedTripSlotReferenceOrThrow(
    requestedTripSlotReference,
    errorPrefix
  );
  const normalizedRequestedSeats = normalizeRequestedSeatsOrThrow(
    requestedSeats,
    errorPrefix
  );
  const tableName = resolveSlotTableBySource(parsedReference.slot_source);
  if (!tableName) {
    fail(
      errorPrefix,
      'SLOT_SOURCE_UNSUPPORTED',
      `Unsupported slot source for live seat release: ${parsedReference.slot_source}`
    );
  }

  const rowBefore = readSlotRowById(db, tableName, parsedReference.slot_id);
  assertSlotReferenceMatchesRowOrThrow({
    row: rowBefore,
    parsedReference,
    errorPrefix,
  });

  runReleaseUpdate({
    db,
    tableName,
    parsedReference,
    requestedSeats: normalizedRequestedSeats,
  });

  const rowAfter = readSlotRowById(db, tableName, parsedReference.slot_id);
  assertSlotReferenceMatchesRowOrThrow({
    row: rowAfter,
    parsedReference,
    errorPrefix,
  });

  const baseSummary = buildHoldSummary({
    parsedReference,
    tableName,
    requestedSeats: normalizedRequestedSeats,
    rowBefore,
    rowAfter,
    releasedAt,
  });
  const releasedSeats = Math.max(
    0,
    Math.min(
      normalizedRequestedSeats,
      getCurrentSeatsLeft(rowAfter) - getCurrentSeatsLeft(rowBefore)
    )
  );

  return Object.freeze({
    ...baseSummary,
    released_seats: releasedSeats,
    seats_left_after_release: getCurrentSeatsLeft(rowAfter),
    release_applied: releasedSeats > 0,
  });
}
