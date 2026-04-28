import db from '../../db.js';
import { assertShiftOpen, SHIFT_CLOSED_CODE } from '../../shift-guard.mjs';

const SEAT_STATUS_LIST = [
  'ACTIVE',
  'PAID',
  'UNPAID',
  'RESERVED',
  'PARTIALLY_PAID',
  'CONFIRMED',
  'USED',
];

function createPresaleRouteError(code, message, status = 400, extra = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  Object.assign(error, extra);
  return error;
}

function countOccupiedSeatsForSlotUid(slotUid) {
  const placeholders = SEAT_STATUS_LIST.map(() => '?').join(',');
  return Number(
    db
      .prepare(`
        SELECT COALESCE(SUM(number_of_seats), 0) AS cnt
        FROM presales
        WHERE slot_uid = ?
          AND status IN (${placeholders})
      `)
      .get(String(slotUid || ''), ...SEAT_STATUS_LIST)?.cnt || 0
  );
}

function countOccupiedSeatsForBoatSlot(boatSlotId) {
  const placeholders = SEAT_STATUS_LIST.map(() => '?').join(',');
  return Number(
    db
      .prepare(`
        SELECT COUNT(*) AS cnt
        FROM tickets
        WHERE boat_slot_id = ?
          AND status IN (${placeholders})
      `)
      .get(boatSlotId, ...SEAT_STATUS_LIST)?.cnt || 0
  );
}

function getCapacityForBoatSlot(boatSlotId) {
  return Number(
    db.prepare(`SELECT capacity FROM boat_slots WHERE id = ?`).get(boatSlotId)?.capacity || 0
  );
}

function assertCapacityOrThrow(boatSlotId, requestedSeats) {
  const capacity = getCapacityForBoatSlot(boatSlotId);
  const occupied = countOccupiedSeatsForBoatSlot(boatSlotId);
  if (requestedSeats > capacity - occupied) {
    const error = new Error('CAPACITY_EXCEEDED');
    error.details = {
      capacity,
      occupied,
      requested: requestedSeats,
      free: capacity - occupied,
      boatSlotId,
    };
    throw error;
  }
}

function assertCapacityForSlotUidOrThrow(slotUid, boatSlotIdForFK, requestedSeats) {
  const seats = Number(requestedSeats || 0);
  if (!Number.isFinite(seats) || seats < 1) return;

  const normalizedSlotUid = String(slotUid || '');
  if (normalizedSlotUid.startsWith('generated:')) {
    const generatedSlotId = Number(normalizedSlotUid.split(':')[1]);
    const row = db
      .prepare(`SELECT capacity FROM generated_slots WHERE id = ?`)
      .get(generatedSlotId);
    const capacity = Number(row?.capacity || 0);
    const occupied = Math.max(0, countOccupiedSeatsForSlotUid(normalizedSlotUid));
    const seatsLeft = Math.max(0, capacity - occupied);

    try {
      db.prepare(`UPDATE generated_slots SET seats_left = ? WHERE id = ?`).run(
        seatsLeft,
        generatedSlotId
      );
    } catch {}

    if (seats > seatsLeft) {
      const error = new Error('CAPACITY_EXCEEDED');
      error.details = {
        capacity,
        occupied,
        requested: seats,
        free: seatsLeft,
        boatSlotId: boatSlotIdForFK,
      };
      throw error;
    }

    return;
  }

  assertCapacityOrThrow(boatSlotIdForFK, seats);
}

