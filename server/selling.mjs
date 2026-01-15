import { Router } from 'express';
import db from './db.js';

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

function syncSeatsLeftCache(boatSlotId, capacityOverride = null) {
  const cap = Number.isFinite(capacityOverride) ? Number(capacityOverride) : getCapacityForBoatSlot(boatSlotId);
  const occ = countOccupiedSeatsForBoatSlot(boatSlotId);
  const left = Math.max(0, cap - occ);
  db.prepare(`UPDATE boat_slots SET seats_left = ? WHERE id = ?`).run(left, boatSlotId);
  return { capacity: cap, occupied: occ, seats_left: left };
}
import { authenticateToken, canSell, canDispatchManageSlots } from './auth.js';
import { getDatabaseFilePath } from './db.js';
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
    return { valid: false, error: 'Количество билетов должно быть неотрицательным целым числом' };
  }
  
  const totalSeats = adult + teen + child;
  
  if (serviceType === 'BANANA') {
    // For banana: no teen tickets allowed
    if (teen > 0) {
      return { valid: false, error: 'Для банана подростковые билеты недоступны' };
    }
    
    // For banana: capacity is always 12
    if (totalSeats > 12) {
      return { valid: false, error: 'Для банана вместимость не может превышать 12 мест' };
    }
  } else {
    // For boats: check against slot capacity
    if (totalSeats > capacity) {
      return { valid: false, error: `Количество мест не может превышать вместимость лодки (${capacity})` };
    }
  }
  
  return { valid: true, totalSeats };
};

// Helper function to validate duration based on service type
const validateDuration = (duration, serviceType) => {
  if (serviceType === 'BANANA') {
    // For banana: duration must be 40 minutes
    if (duration !== 40) {
      return { valid: false, error: 'Для банана длительность должна быть 40 минут' };
    }
  } else {
    // For boats: duration must be 60, 120, or 180 minutes
    if (duration && ![60, 120, 180].includes(duration)) {
      return { valid: false, error: 'Для лодки длительность должна быть 60, 120 или 180 минут' };
    }
  }
  
  return { valid: true };
};

// Helper function to resolve slot by UID for both manual and generated slots
const resolveSlotByUid = (slotUid, tripDate = null) => {
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
      SELECT id, name, type, capacity, is_active
      FROM boats 
      WHERE is_active = 1
      ORDER BY type, name
    `).all();
    
    res.json(boats);
  } catch (error) {
    console.error('[SELLING_500] route=/api/selling/boats message=', error.message, 'stack=', error.stack);
    res.status(500).json({ error: 'Ошибка сервера' });
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
      return res.status(400).json({ error: 'Недопустимый тип лодки' });
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
    // Use COALESCE to handle legacy data where seats_left might be NULL or 0
    // NOTE: Only return generated slots (with trip dates) for seller view, exclude manual template slots
    const slots = db.prepare(`
      SELECT
        gs.id as slot_id,
        ('generated:' || gs.id) as slot_uid,
        ('generated:' || gs.id) as slotUid,
        gs.id,
        gs.boat_id,
        gs.time,
        gs.price_adult as price,
        gs.capacity,
        gs.seats_left,
        gs.duration_minutes,
        gs.price_adult,
        gs.price_child,
        gs.price_teen,
        (gs.capacity - COALESCE(ticket_counts.active_tickets, 0)) as available_seats,
        b.name AS boat_name,
        b.type AS boat_type,
        gs.capacity AS boat_capacity,
        'generated' AS source_type,
        gs.trip_date,
        'generated:' || gs.id as slot_uid
      FROM generated_slots gs
      JOIN boats b ON gs.boat_id = b.id
      LEFT JOIN (
        SELECT 
          p.slot_uid,
          COUNT(*) as active_tickets
        FROM tickets t
        JOIN presales p ON t.presale_id = p.id
        WHERE t.status IN ('ACTIVE', 'USED')
        GROUP BY p.slot_uid
      ) ticket_counts ON ('generated:' || gs.id) = ticket_counts.slot_uid
      WHERE TRIM(LOWER(b.type)) = ?
        AND CAST(gs.is_active AS INTEGER) = 1
        AND (gs.capacity - COALESCE(ticket_counts.active_tickets, 0)) > 0
        AND (
          -- For future dates, show all trips
          gs.trip_date > date('now')
          OR
          -- For today's trips, only show if departure time is more than 10 minutes from now
          (gs.trip_date = date('now') AND time(gs.time) > time(datetime('now', '+10 minutes')))
        )
      ORDER BY gs.trip_date, gs.time
    `).all(boatType);
    
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
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// PRESALE ENDPOINTS

// Create a new presale
router.post('/presales', authenticateToken, canSell, async (req, res) => {
  try {
    const { slotUid, customerName, customerPhone, numberOfSeats, prepaymentAmount, prepaymentComment } = req.body;
    
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
          message: 'Требуется имя клиента' 
        });
      }
      if (!customerPhone || customerPhone.trim().length === 0) {
        return res.status(400).json({ 
          ok: false,
          code: 'CUSTOMER_PHONE_REQUIRED',
          message: 'Требуется номер телефона клиента' 
        });
      }
      return res.status(400).json({ 
        ok: false,
        code: 'MISSING_REQUIRED_FIELDS',
        message: 'Отсутствуют обязательные поля' 
      });
    }
    
    // Validate data types
    if (typeof customerName !== 'string' || customerName.trim().length < 2) {
      return res.status(400).json({ 
        ok: false,
        code: 'INVALID_CUSTOMER_NAME',
        message: 'Имя клиента должно содержать не менее 2 символов' 
      });
    }
    
    if (typeof customerPhone !== 'string' || customerPhone.trim().length < 5) {
      return res.status(400).json({ 
        ok: false,
        code: 'INVALID_CUSTOMER_PHONE',
        message: 'Номер телефона клиента должен содержать не менее 5 символов' 
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
          message: 'Некорректная структура билетов' 
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
          message: 'Количество билетов должно быть неотрицательным целым числом' 
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
          message: 'Количество мест должно быть не менее 1' 
        });
      }
    } else {
      // Use the original numberOfSeats approach
      seats = Number(numberOfSeats);
      if (!Number.isInteger(seats) || seats < 1) {
        return res.status(400).json({ 
          ok: false,
          code: 'INVALID_SEAT_COUNT',
          message: 'Некорректное количество мест' 
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
          message: `Количество мест не может превышать вместимость лодки (${resolvedSlot.capacity})`
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

      if (role === 'seller') {
        const closeAt = new Date(tripStart.getTime() - 10 * 60 * 1000);
        if (now >= closeAt) {
          return res.status(409).json({
            ok: false,
            code: 'SALES_CLOSED',
            message: 'Продажи закрыты за 10 минут до старта рейса'
          });
        }
      }

      if (role === 'dispatcher') {
        const closeAt = new Date(tripStart.getTime() + 10 * 60 * 1000);
        if (now > closeAt) {
          return res.status(409).json({
            ok: false,
            code: 'SALES_CLOSED',
            message: 'Продажи закрыты через 10 минут после старта рейса'
          });
        }
      }
    }

    // Check if there are enough seats available
    if (resolvedSlot.seats_left < seats) {
      return res.status(409).json({
        ok: false,
        code: 'NO_SEATS',
        message: 'Недостаточно мест'
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
    
    // Use transaction to ensure atomicity: decrement seats_left AND create presale
const transaction = db.transaction((slotId, slotType, seats, customerName, customerPhone, prepayment, prepaymentComment, ticketsJson, slotUidInput) => {
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
             price_adult, price_teen, price_child
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

  // 3) Create presale
  assertCapacityOrThrow(boatSlotIdForFK, seats);

  const presaleStmt = db.prepare(`
INSERT INTO presales (
      boat_slot_id, slot_uid,
      customer_name, customer_phone, number_of_seats,
      total_price, prepayment_amount, prepayment_comment, status, tickets_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const presaleResult = presaleStmt.run(
    boatSlotIdForFK,
    presaleSlotUid,
    customerName.trim(),
    customerPhone.trim(),
    seats,
    calculatedTotalPrice,
    prepayment,
    prepaymentComment?.trim() || null,
    'ACTIVE',
    ticketsJson || null
  );

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

  for (let i = 0; i < ticketPrices.length; i++) {
    const ticketCode = `TKT-${presaleResult.lastInsertRowid}-${i + 1}`;
    ticketStmt.run(
      presaleResult.lastInsertRowid,
      boatSlotIdForFK,
      ticketCode,
      ticketPrices[i]
    );
  }

  
  // Keep seats_left cache in sync (prevents negative UI values)
  const sync = syncSeatsLeftCache(boatSlotIdForFK, resolvedCapacityForSlot || undefined);
  if (typeof slotUidInput === 'string' && slotUidInput.startsWith('generated:')) {
    const genId2 = Number(slotUidInput.split(':')[1]);
    db.prepare(`UPDATE generated_slots SET seats_left = ? WHERE id = ?`).run(sync.seats_left, genId2);
  }

return { lastInsertRowid: presaleResult.lastInsertRowid, totalPrice: calculatedTotalPrice };
});