function syncSeatsLeftCache(boatSlotId, capacityOverride = null) {
  const capacity = Number.isFinite(capacityOverride)
    ? Number(capacityOverride)
    : getCapacityForBoatSlot(boatSlotId);
  const occupied = countOccupiedSeatsForBoatSlot(boatSlotId);
  const seatsLeft = Math.max(0, capacity - occupied);
  db.prepare(`UPDATE boat_slots SET seats_left = ? WHERE id = ?`).run(seatsLeft, boatSlotId);
  return { capacity, occupied, seats_left: seatsLeft };
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

function getBoatServiceType(boatType) {
  return boatType === 'banana' ? 'BANANA' : 'BOAT';
}

function validateTicketBreakdown(tickets, serviceType, capacity) {
  if (!tickets) {
    return { valid: true };
  }

  const adult = tickets.adult || 0;
  const teen = tickets.teen || 0;
  const child = tickets.child || 0;

  if (
    !Number.isInteger(adult) ||
    adult < 0 ||
    !Number.isInteger(teen) ||
    teen < 0 ||
    !Number.isInteger(child) ||
    child < 0
  ) {
    return {
      valid: false,
      error: 'Количество билетов должно быть неотрицательным целым числом',
    };
  }

  const totalSeats = adult + teen + child;

  if (serviceType === 'BANANA') {
    if (teen > 0) {
      return {
        valid: false,
        error: 'Для банана подростковые билеты недоступны',
      };
    }

    if (totalSeats > 12) {
      return {
        valid: false,
        error: 'Для банана вместимость не может превышать 12 мест',
      };
    }
  } else if (totalSeats > capacity) {
    return {
      valid: false,
      error: `Количество мест не может превышать вместимость лодки (${capacity})`,
    };
  }

  return { valid: true, totalSeats };
}

function resolveSlotByUid(slotUid, tripDate = null) {
  console.log(`[RESOLVE_SLOT_START] slotUid=${slotUid}, tripDate=${tripDate}`);

  let slotId;
  let slotType;

  if (typeof slotUid !== 'string') {
    throw new Error('SLOT_UID_INVALID: slotUid must be a string');
  }

  if (slotUid.startsWith('manual:')) {
    slotType = 'manual';
    slotId = parseInt(slotUid.substring(7), 10);
  } else if (slotUid.startsWith('generated:')) {
    slotType = 'generated';
    slotId = parseInt(slotUid.substring(10), 10);
  } else {
    throw new Error('SLOT_UID_INVALID: slotUid must be manual:<id> or generated:<id>');
  }

  if (Number.isNaN(slotId)) {
    throw new Error('SLOT_UID_INVALID: slotUid must be manual:<id> or generated:<id>');
  }

  let slotInfo = null;

  if (slotType === 'manual') {
    slotInfo = db
      .prepare(`
        SELECT bs.id, bs.boat_id, bs.time, bs.price, bs.capacity, bs.seats_left,
               bs.duration_minutes, bs.is_active, bs.price_adult, bs.price_child, bs.price_teen,
               bss.seller_cutoff_minutes, bss.dispatcher_cutoff_minutes,
               b.name as boat_name, b.type as boat_type, b.is_active as boat_is_active
        FROM boat_slots bs
        JOIN boats b ON bs.boat_id = b.id
        LEFT JOIN boat_settings bss ON bss.boat_id = bs.boat_id
        WHERE bs.id = ?
      `)
      .get(slotId);
  } else {
    let query;
    let queryParams;

    if (tripDate) {
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

    if (slotType === 'generated' && slotId <= 2) {
      console.log(
        `[RESOLVE_SLOT_DEBUG] slotId=${slotId}, tripDate=${tripDate}, seats_left_raw=${slotInfo?.seats_left}, capacity=${slotInfo?.capacity}`
      );
    }

    if (tripDate && !slotInfo) {
      throw new Error(`SLOT_DATE_MISMATCH: Generated slot ${slotId} not found for date ${tripDate}`);
    }
  }

  if (!slotInfo) {
    throw new Error(`SLOT_NOT_FOUND: Slot not found for slotUid=${slotUid}`);
  }

  return {
    source_type: slotType,
    slot_id: slotInfo.id,
    boat_id: slotInfo.boat_id,
    time: slotInfo.time,
    trip_date: slotInfo.trip_date,
    price: slotInfo.price,
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
    boat_is_active: slotInfo.boat_is_active,
  };
}

function buildTripClosedDebugInfo({ slotUid, resolvedSlot, userRole }) {
  const tripDate =
    resolvedSlot?.trip_date || new Date().toISOString().split('T')[0];

  return {
    slotUid,
    trip_date: tripDate,
    trip_time: resolvedSlot?.time || null,
    tripStart:
      resolvedSlot?.time ? new Date(`${tripDate} ${resolvedSlot.time}`).toISOString() : null,
    now: new Date().toISOString(),
    serverTimezoneHint: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
    userRole,
  };
}

function normalizePresaleCreateRouteError(slotUid, tripDate, error) {
  const rawMessage = error?.message || 'Presale create failed';

  if (rawMessage.includes('SLOT_DATE_MISMATCH')) {
    const match = rawMessage.match(/Generated slot (\d+) not found for date (.+)/);
    return createPresaleRouteError(
      'SLOT_DATE_MISMATCH',
      'Generated slot not found for given date',
      400,
      {
        httpBody: {
          ok: false,
          code: 'SLOT_DATE_MISMATCH',
          message: 'Generated slot not found for given date',
          debug: {
            slotUid,
            trip_date: tripDate,
            error_details: {
              slotId: match ? match[1] : null,
              requestedDate: match ? match[2] : null,
            },
          },
        },
      }
    );
  }

  if (rawMessage.includes('SLOT_NOT_FOUND')) {
    return createPresaleRouteError(
      'SLOT_NOT_FOUND',
      `Slot not found for slotUid=${slotUid}`,
      404,
      {
        httpBody: {
          ok: false,
          code: 'SLOT_NOT_FOUND',
          message: `Slot not found for slotUid=${slotUid}`,
          debug: { slotUid },
        },
      }
    );
  }

  if (rawMessage.includes('SLOT_UID_INVALID')) {
    return createPresaleRouteError(
      'SLOT_UID_INVALID',
      rawMessage,
      400,
      {
        httpBody: {
          ok: false,
          code: 'SLOT_UID_INVALID',
          message: rawMessage,
        },
      }
    );
  }

  return createPresaleRouteError('SLOT_RESOLUTION_ERROR', rawMessage, 400, {
    httpBody: {
      ok: false,
      code: 'SLOT_RESOLUTION_ERROR',
      message: rawMessage,
    },
  });
}

function assertSlotIsSellableOrThrow({ slotUid, resolvedSlot, actorRole }) {
  if (resolvedSlot.is_active !== 1 || resolvedSlot.boat_is_active !== 1) {
    const debugInfo = buildTripClosedDebugInfo({
      slotUid,
      resolvedSlot,
      userRole: actorRole,
    });
    console.log('[TRIP_CLOSED_BY_TIME_DEBUG]', debugInfo);
    throw createPresaleRouteError('TRIP_CLOSED_BY_TIME', 'Boat or slot is not active', 403, {
      debug: debugInfo,
      httpBody: {
        ok: false,
        code: 'TRIP_CLOSED_BY_TIME',
        message: 'Boat or slot is not active',
        debug: debugInfo,
      },
    });
  }

  const isGenerated = resolvedSlot.source_type === 'generated';
  let cutoffMinutes = null;
  if (
    actorRole === 'seller' &&
    resolvedSlot.seller_cutoff_minutes !== null &&
    resolvedSlot.seller_cutoff_minutes > 0
  ) {
    cutoffMinutes = resolvedSlot.seller_cutoff_minutes;
  } else if (
    actorRole === 'dispatcher' &&
    resolvedSlot.dispatcher_cutoff_minutes !== null &&
    resolvedSlot.dispatcher_cutoff_minutes > 0
  ) {
    cutoffMinutes = resolvedSlot.dispatcher_cutoff_minutes;
  }

  if (cutoffMinutes !== null) {
    const query = isGenerated
      ? `
        SELECT datetime(trip_date || ' ' || time, '-' || ? || ' minutes') as cutoff_time
        FROM generated_slots
        WHERE id = ?
      `
      : `
        SELECT datetime(date('now') || ' ' || time, '-' || ? || ' minutes') as cutoff_time
        FROM boat_slots
        WHERE id = ?
      `;
    const cutoffRow = db.prepare(query).get(cutoffMinutes, resolvedSlot.slot_id);
    const nowRow = db.prepare("SELECT datetime('now') as current_time").get();

    if (isGenerated) {
      console.log(
        '[TRIP_TIME_CHECK] cutoffDateTime:',
        cutoffRow,
        'now:',
        nowRow,
        'isCutoffApplicable:',
        true,
        'cutoffMinutes:',
        cutoffMinutes
      );
    }

    if (cutoffRow?.cutoff_time <= nowRow?.current_time) {
      const debugInfo = buildTripClosedDebugInfo({
        slotUid,
        resolvedSlot,
        userRole: actorRole,
      });
      console.log('[TRIP_CLOSED_BY_TIME_DEBUG]', debugInfo);
      throw createPresaleRouteError(
        'TRIP_CLOSED_BY_TIME',
        `trip closed (${actorRole} cutoff)`,
        403,
        {
          debug: debugInfo,
          httpBody: {
            ok: false,
            code: 'TRIP_CLOSED_BY_TIME',
            message: `trip closed (${actorRole} cutoff)`,
            debug: debugInfo,
          },
        }
      );
    }
  }

  if (resolvedSlot?.trip_date && resolvedSlot?.time) {
    const tripStart = new Date(`${resolvedSlot.trip_date}T${resolvedSlot.time}:00`);
    const now = new Date();
    console.log(
      `[SALES_TIME_CHECK] tripStart=${tripStart.toISOString()}, now=${now.toISOString()}, role=${actorRole}`
    );

    if (actorRole === 'seller') {
      const closeAt = new Date(tripStart.getTime() - 10 * 60 * 1000);
      console.log(
        `[SALES_TIME_CHECK] seller closeAt=${closeAt.toISOString()}, now>=closeAt? ${now >= closeAt}`
      );
      if (now >= closeAt) {
        console.log(`[SALES_CLOSED] Seller sales closed for slot ${slotUid}`);
        throw createPresaleRouteError(
          'SALES_CLOSED',
          'Продажи закрыты за 10 минут до старта рейса',
          409,
          {
            httpBody: {
              ok: false,
              code: 'SALES_CLOSED',
              message: 'Продажи закрыты за 10 минут до старта рейса',
            },
          }
        );
      }
    }

    if (actorRole === 'dispatcher') {
      const closeAt = new Date(tripStart.getTime() + 10 * 60 * 1000);
      if (now > closeAt) {
        throw createPresaleRouteError(
          'SALES_CLOSED',
          'Продажи закрыты через 10 минут после старта рейса',
          409,
          {
            httpBody: {
              ok: false,
              code: 'SALES_CLOSED',
              message: 'Продажи закрыты через 10 минут после старта рейса',
            },
          }
        );
      }
    }
  }
}

export function createPresaleFromPreparedInput({
  slotUid,
  tripDate = null,
  customerName,
  customerPhone,
  seats,
  ticketsJson = null,
  prepayment = 0,
  prepaymentComment = null,
  sellerId = null,
  actorRole,
  actorUserId = null,
  paymentMethodUpper = null,
  paymentCashAmount = 0,
  paymentCardAmount = 0,
  latAtSale = null,
  lngAtSale = null,
  zoneAtSale = null,
  seatHoldAlreadyApplied = false,
} = {}) {
  const normalizedActorRole = String(actorRole || '').toLowerCase();
  if (normalizedActorRole !== 'seller' && normalizedActorRole !== 'dispatcher') {
    throw createPresaleRouteError(
      'INVALID_SALE_ACTOR',
      'Presale creation requires seller or dispatcher context',
      403
    );
  }

  let resolvedSlot;
  try {
    resolvedSlot = resolveSlotByUid(slotUid, tripDate);
  } catch (error) {
    throw normalizePresaleCreateRouteError(slotUid, tripDate, error);
  }

  assertSlotIsSellableOrThrow({
    slotUid,
    resolvedSlot,
    actorRole: normalizedActorRole,
  });

  let normalizedSeats = Number(seats);
  const serviceType = getBoatServiceType(resolvedSlot.boat_type);
  let parsedTickets = null;

  if (ticketsJson) {
    try {
      parsedTickets = JSON.parse(ticketsJson);
    } catch {
      parsedTickets = null;
    }

    const validation = validateTicketBreakdown(
      parsedTickets,
      serviceType,
      resolvedSlot.capacity
    );
    if (!validation.valid) {
      throw createPresaleRouteError('INVALID_TICKET_BREAKDOWN', validation.error, 400, {
        httpBody: {
          ok: false,
          code: 'INVALID_TICKET_BREAKDOWN',
          message: validation.error,
        },
      });
    }

    normalizedSeats = validation.totalSeats;
  } else if (normalizedSeats > resolvedSlot.capacity) {
    throw createPresaleRouteError(
      'SEAT_CAPACITY_EXCEEDED',
      `Количество мест не может превышать вместимость лодки (${resolvedSlot.capacity})`,
      400,
      {
        httpBody: {
          ok: false,
          code: 'SEAT_CAPACITY_EXCEEDED',
          message: `Количество мест не может превышать вместимость лодки (${resolvedSlot.capacity})`,
        },
      }
    );
  }

  if (!seatHoldAlreadyApplied) {
    console.log(
      `[PRESALE_CAPACITY_CHECK] slotUid=${slotUid}, resolvedSlot.seats_left=${resolvedSlot.seats_left}, seats=${normalizedSeats}`
    );
    if (resolvedSlot.seats_left < normalizedSeats) {
      console.log(
        `[PRESALE_CAPACITY_FAIL] BEFORE TRANSACTION: seats_left ${resolvedSlot.seats_left} < requested ${normalizedSeats}`
      );
      throw createPresaleRouteError('NO_SEATS', 'Недостаточно мест', 409, {
        httpBody: {
          ok: false,
          code: 'NO_SEATS',
          message: 'Недостаточно мест',
        },
      });
    }
  }

  let calculatedTotalPrice = 0;
  const boatDefaults = db
    .prepare('SELECT price_adult, price_child, price_teen FROM boats WHERE id = ?')
    .get(resolvedSlot.boat_id);
  const legacyBase = resolvedSlot.price || 0;
  const adultPrice =
    (resolvedSlot.price_adult ?? 0) || (boatDefaults?.price_adult ?? 0) || legacyBase;
  const teenPrice =
    (resolvedSlot.price_teen ?? 0) || (boatDefaults?.price_teen ?? 0) || legacyBase;
  const childPrice =
    (resolvedSlot.price_child ?? 0) || (boatDefaults?.price_child ?? 0) || legacyBase;

  if (parsedTickets) {
    const adultTickets = parseInt(parsedTickets.adult || 0, 10) || 0;
    const teenTickets = parseInt(parsedTickets.teen || 0, 10) || 0;
    const childTickets = parseInt(parsedTickets.child || 0, 10) || 0;
    calculatedTotalPrice =
      adultTickets * adultPrice + teenTickets * teenPrice + childTickets * childPrice;
  } else {
    const slotPrice = (resolvedSlot.price ?? 0) || (boatDefaults?.price_adult ?? 0) || 0;
    calculatedTotalPrice = slotPrice * normalizedSeats;
  }

  if (prepayment > calculatedTotalPrice) {
    throw createPresaleRouteError(
      'PREPAYMENT_EXCEEDS_TOTAL',
      'Prepayment amount cannot exceed total price',
      400,
      {
        httpBody: {
          ok: false,
          code: 'PREPAYMENT_EXCEEDS_TOTAL',
          message: 'Prepayment amount cannot exceed total price',
        },
      }
    );
  }

  if (normalizedActorRole === 'dispatcher' && sellerId != null) {
    const sellerIdNum = Number(sellerId);
    if (!Number.isFinite(sellerIdNum) || sellerIdNum <= 0) {
      throw createPresaleRouteError(
        'INVALID_SELLER_ID',
        'Нельзя оформить продажу: выбранный продавец недоступен',
        400,
        {
          httpBody: {
            ok: false,
            code: 'INVALID_SELLER_ID',
            message: 'Нельзя оформить продажу: выбранный продавец недоступен',
          },
        }
      );
    }

    const sellerRow = db
      .prepare(`
        SELECT id FROM users
        WHERE id = ? AND role = 'seller' AND is_active = 1
      `)
      .get(sellerIdNum);

    if (!sellerRow) {
      console.error('[PRESALE_CREATE] Invalid seller_id:', {
        sellerId: sellerIdNum,
        dispatcher: actorUserId,
      });
      throw createPresaleRouteError(
        'SELLER_NOT_FOUND',
        'Нельзя оформить продажу: выбранный продавец недоступен',
        400,
        {
          httpBody: {
            ok: false,
            code: 'SELLER_NOT_FOUND',
            message: 'Нельзя оформить продажу: выбранный продавец недоступен',
          },
        }
      );
    }
  }

  if (normalizedActorRole === 'seller') {
    const sellerActorId = Number(actorUserId);
    const sellerActorRow =
      Number.isFinite(sellerActorId) && sellerActorId > 0
        ? db
            .prepare(`
              SELECT id FROM users
              WHERE id = ? AND role = 'seller' AND is_active = 1
            `)
            .get(sellerActorId)
        : null;

    if (!sellerActorRow) {
      throw createPresaleRouteError(
        'SELLER_NOT_FOUND',
        'Нельзя оформить продажу: выбранный продавец недоступен',
        400
      );
    }
  }

  const saleAttribution = resolveSaleMoneyAttribution(
    normalizedActorRole === 'seller' ? actorUserId : sellerId,
    actorUserId
  );
  const effectiveSellerId = saleAttribution.attributed_user_id;

  let resolvedZoneAtSale = zoneAtSale || null;
  if (!resolvedZoneAtSale && effectiveSellerId) {
    try {
      const sellerZoneRow = db
        .prepare('SELECT zone FROM users WHERE id = ?')
        .get(effectiveSellerId);
      resolvedZoneAtSale = sellerZoneRow?.zone || null;
    } catch {
      resolvedZoneAtSale = resolvedZoneAtSale || null;
    }
  }

  const transaction = db.transaction(
    (
      slotId,
      slotType,
      seatCount,
      customerNameValue,
      customerPhoneValue,
      prepaymentValue,
      prepaymentCommentValue,
      normalizedTicketsJson,
      slotUidInput,
      normalizedPaymentMethodUpper,
      normalizedPaymentCashAmount,
      normalizedPaymentCardAmount,
      normalizedSellerId,
      latitudeAtSale,
      longitudeAtSale,
      normalizedZoneAtSale,
      seatReservationAlreadyApplied
    ) => {
      let updateResult = { changes: 1 };
      if (!seatReservationAlreadyApplied) {
        if (slotType === 'generated') {
          updateResult = db
            .prepare(`
              UPDATE generated_slots
              SET seats_left = (CASE WHEN seats_left IS NULL OR seats_left < 1 THEN capacity ELSE seats_left END) - ?
              WHERE id = ? AND (CASE WHEN seats_left IS NULL OR seats_left < 1 THEN capacity ELSE seats_left END) >= ?
            `)
            .run(seatCount, slotId, seatCount);
        } else {
          updateResult = db
            .prepare(`
              UPDATE boat_slots
              SET seats_left = (CASE WHEN seats_left IS NULL OR seats_left < 1 THEN capacity ELSE seats_left END) - ?
              WHERE id = ? AND (CASE WHEN seats_left IS NULL OR seats_left < 1 THEN capacity ELSE seats_left END) >= ?
            `)
            .run(seatCount, slotId, seatCount);
        }
      }

      if (updateResult.changes === 0) {
        throw new Error('NO_SEATS');
      }

      let boatSlotIdForFK = slotId;
      let presaleSlotUid = slotUidInput;
      let resolvedCapacityForSlot = null;

      if (typeof slotUidInput === 'string' && slotUidInput.startsWith('generated:')) {
        const generatedSlotId = Number(slotUidInput.split(':')[1]);
        const generatedSlot = db
          .prepare(`
            SELECT boat_id, time, capacity, seats_left, duration_minutes,
                   price_adult, price_teen, price_child, trip_date
            FROM generated_slots
            WHERE id = ?
          `)
          .get(generatedSlotId);
        resolvedCapacityForSlot = Number(generatedSlot?.capacity ?? null);

        if (!generatedSlot) {
          throw new Error('GEN_NOT_FOUND');
        }

        presaleSlotUid = `generated:${generatedSlotId}`;

        const existingBoatSlot = db
          .prepare(`
            SELECT id FROM boat_slots
            WHERE boat_id = ? AND time = ?
            LIMIT 1
          `)
          .get(generatedSlot.boat_id, generatedSlot.time);

        if (existingBoatSlot) {
          boatSlotIdForFK = existingBoatSlot.id;
        } else {
          const basePrice =
            generatedSlot.price_adult ??
            generatedSlot.price_teen ??
            generatedSlot.price_child ??
            0;
          const insertResult = db
            .prepare(`
              INSERT INTO boat_slots
                (boat_id, time, capacity, seats_left, duration_minutes, is_active,
                 price, price_adult, price_teen, price_child)
              VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
            `)
            .run(
              generatedSlot.boat_id,
              generatedSlot.time,
              generatedSlot.capacity ?? 0,
              generatedSlot.seats_left ?? generatedSlot.capacity ?? 0,
              generatedSlot.duration_minutes ?? 0,
              basePrice,
              generatedSlot.price_adult ?? null,
              generatedSlot.price_teen ?? null,
              generatedSlot.price_child ?? null
            );

          boatSlotIdForFK = Number(insertResult.lastInsertRowid);
        }
      }

      let presaleBusinessDay = null;
      if (typeof presaleSlotUid === 'string' && presaleSlotUid.startsWith('generated:')) {
        const generatedSlotId = Number(presaleSlotUid.split(':')[1]);
        const generatedRow = db
          .prepare(`SELECT trip_date FROM generated_slots WHERE id = ?`)
          .get(generatedSlotId);
        presaleBusinessDay = generatedRow?.trip_date || null;
      } else if (boatSlotIdForFK) {
        const slotRow = db
          .prepare(`SELECT trip_date FROM boat_slots WHERE id = ?`)
          .get(boatSlotIdForFK);
        presaleBusinessDay = slotRow?.trip_date || null;
      }

      if (!presaleBusinessDay) {
        presaleBusinessDay = db.prepare(`SELECT DATE('now','localtime') AS d`).get()?.d || null;
      }

      assertShiftOpen(presaleBusinessDay);
      assertCapacityForSlotUidOrThrow(presaleSlotUid, boatSlotIdForFK, seatCount);

      const presalesCols = db.prepare('PRAGMA table_info(presales)').all();
      const hasBusinessDay = presalesCols.some((column) => column.name === 'business_day');
      const hasZoneGps = presalesCols.some((column) => column.name === 'zone_at_sale');

      let presaleStmt;
      let presaleParams;

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
          normalizedSellerId,
          customerNameValue.trim(),
          customerPhoneValue.trim(),
          seatCount,
          calculatedTotalPrice,
          prepaymentValue,
          prepaymentCommentValue?.trim() || null,
          'ACTIVE',
          normalizedTicketsJson || null,
          normalizedPaymentMethodUpper,
          Math.round(Number(normalizedPaymentCashAmount || 0)),
          Math.round(Number(normalizedPaymentCardAmount || 0)),
          presaleBusinessDay,
          normalizedZoneAtSale,
          latitudeAtSale,
          longitudeAtSale,
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
          normalizedSellerId,
          customerNameValue.trim(),
          customerPhoneValue.trim(),
          seatCount,
          calculatedTotalPrice,
          prepaymentValue,
          prepaymentCommentValue?.trim() || null,
          'ACTIVE',
          normalizedTicketsJson || null,
          normalizedPaymentMethodUpper,
          Math.round(Number(normalizedPaymentCashAmount || 0)),
          Math.round(Number(normalizedPaymentCardAmount || 0)),
          presaleBusinessDay,
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
          normalizedSellerId,
          customerNameValue.trim(),
          customerPhoneValue.trim(),
          seatCount,
          calculatedTotalPrice,
          prepaymentValue,
          prepaymentCommentValue?.trim() || null,
          'ACTIVE',
          normalizedTicketsJson || null,
          normalizedPaymentMethodUpper,
          Math.round(Number(normalizedPaymentCashAmount || 0)),
          Math.round(Number(normalizedPaymentCardAmount || 0)),
        ];
      }

      const presaleResult = presaleStmt.run(...presaleParams);

      try {
        const paidNow = Math.round(
          (Number(normalizedPaymentCashAmount || 0) +
            Number(normalizedPaymentCardAmount || 0)) ||
            0
        );
        if (paidNow > 0 && normalizedPaymentMethodUpper) {
          const already = db
            .prepare(`
              SELECT 1
              FROM money_ledger
              WHERE presale_id = ?
                AND type LIKE 'SALE_%'
              LIMIT 1
            `)
            .get(presaleResult.lastInsertRowid);

          if (!already) {
            const currentSaleAttribution = resolveSaleMoneyAttribution(normalizedSellerId);
            let ledgerType = 'SALE_PREPAYMENT';
            if (
              Number(normalizedPaymentCashAmount) > 0 &&
              Number(normalizedPaymentCardAmount) > 0
            ) {
              ledgerType = 'SALE_PREPAYMENT_MIXED';
            } else if (Number(normalizedPaymentCashAmount) > 0) {
              ledgerType = 'SALE_PREPAYMENT_CASH';
            } else if (Number(normalizedPaymentCardAmount) > 0) {
              ledgerType = 'SALE_PREPAYMENT_CARD';
            }

            const businessDayNow = (() => {
              try {
                return db.prepare(`SELECT DATE('now','localtime') AS d`).get()?.d;
              } catch {
                return null;
              }
            })();

            db.prepare(`
              INSERT INTO money_ledger (
                presale_id, slot_id, event_time, kind, type, method, amount, status, seller_id, business_day, trip_day
              ) VALUES (
                @presale_id, @slot_id, datetime('now','localtime'), @kind, @type, @method, @amount, 'POSTED', @seller_id, @business_day, @trip_day
              )
            `).run({
              presale_id: presaleResult.lastInsertRowid,
              slot_id: boatSlotIdForFK ?? null,
              kind: currentSaleAttribution.ledger_kind,
              type: ledgerType,
              method: normalizedPaymentMethodUpper || null,
              amount: paidNow,
              seller_id: currentSaleAttribution.attributed_user_id,
              business_day: businessDayNow,
              trip_day: presaleBusinessDay ?? null,
            });
          }
        }
      } catch (ledgerError) {
        console.warn(
          '[PRESALE_CREATE] ledger prepayment write skipped:',
          ledgerError?.message || ledgerError
        );
      }

      const ticketStmt = db.prepare(`
        INSERT INTO tickets (
          presale_id, boat_slot_id, ticket_code, status, price
        ) VALUES (?, ?, ?, 'ACTIVE', ?)
      `);

      let ticketPrices = [];
      if (normalizedTicketsJson) {
        let breakdown = null;
        try {
          breakdown = JSON.parse(normalizedTicketsJson);
        } catch {
          breakdown = null;
        }

        if (breakdown) {
          const adultCount = parseInt(breakdown.adult || 0, 10) || 0;
          const teenCount = parseInt(breakdown.teen || 0, 10) || 0;
          const childCount = parseInt(breakdown.child || 0, 10) || 0;
          const boatDefaultsRow = db
            .prepare(
              'SELECT price_adult, price_child, price_teen FROM boats WHERE id = ?'
            )
            .get(resolvedSlot.boat_id);
          const legacyBasePrice = resolvedSlot.price || 0;
          const currentAdultPrice =
            (resolvedSlot.price_adult ?? 0) ||
            (boatDefaultsRow?.price_adult ?? 0) ||
            legacyBasePrice;
          const currentTeenPrice =
            (resolvedSlot.price_teen ?? 0) ||
            (boatDefaultsRow?.price_teen ?? 0) ||
            legacyBasePrice;
          const currentChildPrice =
            (resolvedSlot.price_child ?? 0) ||
            (boatDefaultsRow?.price_child ?? 0) ||
            legacyBasePrice;

          ticketPrices = [
            ...Array(adultCount).fill(currentAdultPrice),
            ...Array(teenCount).fill(currentTeenPrice),
            ...Array(childCount).fill(currentChildPrice),
          ];
        }
      }

      if (ticketPrices.length === 0) {
        const pricePerSeat = Math.round(calculatedTotalPrice / Math.max(1, seatCount));
        ticketPrices = Array(seatCount).fill(pricePerSeat);
      }

      const insertedTicketIds = [];
      for (let index = 0; index < ticketPrices.length; index += 1) {
        const ticketCode = `TKT-${presaleResult.lastInsertRowid}-${index + 1}`;
        const ticketInsertResult = ticketStmt.run(
          presaleResult.lastInsertRowid,
          boatSlotIdForFK,
          ticketCode,
          ticketPrices[index]
        );
        try {
          if (
            ticketInsertResult &&
            typeof ticketInsertResult.lastInsertRowid !== 'undefined'
          ) {
            insertedTicketIds.push(Number(ticketInsertResult.lastInsertRowid));
          }
        } catch {}
      }

      let canonicalTicketRows = null;
      if (insertedTicketIds.length === ticketPrices.length) {
        canonicalTicketRows = insertedTicketIds.map((id, index) => ({
          ticket_id: id,
          amount: Math.round(Number(ticketPrices[index] || 0)),
        }));
      } else {
        try {
          const rows = db
            .prepare(`SELECT id, price FROM tickets WHERE presale_id = ? ORDER BY id ASC`)
            .all(presaleResult.lastInsertRowid);
          if (Array.isArray(rows) && rows.length > 0) {
            canonicalTicketRows = rows.map((row) => ({
              ticket_id: Number(row.id),
              amount: Math.round(Number(row.price || 0)),
            }));
          }
        } catch (ticketSelectError) {
          console.warn(
            '[PRESALE_CREATE] fallback ticket select failed:',
            ticketSelectError?.message || ticketSelectError
          );
        }
      }

      try {
        const canonExists = db
          .prepare(
            `SELECT 1 FROM sqlite_master WHERE type='table' AND name='sales_transactions_canonical'`
          )
          .get();
        if (canonExists && Array.isArray(canonicalTicketRows) && canonicalTicketRows.length > 0) {
          const cols = db
            .prepare(`PRAGMA table_info(sales_transactions_canonical)`)
            .all()
            .map((row) => row.name);
          const has = (column) => cols.includes(column);

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

          const placeholders = insertCols.map(() => '?').join(',');
          const insertCanonical = db.prepare(
            `INSERT OR IGNORE INTO sales_transactions_canonical (${insertCols.join(',')}) VALUES (${placeholders})`
          );

          const canUpdateByTicketId = has('ticket_id');
          const updateCols = insertCols.filter((column) => column !== 'ticket_id');
          const updateSet = updateCols.map((column) => `${column} = ?`).join(', ');
          const updateCanonical =
            canUpdateByTicketId && updateCols.length > 0
              ? db.prepare(
                  `UPDATE sales_transactions_canonical SET ${updateSet} WHERE ticket_id = ?`
                )
              : null;

          const totalTicketsAmount = canonicalTicketRows.reduce(
            (sum, row) => sum + Math.round(Number(row.amount || 0)),
            0
          );
          const cashTotal = Math.round(Number(normalizedPaymentCashAmount || 0));
          const cardTotal = Math.round(Number(normalizedPaymentCardAmount || 0));
          const denominator = Math.max(1, totalTicketsAmount);
          const cashRatio = cashTotal / denominator;
          const cardRatio = cardTotal / denominator;

          let cashRemaining = cashTotal;
          let cardRemaining = cardTotal;

          for (let index = 0; index < canonicalTicketRows.length; index += 1) {
            const ticketId = canonicalTicketRows[index].ticket_id;
            const amount = Math.round(Number(canonicalTicketRows[index].amount || 0));

            let cashPart = 0;
            let cardPart = 0;

            if (index === canonicalTicketRows.length - 1) {
              cashPart = Math.max(0, Math.min(amount, cashRemaining));
              cardPart = Math.max(0, Math.min(amount - cashPart, cardRemaining));
            } else {
              cashPart = Math.round(amount * cashRatio);
              cardPart = Math.round(amount * cardRatio);
              cashPart = Math.max(0, Math.min(cashPart, cashRemaining, amount));
              cardPart = Math.max(
                0,
                Math.min(cardPart, cardRemaining, amount - cashPart)
              );
            }

            cashRemaining -= cashPart;
            cardRemaining -= cardPart;

            const row = [];
            for (const column of insertCols) {
              if (column === 'ticket_id') row.push(ticketId);
              else if (column === 'presale_id') row.push(presaleResult.lastInsertRowid);
              else if (column === 'slot_id') row.push(boatSlotIdForFK);
              else if (column === 'boat_id') row.push(resolvedSlot.boat_id);
              else if (column === 'slot_uid') row.push(presaleSlotUid);
              else if (column === 'slot_source') row.push(resolvedSlot.source_type);
              else if (column === 'amount') row.push(amount);
              else if (column === 'cash_amount') row.push(cashPart);
              else if (column === 'card_amount') row.push(cardPart);
              else if (column === 'method') row.push(normalizedPaymentMethodUpper || null);
              else if (column === 'status') row.push('VALID');
              else if (column === 'business_day') {
                row.push(
                  tripDate ||
                    resolvedSlot?.trip_date ||
                    db.prepare(`SELECT DATE('now','localtime') as d`).get().d
                );
              } else row.push(null);
            }

            const insertResult = insertCanonical.run(...row);
            if (updateCanonical && insertResult && insertResult.changes === 0) {
              const updateRow = [];
              for (const column of updateCols) {
                const insertIndex = insertCols.indexOf(column);
                updateRow.push(row[insertIndex]);
              }
              updateRow.push(ticketId);
              updateCanonical.run(...updateRow);
            }
          }
        }
      } catch (canonicalError) {
        console.warn(
          '[PRESALE_CREATE] canonical insert skipped:',
          canonicalError?.message || canonicalError
        );
      }

      if (normalizedPaymentMethodUpper) {
        const paymentMethodLower = String(normalizedPaymentMethodUpper).toLowerCase();
        try {
          db.prepare(`UPDATE tickets SET payment_method = ? WHERE presale_id = ?`).run(
            paymentMethodLower,
            presaleResult.lastInsertRowid
          );
        } catch (paymentUpdateError) {
          console.warn(
            '[PRESALE_CREATE] tickets.payment_method update skipped:',
            paymentUpdateError?.message || paymentUpdateError
          );
        }
      }

      if (!(typeof slotUidInput === 'string' && slotUidInput.startsWith('generated:'))) {
        syncSeatsLeftCache(boatSlotIdForFK, resolvedCapacityForSlot || undefined);
      }

      return {
        lastInsertRowid: presaleResult.lastInsertRowid,
        totalPrice: calculatedTotalPrice,
      };
    }
  );

  let creationResult;
  try {
    creationResult = transaction(
      resolvedSlot.slot_id,
      resolvedSlot.source_type,
      normalizedSeats,
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
      resolvedZoneAtSale,
      Boolean(seatHoldAlreadyApplied)
    );
  } catch (transactionError) {
    if (transactionError?.code === SHIFT_CLOSED_CODE) {
      throw transactionError;
    }
    if (transactionError?.message === 'NO_SEATS') {
      throw createPresaleRouteError('NO_SEATS', 'Not enough seats available', 400);
    }
    if (transactionError?.message === 'GEN_NOT_FOUND') {
      throw createPresaleRouteError('SLOT_NOT_FOUND', 'Generated slot not found', 404);
    }
    if (transactionError?.message === 'Prepayment amount cannot exceed total price') {
      throw createPresaleRouteError(
        'PREPAYMENT_EXCEEDS_TOTAL',
        'Prepayment amount cannot exceed total price',
        400
      );
    }
    throw transactionError;
  }

  const presaleRow = db
    .prepare(`
      SELECT
        p.id, p.boat_slot_id, p.customer_name, p.customer_phone, p.number_of_seats,
        p.total_price, p.prepayment_amount, p.prepayment_comment, p.status, p.tickets_json,
        p.payment_method, p.payment_cash_amount, p.payment_card_amount,
        (p.total_price - p.prepayment_amount) as remaining_amount,
        p.created_at, p.updated_at
      FROM presales p
      WHERE p.id = ?
    `)
    .get(creationResult.lastInsertRowid);

  return {
    presaleId: creationResult.lastInsertRowid,
    totalPrice: creationResult.totalPrice,
    presale: {
      ...presaleRow,
      remaining_amount: creationResult.totalPrice - prepayment,
    },
    slot: {
      slot_uid: slotUid,
      source_type: resolvedSlot.source_type,
      trip_date: resolvedSlot.trip_date,
      time: resolvedSlot.time,
      boat_id: resolvedSlot.boat_id,
      boat_name: resolvedSlot.boat_name,
      price: resolvedSlot.price,
      capacity: resolvedSlot.capacity,
    },
    effectiveSellerId,
  };
}