// Execute the transaction

    let newPresaleId;
    try {
      const result = transaction(
        resolvedSlot.slot_id,
        resolvedSlot.source_type,
        seats,
        customerName,
        customerPhone,
        prepayment,
        prepaymentComment,
        ticketsJson,
        slotUid
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
    
    // Return success response with structured data
    res.status(201).json({
      ok: true,
      presale: {
        ...presaleRow,
        remaining_amount: calculatedTotalPrice - prepayment
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
      debug: { 
        resolved_slot_kind: resolvedSlot.source_type, 
        sql_path: "SELECT presales row + attach slot info", 
        slotUid 
      }
    });
  } catch (error) {
    console.error('[PRESALE_CREATE_500]', { slotUid: req.body?.slotUid, message: error.message, stack: error.stack });
    if (error?.message === 'CAPACITY_EXCEEDED') {
      return res.status(409).json({ ok: false, code: 'CAPACITY_EXCEEDED', message: 'Недостаточно мест в рейсе', details: error.details || null });
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
    const presales = db.prepare(`
      SELECT 
        p.id, p.boat_slot_id, p.customer_name, p.customer_phone, p.number_of_seats,
        p.total_price, p.prepayment_amount, p.prepayment_comment, p.status, p.tickets_json,
        p.payment_method, p.payment_cash_amount, p.payment_card_amount,
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
      ORDER BY p.created_at DESC
    `).all();
    
    res.json(presales);
  } catch (error) {
    console.error('[SELLING_500] route=/api/selling/presales method=GET message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'Ошибка сервера' });
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
    res.status(500).json({ error: 'Ошибка сервера' });
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
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// DISPATCHER SLOT MANAGEMENT ENDPOINTS

// Create a new slot
router.post('/dispatcher/slots', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const { boat_id, time, capacity, duration_minutes, active = 1, price_adult, price_child, price_teen } = req.body;
    
    if (!boat_id || !time || capacity === undefined) {
      return res.status(400).json({ error: 'boat_id, time, и capacity обязательны' });
    }
    
    // Validate data types
    const boatId = parseInt(boat_id);

    const slotCapacity = parseInt(capacity);
    // Handle active status: default to 1 if undefined, convert truthy values to 1, falsy to 0
    const isActive = active === undefined ? 1 : (active === true || active === 1 || active === '1' || active === 'true') ? 1 : 0;
    
    // Get boat type to validate duration
    const slotBoat = db.prepare('SELECT type FROM boats WHERE id = ?').get(boatId);
    if (!slotBoat) {
      return res.status(404).json({ error: 'Лодка не найдена' });
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
        return res.status(400).json({ error: 'Для банана вместимость должна быть 12 мест' });
      }
      
      // For banana: force duration to 40 minutes if not provided or different
      if (durationMinutes !== 40) {
        durationMinutes = 40;
      }
      

    }
    
    // Add debug logging to see the values being processed
    console.log('[CREATE_SLOT_DEBUG] Values:', { boatId, slotCapacity, durationMinutes, isActive, price_adult, price_child, price_teen });
    
    if (isNaN(boatId) || boatId <= 0) {
      return res.status(400).json({ error: 'Некорректный ID лодки' });
    }
    
    // Validate category-specific prices instead of legacy price
    if (price_adult === undefined || isNaN(price_adult) || price_adult <= 0) {
      return res.status(400).json({ error: 'Некорректная цена для взрослых' });
    }
    if (price_child === undefined || isNaN(price_child) || price_child <= 0) {
      return res.status(400).json({ error: 'Некорректная цена для ребёнка' });
    }
    
    // Validate teen price for banana boats
    if (slotBoat.type === 'banana' && (price_teen !== undefined && price_teen !== null && price_teen !== 0)) {
      return res.status(400).json({ error: 'Подростковый билет запрещён для banana' });
    }
    
    if (isNaN(slotCapacity) || slotCapacity <= 0) {
      return res.status(400).json({ error: 'Некорректная вместимость' });
    }
    
    // Validate time format
    if (!validateTimeFormat(time)) {
      return res.status(400).json({ error: 'Недопустимое время рейса. Разрешено 08:00–21:00, шаг 30 минут.' });
    }
    
    // Check if boat exists and is active
    const boat = db.prepare('SELECT id FROM boats WHERE id = ? AND is_active = 1').get(boatId);
    if (!boat) {
      return res.status(404).json({ error: 'Лодка не найдена или неактивна' });
    }
    
    try {
      // Insert the new slot
      const stmt = db.prepare('INSERT INTO boat_slots (boat_id, time, price, capacity, seats_left, duration_minutes, is_active, price_adult, price_child, price_teen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      // Set legacy price to price_adult for DB constraint compatibility
      const result = stmt.run(boatId, time, price_adult, slotCapacity, slotCapacity, durationMinutes, isActive, price_adult, price_child, price_teen);
      console.log('[DISPATCHER_SLOTS] Created slot with legacy price:', price_adult, 'adult:', price_adult, 'child:', price_child, 'teen:', price_teen);
      
      // Get the created slot
      const newSlot = db.prepare('SELECT * FROM boat_slots WHERE id = ?').get(result.lastInsertRowid);
      
      res.status(201).json(newSlot);
    } catch (insertError) {
      // Check if this is a UNIQUE constraint error for boat_id and time
      if (insertError.message.includes('UNIQUE constraint failed: boat_slots.boat_id, boat_slots.time')) {
        console.error('[CREATE_SLOT_CONFLICT]', insertError.message);
        return res.status(409).json({
          error: 'Рейс на это время уже существует для этой лодки'
        });
      }
      // Re-throw other errors to be caught by the outer catch block
      throw insertError;
    }
  } catch (error) {
    console.error('[SELLING_500] route=/api/selling/dispatcher/slots method=POST message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'Ошибка сервера' });
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
      return res.status(400).json({ error: 'Некорректный ID слота' });
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
      return res.status(404).json({ error: 'Слот не найден или лодка не найдена' });
    }
    
    if (!currentSlot) {
      return res.status(404).json({ error: 'Слот не найден' });
    }
    
    // Validate category-specific prices if they are being updated
    if (price_adult !== undefined && (isNaN(price_adult) || price_adult <= 0)) {
      return res.status(400).json({ error: 'Некорректная цена для взрослых' });
    }
    if (price_child !== undefined && (isNaN(price_child) || price_child <= 0)) {
      return res.status(400).json({ error: 'Некорректная цена для ребёнка' });
    }
    
    // Get boat type to validate teen price for banana boats
    if (price_teen !== undefined && price_teen !== null && price_teen !== 0) {
      if (boat.type === 'banana') {
        return res.status(400).json({ error: 'Подростковый билет запрещён для banana' });
      }
    }
    
    // Validate time format if time is being updated
    if (time !== undefined && time !== null) {
      if (!validateTimeFormat(time)) {
        return res.status(400).json({ error: 'Недопустимое время рейса. Разрешено 08:00–21:00, шаг 30 минут.' });
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
          return res.status(400).json({ error: 'Для банана вместимость должна быть 12 мест' });
        }
      }
      
      // For banana: force duration to 40 minutes if being updated and different
      if (duration_minutes !== undefined && Number(duration_minutes) !== 40) {
        return res.status(400).json({ error: 'Для банана длительность должна быть 40 минут' });
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
        return res.status(400).json({ error: 'Некорректная вместимость' });
      }
      // Debug logging to see the values being compared - using more accurate calculation from presales
      const actualSoldSeats = currentSlot.sold_seats_from_presales;
      console.log('[CAPACITY_UPDATE_DEBUG] newCapacity:', newCapacity, 'sold_seats_from_calc:', currentSlot.sold_seats_from_calc, 'sold_seats_from_presales:', actualSoldSeats);
      if (newCapacity < actualSoldSeats) {
        return res.status(400).json({ error: 'Новая вместимость не может быть меньше количества проданных мест' });
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
    res.status(500).json({ error: 'Ошибка сервера' });
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
      return res.status(400).json({ error: 'Некорректный ID слота' });
    }
    
    if (active === undefined) {
      return res.status(400).json({ error: 'Поле active обязательно' });
    }
    
    // Check if slot exists
    const slot = db.prepare('SELECT id, capacity, seats_left FROM boat_slots WHERE id = ?').get(slotId);
    if (!slot) {
      return res.status(404).json({ error: 'Слот не найден' });
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
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Delete a slot
router.delete('/dispatcher/slots/:id', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const slotId = parseInt(req.params.id);
    
    if (isNaN(slotId) || slotId <= 0) {
      return res.status(400).json({ error: 'Некорректный ID слота' });
    }
    
    // Check if slot exists
    const slot = db.prepare(`
      SELECT id, boat_id, time, is_active, capacity, seats_left
      FROM boat_slots 
      WHERE id = ?
    `).get(slotId);
    if (!slot) {
      return res.status(404).json({ error: 'Рейс не найден' });
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
        return res.status(500).json({ error: 'Не удалось деактивировать рейс' });
      }
      
      return res.json({
        ok: true,
        mode: 'archived',
        message: 'Рейс нельзя удалить, потому что по нему есть продажи. Рейс деактивирован.',
        slot: result.updatedSlot
      });
    } else {
      // No presales, safe to delete
      const stmt = db.prepare('DELETE FROM boat_slots WHERE id = ?');
      const result = stmt.run(slotId);
      
      if (result.changes === 0) {
        return res.status(404).json({ error: 'Рейс не найден' });
      }
      
      res.json({ 
        ok: true,
        mode: 'deleted',
        message: 'Рейс удалён',
        id: slotId 
      });
    }
  } catch (error) {
    console.error('[SELLING_500] route=/api/selling/dispatcher/slots/:id method=DELETE id=' + req.params.id + ' message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Get all boats for dispatcher
router.get('/dispatcher/boats', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const boats = db.prepare('SELECT id, name, type, is_active FROM boats ORDER BY name').all();
    res.json(boats);
  } catch (error) {
    console.error('[SELLING_500] route=/api/selling/dispatcher/boats method=GET message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Get all slots for dispatcher (including inactive)
router.get('/dispatcher/slots', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const rows = db.prepare(`
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
      ORDER BY gs.trip_date, gs.time
    `).all();

    res.json(rows);
  } catch (error) {
    console.error('[SELLING_500] route=/api/selling/dispatcher/slots method=GET message=' + (error?.message || error) + ' stack=' + (error?.stack || ''));
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});



// Update presale payment (complete sale - for dispatcher)
router.patch('/presales/:id/payment', authenticateToken, canSell, (req, res) => {
  try {
    const presaleId = parseInt(req.params.id);
    const { additionalPayment } = req.body;
    
    if (isNaN(presaleId)) {
      return res.status(400).json({ error: 'Invalid presale ID' });
    }
    
    const payment = parseInt(additionalPayment) || 0;
    if (isNaN(payment) || payment < 0) {
      return res.status(400).json({ error: 'Invalid payment amount' });
    }
    
    // Get the presale to check remaining amount
    const presale = db.prepare(`
      SELECT total_price, prepayment_amount
      FROM presales
      WHERE id = ?
    `).get(presaleId);
    
    if (!presale) {
      return res.status(404).json({ error: 'Presale not found' });
    }
    
    const remainingAmount = presale.total_price - presale.prepayment_amount;
    
    if (payment > remainingAmount) {
      return res.status(400).json({ error: 'Payment amount exceeds remaining balance' });
    }
    
    // Update prepayment amount
    const newPrepaymentAmount = presale.prepayment_amount + payment;
    const stmt = db.prepare(`
      UPDATE presales 
      SET prepayment_amount = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    
    stmt.run(newPrepaymentAmount, presaleId);
    
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
    console.error('[SELLING_500] route=/api/selling/presales/:id/payment method=PATCH id=' + req.params.id + ' message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Accept payment for presale (alternative endpoint)
router.patch('/selling/presales/:id/paid', authenticateToken, (req, res) => {
  const presaleId = Number(req.params.id);
  const paymentMethod = req.body?.payment_method ?? null;

  if (paymentMethod && !['cash', 'card'].includes(paymentMethod)) {
    return res.status(400).json({ message: 'Invalid payment_method' });
  }

  try {
    const result = markPresaleAsPaid(presaleId);

    if (paymentMethod) {
      db.prepare(`
        UPDATE tickets
        SET payment_method = ?
        WHERE presale_id = ?
      `).run(paymentMethod, presaleId);
    }

    return res.json(result);
  } catch (e) {
    console.error('accept payment error', e);
    return res.status(500).json({ message: 'Payment failed' });
  }
});


// Accept payment without changing status (new endpoint)
router.patch('/presales/:id/accept-payment', authenticateToken, canSell, (req, res) => {
  try {
    const presaleId = parseInt(req.params.id);
    
    if (isNaN(presaleId)) {
      return res.status(400).json({ error: 'Invalid presale ID' });
    }
    
    // Find presale by id
    const presale = db.prepare(`
      SELECT id, boat_slot_id, customer_name, customer_phone, number_of_seats,
             total_price, prepayment_amount, prepayment_comment, status, tickets_json,
             payment_method, payment_cash_amount, payment_card_amount,
             (total_price - prepayment_amount) as remaining_amount,
             created_at, updated_at
      FROM presales 
      WHERE id = ?
    `).get(presaleId);
    
    // If presale not found → 404 json
    if (!presale) {
      return res.status(404).json({ error: 'Предзаказ не найден' });
    }
    
    // If presale.status != 'ACTIVE' → 400 json
    if (presale.status !== 'ACTIVE') {
      return res.status(400).json({ error: 'Нельзя принять оплату для этого статуса' });
    }
    
    // Accept remaining payment with method tracking
const remainingToPay = Number(presale.remaining_amount || 0);
const body = req.body || {};
const method = String(body.payment_method || body.method || '').toUpperCase();

if (method !== 'CASH' && method !== 'CARD' && method !== 'MIXED') {
  return res.status(400).json({ error: 'Не указан способ оплаты' });
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
    return res.status(400).json({ error: 'Некорректные суммы для комбинированной оплаты' });
  }

  if (Math.round(cashAmount + cardAmount) !== Math.round(remainingToPay)) {
    return res.status(400).json({ error: 'Сумма НАЛ + КАРТА должна быть равна остатку к оплате' });
  }

  if (cashAmount === 0 || cardAmount === 0) {
    return res.status(400).json({ error: 'Для комбо укажи суммы и для налички, и для карты' });
  }
}

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

stmt.run(method, Math.round(cashAmount), Math.round(cardAmount), presaleId);
    
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
    console.error('[SELLING_500] route=/api/selling/presales/:id/accept-payment method=PATCH id=' + req.params.id + ' message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'Ошибка при принятии оплаты' });
  }
});

// Cancel presale (seller-initiated)
router.patch('/presales/:id/cancel', authenticateToken, canSell, (req, res) => {
  try {
    const presaleId = Number(req.params.id);

    if (!Number.isFinite(presaleId) || presaleId <= 0) {
      return res.status(400).json({ error: 'Invalid presale ID' });
    }

    // Atomic cancel:
    // 1) presale.status -> CANCELLED
    // 2) all presale tickets -> REFUNDED (only those not already REFUNDED)
    // 3) restore seats to the correct slot using slot_uid when present
    const transaction = db.transaction(() => {
      const presale = db.prepare(`
        SELECT id, boat_slot_id, slot_uid, status
        FROM presales
        WHERE id = ?
      `).get(presaleId);

      if (!presale) throw Object.assign(new Error('Presale not found'), { code: 404 });
      if (presale.status === 'CANCELLED') throw Object.assign(new Error('Presale already cancelled'), { code: 400 });

      db.prepare(`
        UPDATE presales
        SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(presaleId);

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
    const code = error?.code && Number.isFinite(Number(error.code)) ? Number(error.code) : 500;
    if (code !== 500) return res.status(code).json({ error: error.message });
    console.error('[SELLING_500] route=/api/selling/presales/:id/cancel method=PATCH id=' + req.params.id + ' message=' + error.message + ' stack=' + error.stack);
    return res.status(500).json({ error: 'Ошибка сервера' });
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
    console.error('[SELLING_500] route=/api/selling/presales/:id/move method=PATCH id=' + req.params.id + ' message=' + error.message + ' stack=' + error.stack);
    if (error?.message === 'CAPACITY_EXCEEDED') {
      return res.status(409).json({ ok: false, code: 'CAPACITY_EXCEEDED', message: 'Недостаточно мест в рейсе', details: error.details || null });
    }
    res.status(500).json({ error: 'Ошибка сервера' });
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
      return res.status(400).json({ error: 'Количество мест должно быть целым числом не менее 1' });
    }
    
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
        throw new Error('Новое количество мест не может быть больше текущего');
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
        return res.status(404).json({ error: 'Бронь не найдена' });
      }
      if (transactionError.message === 'Новое количество мест не может быть больше текущего') {
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
    console.error('[SELLING_500] route=/api/selling/presales/:id/seats method=PATCH id=' + req.params.id + ' message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'Ошибка сервера' });
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
      SELECT status FROM presales WHERE id = ?
    `).get(presaleId);
    
    if (!currentPresale) {
      return res.status(404).json({ error: 'Presale not found' });
    }
    
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
    console.error('[SELLING_500] route=/api/selling/presales/:id/used method=PATCH id=' + req.params.id + ' message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.patch('/presales/:id/refund', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const presaleId = parseInt(req.params.id);
    
    if (isNaN(presaleId)) {
      return res.status(400).json({ error: 'Invalid presale ID' });
    }
    
    // Use transaction to ensure atomicity: update presale status AND update tickets AND adjust slot capacity
    const transaction = db.transaction((presaleId) => {
      // Get the presale to check its current state and boat slot
      const presale = db.prepare(`
        SELECT id, boat_slot_id, status
        FROM presales
        WHERE id = ?
      `).get(presaleId);
      
      if (!presale) {
        throw new Error('Presale not found');
      }
      
      if (presale.status !== 'CANCELLED_TRIP_PENDING') {
        throw new Error('Presale must be in CANCELLED_TRIP_PENDING status');
      }
      
      // Determine if this is a manual or generated slot
      const isManualSlot = db.prepare(`
        SELECT 1 FROM boat_slots WHERE id = ?
      `).get(presale.boat_slot_id);
      
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
      
      // Restore the seats by adding back the number of seats based on refunded tickets
      if (isManualSlot) {
        // Update boat_slots table
        const updateSeatsStmt = db.prepare(`
          UPDATE boat_slots
          SET seats_left = seats_left + ?
          WHERE id = ?
        `);
        
        updateSeatsStmt.run(ticketsResult.changes, presale.boat_slot_id);
      } else {
        // Update generated_slots table
        const updateGeneratedSeatsStmt = db.prepare(`
          UPDATE generated_slots
          SET seats_left = seats_left + ?
          WHERE id = ?
        `);
        
        updateGeneratedSeatsStmt.run(ticketsResult.changes, presale.boat_slot_id);
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
    console.error('[SELLING_500] route=/api/selling/presales/:id/refund method=PATCH id=' + req.params.id + ' message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.patch('/presales/:id/delete', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const presaleId = Number(req.params.id);

    const presale = db.prepare(`SELECT * FROM presales WHERE id = ?`).get(presaleId);
    if (!presale) return res.status(404).json({ error: 'Presale not found' });

    // нельзя "удалять" то, что уже закрыто финально
    if (['REFUNDED', 'CANCELLED', 'CANCELLED_TRIP_PENDING'].includes(presale.status)) {
      return res.status(400).json({ error: 'Cannot delete this presale in current status' });
    }

    const transaction = db.transaction(() => {
      // 1) помечаем пресейл как CANCELLED (это “сжечь билет”)
      db.prepare(`UPDATE presales SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(presaleId);

      // 2) помечаем все НЕ-REFUNDED тикеты в этом пресейле как REFUNDED
      // (чтобы они не учитывались как занятые места и не мешали пересчёту seats_left)
      const refundTicketsStmt = db.prepare(`
        UPDATE tickets
        SET status = 'REFUNDED', updated_at = CURRENT_TIMESTAMP
        WHERE presale_id = ? AND status != 'REFUNDED'
      `);
      const refunded = refundTicketsStmt.run(presaleId).changes;

      // 3) определяем слот (manual/generated) и возвращаем места (clamp 0..capacity)
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

      const delta = Number(refunded || 0); // столько мест реально освободили

      if (delta > 0) {
        if (slotUid && slotUid.startsWith('generated:')) {
          const id = Number(slotUid.split(':')[1]);
          clampUpdateGenerated.run(delta, delta, delta, id);
        } else if (slotUid && slotUid.startsWith('manual:')) {
          const id = Number(slotUid.split(':')[1]);
          clampUpdateBoat.run(delta, delta, delta, id);
        } else if (presale.boat_slot_id) {
          // fallback: старое поле boat_slot_id (manual)
          clampUpdateBoat.run(delta, delta, delta, presale.boat_slot_id);
        }
      }

      // 4) синхронизируем итоговые поля пресейла (чтобы в UI не висели старые “Билетов/Сумма”)
      // после "удалить билет" в активных его уже не должно быть, но данные должны быть консистентны
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
    
    res.json(tickets);
  } catch (error) {
    console.error('[SELLING_500] route=/api/selling/presales/:id/tickets method=GET id=' + req.params.id + ' message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Get tickets for a specific boat slot (trip)
router.get('/slots/:slotId/tickets', authenticateToken, canSell, (req, res) => {
  try {
 const slotIdRaw = String(req.params.slotId || '').trim();

const isGenerated = slotIdRaw.startsWith('generated:');
const slotIdNum = isGenerated ? null : parseInt(slotIdRaw, 10);

if (!isGenerated && isNaN(slotIdNum)) {
  return res.status(400).json({ error: 'Invalid slot ID' });
}

 const tickets = isGenerated
  ? db.prepare(`
      SELECT
        t.id, t.presale_id, t.ticket_code, t.status, t.price,
        t.created_at, t.updated_at,
        p.customer_name, p.customer_phone
      FROM tickets t
      JOIN presales p ON t.presale_id = p.id
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


    
    res.json(tickets);
  } catch (error) {
    console.error('[SELLING_500] route=/api/selling/slots/:slotId/tickets method=GET id=' + req.params.slotId + ' message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ error: 'Ошибка сервера' });
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
          p.slot_uid as presale_slot_uid,
          p.boat_slot_id as presale_boat_slot_id
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

    const refundTransaction = db.transaction(() => {
      const ticket = db.prepare(`
        SELECT
          t.*,
          p.slot_uid as presale_slot_uid,
          p.boat_slot_id as presale_boat_slot_id
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
      if (!fromSlotUid) return { error: 'Source рейс not found', code: 400 };
      if (String(fromSlotUid) === String(toSlotUid)) return { error: 'Cannot transfer to same рейс', code: 400 };

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
      if (targetSeatsLeft < 1) return { error: 'Not enough seats in target рейс', code: 400 };

      const targetBaseBoatSlotId = getBaseBoatSlotIdForSlot(toSlotUid);
      if (!targetBaseBoatSlotId) return { error: 'Target рейс base slot not found', code: 400 };

      // Infer ticket_type by price (fallback to adult)
      const pAdult = Number(row.price_adult ?? 0);
      const pTeen  = Number(row.price_teen ?? 0);
      const pChild = Number(row.price_child ?? 0);
      const tPrice = Number(row.price ?? 0);

      let ticketType = 'adult';
      if (pChild > 0 && tPrice === pChild) ticketType = 'child';
      else if (pTeen > 0 && tPrice === pTeen) ticketType = 'teen';

      
      const transferMarker = 'TRANSFER_PARTIAL';

      // Try to merge into an existing "transfer-created" presale on target slot for the same customer
      const existing = db.prepare(`
        SELECT id, number_of_seats, total_price, prepayment_amount, tickets_json
        FROM presales
        WHERE slot_uid = ?
          AND status = 'ACTIVE'
          AND customer_phone = ?
          AND customer_name = ?
          AND prepayment_comment = ?
        LIMIT 1
      `).get(String(toSlotUid), row.customer_phone || '', row.customer_name || '', transferMarker);

      let newPresaleId = null;

      if (existing && existing.id) {
        // Merge: increase aggregates on the existing presale
        let exCounts = null;
        try { exCounts = existing.tickets_json ? JSON.parse(existing.tickets_json) : null; } catch { exCounts = null; }
        const mergedCounts = {
          adult: Math.max(0, Number(exCounts?.adult ?? 0)),
          teen:  Math.max(0, Number(exCounts?.teen ?? 0)),
          child: Math.max(0, Number(exCounts?.child ?? 0))
        };
        if (ticketType === 'adult') mergedCounts.adult += 1;
        if (ticketType === 'teen')  mergedCounts.teen  += 1;
        if (ticketType === 'child') mergedCounts.child += 1;

        const exSeats = Number(existing.number_of_seats ?? 0);
        const exTotal = Number(existing.total_price ?? 0);
        const exPrepay = Number(existing.prepayment_amount ?? 0);

        const mergedSeats = exSeats + 1;
        const mergedTotal = exTotal + tPrice;
        const mergedPrepay = Math.min(exPrepay, mergedTotal);

        db.prepare(`
          UPDATE presales
          SET number_of_seats = ?,
              total_price = ?,
              prepayment_amount = ?,
              tickets_json = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(mergedSeats, mergedTotal, mergedPrepay, JSON.stringify(mergedCounts), Number(existing.id));

        newPresaleId = Number(existing.id);
      } else {
        // Create a NEW presale on target slot (1 seat)
        const newTicketsJson = JSON.stringify({
          adult: ticketType === 'adult' ? 1 : 0,
          teen:  ticketType === 'teen'  ? 1 : 0,
          child: ticketType === 'child' ? 1 : 0
        });

        const ins = db.prepare(`
          INSERT INTO presales (
            boat_slot_id, slot_uid, customer_name, customer_phone,
            number_of_seats, total_price, prepayment_amount, prepayment_comment, status,
            tickets_json, created_at, updated_at
          ) VALUES (
            ?, ?, ?, ?,
            1, ?, 0, ?, 'ACTIVE',
            ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          )
        `).run(
          targetBaseBoatSlotId,
          String(toSlotUid),
          row.customer_name || '',
          row.customer_phone || '',
          tPrice,
          transferMarker,
          newTicketsJson
        );

        newPresaleId = Number(ins.lastInsertRowid);
      }

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

      // Seats: free 1 in old рейс and take 1 in new рейс
      applySeatsDelta(fromSlotUid, +1);
      applySeatsDelta(toSlotUid, -1);

      const updatedTicket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
      return { ok: true, ticket: updatedTicket, new_presale_id: newPresaleId };
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



// Transfer options for UI dropdown (only рейсы where sales are open: is_active=1)
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
        ('generated:' || gs.id) as slotUid,
        'generated:' || gs.id as slot_uid,
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
        dayLabel = 'Сегодня';
      } else if (r.trip_date === todayStr) {
        dayLabel = 'Сегодня';
      } else {
        const tomorrow = new Date(now);
        tomorrow.setDate(now.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().slice(0, 10);
        if (r.trip_date === tomorrowStr) {
          dayLabel = 'Завтра';
        } else {
          // DD.MM
          const [y, m, d] = String(r.trip_date).split('-');
          dayLabel = `${d}.${m}`;
        }
      }

      const seatsLeft = Number(r.seats_left ?? 0);
      const label = `${dayLabel} ${r.time} • ${r.boat_name} • свободно ${seatsLeft}`;

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

// Transfer whole presale to another slot_uid (new перенос, no cancelled tabs)
function doTransferPresaleToSlot(presaleId, toSlotUid) {
  const toParsed = parseSlotUid(toSlotUid);
  if (!toParsed) throw new Error('Invalid to_slot_uid');

  const presale = db.prepare(`
    SELECT id, boat_slot_id, slot_uid, number_of_seats, status
    FROM presales
    WHERE id = ?
  `).get(presaleId);

  if (!presale) return { error: 'Presale not found', code: 404 };

  if (String(presale.status) !== 'ACTIVE') return { error: 'Presale not ACTIVE', code: 400 };

  const fromSlotUid = String(presale.slot_uid || (presale.boat_slot_id ? `manual:${presale.boat_slot_id}` : ''));
  const fromParsed = parseSlotUid(fromSlotUid);
  if (!fromParsed) throw new Error('Invalid source slot for presale');

  if (String(fromSlotUid) === String(toSlotUid)) return { error: 'Cannot transfer to same рейс', code: 400 };

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
  if (targetSeatsLeft < movedSeats) return { error: 'Not enough seats in target рейс', code: 400 };

  const targetBaseBoatSlotId = getBaseBoatSlotIdForSlot(toSlotUid);
  if (!targetBaseBoatSlotId) return { error: 'Target рейс base slot not found', code: 400 };

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

  // Seats: free in old, take in new
  applySeatsDelta(fromSlotUid, +movedSeats);
  applySeatsDelta(toSlotUid, -movedSeats);

  return { ok: true, movedSeats };
}

router.post('/presales/:id/transfer', authenticateToken, canSellOrDispatch, (req, res) => {
  try {
    const presaleId = Number(req.params.id);
    const toSlotUid = req.body?.to_slot_uid;

    if (!toSlotUid) return res.status(400).json({ error: 'to_slot_uid required' });

    const tx = db.transaction(() => {
      const result = doTransferPresaleToSlot(presaleId, toSlotUid);
      if (result?.error) throw Object.assign(new Error(result.error), { code: result.code || 400 });
      return result;
    });

    const result = tx();
    res.json({ success: true, ...result });
  } catch (error) {
    const code = error?.code && Number.isFinite(Number(error.code)) ? Number(error.code) : 500;
    res.status(code === 500 ? 500 : code).json({ error: error.message || 'Failed to transfer presale' });
  }
});

// Backward compatible: PATCH /presales/:id/transfer (now требует body.to_slot_uid)
router.patch('/presales/:id/transfer', authenticateToken, canSellOrDispatch, (req, res) => {
  try {
    const presaleId = Number(req.params.id);
    const toSlotUid = req.body?.to_slot_uid;

    if (!toSlotUid) return res.status(400).json({ error: 'to_slot_uid required' });

    const tx = db.transaction(() => {
      const result = doTransferPresaleToSlot(presaleId, toSlotUid);
      if (result?.error) throw Object.assign(new Error(result.error), { code: result.code || 400 });
      return result;
    });

    const result = tx();
    res.json({ success: true, ...result });
  } catch (error) {
    const code = error?.code && Number.isFinite(Number(error.code)) ? Number(error.code) : 500;
    res.status(code === 500 ? 500 : code).json({ error: error.message || 'Failed to transfer presale' });
  }
});


router.patch('/presales/:id/cancel-trip-pending', authenticateToken, canSellOrDispatch, (req, res) => {
  try {
    const presaleId = req.params.id;

    const cancelTransaction = db.transaction(() => {
      const presale = db.prepare('SELECT id, boat_slot_id, slot_uid, number_of_seats, status FROM presales WHERE id = ?').get(presaleId);
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

    res.json({ success: true, message: 'Presale marked as cancelled trip pending' });
  } catch (error) {
    console.error('Error marking presale as cancelled trip pending:', error);
    res.status(500).json({ error: 'Failed to mark presale as cancelled trip pending' });
  }
});


export default router;