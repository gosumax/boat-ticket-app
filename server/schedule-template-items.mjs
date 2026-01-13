import { Router } from 'express';
import db from './db.js';
import { authenticateToken, canDispatchManageSlots, isAdmin } from './auth.js';
import { getDatabaseFilePath } from './db.js';

const router = Router();

// Track if we've logged the database path for schedule template requests
let hasLoggedScheduleTemplateDbPath = false;

// Helper function to validate time format (HH:MM)
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

// Helper function to get day names from weekdays mask
const getDayNamesFromMask = (weekdaysMask) => {
  const days = [];
  if (weekdaysMask & 1) days.push('Пн');
  if (weekdaysMask & 2) days.push('Вт');
  if (weekdaysMask & 4) days.push('Ср');
  if (weekdaysMask & 8) days.push('Чт');
  if (weekdaysMask & 16) days.push('Пт');
  if (weekdaysMask & 32) days.push('Сб');
  if (weekdaysMask & 64) days.push('Вс');
  return days.join(', ');
};

// Get all schedule template items
router.get('/schedule-template-items', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const items = db.prepare(`
      SELECT 
        sti.id, sti.name, sti.boat_id, sti.boat_type, sti.type, sti.departure_time, 
        sti.duration_minutes, sti.capacity, sti.price_adult, sti.price_child, sti.price_teen, 
        sti.weekdays_mask, sti.is_active, sti.created_at, sti.updated_at,
        b.name as boat_name
      FROM schedule_template_items sti
      LEFT JOIN boats b ON sti.boat_id = b.id
      ORDER BY sti.type, sti.departure_time
    `).all();
    
    // Add formatted weekdays to each item
    const formattedItems = items.map(item => ({
      ...item,
      weekdays_formatted: getDayNamesFromMask(item.weekdays_mask)
    }));
    
    res.json(formattedItems);
  } catch (error) {
    console.error('[SCHEDULE_TEMPLATE_ITEMS_500] route=/api/selling/schedule-template-items method=GET message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', message: 'Ошибка сервера' });
  }
});

// Get a specific schedule template item
router.get('/schedule-template-items/:id', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const itemId = parseInt(req.params.id);
    
    if (isNaN(itemId)) {
      return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: 'Invalid item ID' });
    }
    
    const item = db.prepare(`
      SELECT 
        sti.id, sti.name, sti.boat_id, sti.boat_type, sti.type, sti.departure_time, 
        sti.duration_minutes, sti.capacity, sti.price_adult, sti.price_child, sti.price_teen, 
        sti.weekdays_mask, sti.is_active, sti.created_at, sti.updated_at,
        b.name as boat_name
      FROM schedule_template_items sti
      LEFT JOIN boats b ON sti.boat_id = b.id
      WHERE sti.id = ?
    `).get(itemId);
    
    if (!item) {
      return res.status(404).json({ ok: false, code: 'NOT_FOUND', message: 'Template item not found' });
    }
    
    // Add formatted weekdays
    item.weekdays_formatted = getDayNamesFromMask(item.weekdays_mask);
    
    res.json({ ok: true, item });
  } catch (error) {
    console.error('[SCHEDULE_TEMPLATE_ITEMS_500] route=/api/selling/schedule-template-items/:id method=GET id=' + req.params.id + ' message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', message: 'Ошибка сервера' });
  }
});

// Create a new schedule template item
router.post('/schedule-template-items', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const { name, boat_id, type, departure_time, duration_minutes, capacity, price_adult, price_child, price_teen, weekdays_mask, is_active = 1 } = req.body;
    
    // Validate required fields - check for null/undefined/NaN instead of truthiness for numeric values
    if (!departure_time || !type || capacity == null || capacity === '' || price_adult == null || price_adult === '' || price_child == null || price_child === '' || duration_minutes == null || duration_minutes === '' || weekdays_mask === undefined || weekdays_mask === 0) {
      return res.status(400).json({ 
        ok: false, 
        code: 'VALIDATION_ERROR', 
        message: 'departure_time, type, capacity, price_adult, price_child, duration_minutes, and weekdays_mask are required',
        details: {
          missing_fields: [
            !departure_time && 'departure_time',
            !type && 'type', 
            (capacity == null || capacity === '') && 'capacity',
            (price_adult == null || price_adult === '') && 'price_adult',
            (price_child == null || price_child === '') && 'price_child',
            (duration_minutes == null || duration_minutes === '') && 'duration_minutes',
            weekdays_mask === undefined && 'weekdays_mask',
            weekdays_mask === 0 && 'weekdays_mask (cannot be 0)'
          ].filter(Boolean)
        }
      });
    }
    
    // Validate type
    if (!['speed', 'cruise', 'banana'].includes(type.toLowerCase())) {
      return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: 'Invalid type. Must be speed, cruise, or banana' });
    }
    
    // Validate time format
    if (!validateTimeFormat(departure_time)) {
      return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: 'Недопустимое время рейса. Разрешено 08:00–21:00, шаг 30 минут.' });
    }
    
    // Validate duration
    const serviceType = type.toLowerCase() === 'banana' ? 'BANANA' : 'BOAT';
    const durationValidation = validateDuration(parseInt(duration_minutes), serviceType);
    if (!durationValidation.valid) {
      return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: durationValidation.error });
    }
    
    // Validate numeric values
    const parsedDuration = parseInt(duration_minutes);
    const parsedCapacity = parseInt(capacity);
    const parsedPriceAdult = parseInt(price_adult);
    const parsedPriceChild = parseInt(price_child);
    const parsedPriceTeen = price_teen !== undefined && price_teen !== null ? parseInt(price_teen) : null;
    const parsedWeekdaysMask = parseInt(weekdays_mask);
    
    if (isNaN(parsedDuration)) {
      return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: 'Некорректная длительность' });
    }
    if (isNaN(parsedCapacity) || parsedCapacity <= 0) {
      return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: 'Некорректная вместимость' });
    }
    if (isNaN(parsedPriceAdult) || parsedPriceAdult <= 0) {
      return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: 'Некорректная цена для взрослых' });
    }
    if (isNaN(parsedPriceChild) || parsedPriceChild <= 0) {
      return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: 'Некорректная цена для детей' });
    }
    if (parsedPriceTeen !== null && !isNaN(parsedPriceTeen) && parsedPriceTeen <= 0) {
      return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: 'Некорректная подростковая цена' });
    }
    if (isNaN(parsedWeekdaysMask)) {
      return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: 'Некорректная маска дней недели' });
    }
    
    // For banana, price_teen should not be provided or should be 0/null
    if (type.toLowerCase() === 'banana' && (price_teen !== undefined && price_teen !== null && price_teen !== 0)) {
      return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: 'Подростковый билет запрещён для banana' });
    }
    
    // Validate capacity
    if (type.toLowerCase() === 'banana' && capacity !== 12) {
      return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: 'Для банана вместимость должна быть 12 мест' });
    }
    
    // Validate weekdays_mask (must not be 0)
    if (weekdays_mask === 0) {
      return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: 'Дни недели не могут быть пустыми' });
    }
    
    // If boat_id is provided, validate that the boat exists
    if (boat_id) {
      const parsedBoatId = parseInt(boat_id);
      if (isNaN(parsedBoatId)) {
        return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: 'Некорректный ID лодки' });
      }
      const boat = db.prepare('SELECT id, type FROM boats WHERE id = ?').get(parsedBoatId);
      if (!boat) {
        return res.status(404).json({ ok: false, code: 'NOT_FOUND', message: 'Boat not found' });
      }
      // If boat exists, ensure type matches boat type
      if (boat.type !== type.toLowerCase()) {
        return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: 'Type must match boat type' });
      }
    }
    
    // Convert active to integer
    const isActive = is_active === true || is_active === 1 || is_active === '1' || is_active === 'true' ? 1 : 0;
    
    // Check for duplicates: same boat_id, type, departure_time, duration_minutes, weekdays_mask, and is_active
    if (boat_id) {
      const existing = db.prepare(`
        SELECT id FROM schedule_template_items 
        WHERE boat_id = ? AND type = ? AND departure_time = ? AND duration_minutes = ? AND weekdays_mask = ? AND is_active = ?
      `).get(boat_id, type.toLowerCase(), departure_time, duration_minutes, weekdays_mask, isActive);
      
      if (existing) {
        return res.status(409).json({ ok: false, code: 'CONFLICT', message: 'Шаблон с такими параметрами уже существует' });
      }
    }
    
    // Insert the template item
    const stmt = db.prepare(`
      INSERT INTO schedule_template_items (
        name, boat_id, type, departure_time, duration_minutes, capacity, 
        price_adult, price_child, price_teen, weekdays_mask, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      name || null,
      boat_id ? parseInt(boat_id) : null,
      type.toLowerCase(),
      departure_time,
      parsedDuration,
      parsedCapacity,
      parsedPriceAdult,
      parsedPriceChild,
      parsedPriceTeen !== null && !isNaN(parsedPriceTeen) ? parsedPriceTeen : null,
      parsedWeekdaysMask,
      isActive
    );
    
    // Get the created item
    const newItem = db.prepare(`
      SELECT 
        sti.id, sti.name, sti.boat_id, sti.boat_type, sti.type, sti.departure_time, 
        sti.duration_minutes, sti.capacity, sti.price_adult, sti.price_child, sti.price_teen, 
        sti.weekdays_mask, sti.is_active, sti.created_at, sti.updated_at,
        b.name as boat_name
      FROM schedule_template_items sti
      LEFT JOIN boats b ON sti.boat_id = b.id
      WHERE sti.id = ?
    `).get(result.lastInsertRowid);
    
    // Add formatted weekdays
    newItem.weekdays_formatted = getDayNamesFromMask(newItem.weekdays_mask);
    
    res.status(201).json({ ok: true, item: newItem });
  } catch (error) {
    console.error('[SCHEDULE_TEMPLATE_ITEMS_500] route=/api/selling/schedule-template-items method=POST message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', message: 'Ошибка сервера' });
  }
});

// Update a schedule template item
router.patch('/schedule-template-items/:id', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const itemId = parseInt(req.params.id);
    const { name, boat_id, type, departure_time, duration_minutes, capacity, price_adult, price_child, price_teen, weekdays_mask, is_active } = req.body;
    
    if (isNaN(itemId)) {
      return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: 'Invalid item ID' });
    }
    
    // Get current item to check type
    const currentItem = db.prepare(`
      SELECT type
      FROM schedule_template_items
      WHERE id = ?
    `).get(itemId);
    
    if (!currentItem) {
      return res.status(404).json({ ok: false, code: 'NOT_FOUND', message: 'Template item not found' });
    }
    
    // Build update query based on provided fields
    const updates = [];
    const params = [];
    
    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name);
    }
    
    if (departure_time !== undefined) {
      // Validate time format
      if (!validateTimeFormat(departure_time)) {
        return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: 'Недопустимое время рейса. Разрешено 08:00–21:00, шаг 30 минут.' });
      }
      updates.push('departure_time = ?');
      params.push(departure_time);
    }
    
    if (type !== undefined) {
      // Validate type
      if (!['speed', 'cruise', 'banana'].includes(type.toLowerCase())) {
        return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: 'Invalid type. Must be speed, cruise, or banana' });
      }
      updates.push('type = ?');
      params.push(type.toLowerCase());
    }
    
    if (duration_minutes !== undefined) {
      // Validate duration
      const parsedDuration = parseInt(duration_minutes);
      if (isNaN(parsedDuration)) {
        return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: 'Некорректная длительность' });
      }
      const serviceType = (type || currentItem.type).toLowerCase() === 'banana' ? 'BANANA' : 'BOAT';
      const durationValidation = validateDuration(parsedDuration, serviceType);
      if (!durationValidation.valid) {
        return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: durationValidation.error });
      }
      updates.push('duration_minutes = ?');
      params.push(parsedDuration);
    }
    
    if (capacity !== undefined) {
      // Validate capacity
      const parsedCapacity = parseInt(capacity);
      if (isNaN(parsedCapacity) || parsedCapacity <= 0) {
        return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: 'Некорректная вместимость' });
      }
      // For banana, capacity must be 12
      if ((type || currentItem.type).toLowerCase() === 'banana' && parsedCapacity !== 12) {
        return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: 'Для банана вместимость должна быть 12 мест' });
      }
      updates.push('capacity = ?');
      params.push(parsedCapacity);
    }
    
    if (price_adult !== undefined) {
      const parsedPriceAdult = parseInt(price_adult);
      if (isNaN(parsedPriceAdult) || parsedPriceAdult <= 0) {
        return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: 'Некорректная цена для взрослых' });
      }
      updates.push('price_adult = ?');
      params.push(parsedPriceAdult);
    }
    
    if (price_child !== undefined) {
      const parsedPriceChild = parseInt(price_child);
      if (isNaN(parsedPriceChild) || parsedPriceChild <= 0) {
        return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: 'Некорректная цена для детей' });
      }
      updates.push('price_child = ?');
      params.push(parsedPriceChild);
    }
    
    if (price_teen !== undefined) {
      const parsedPriceTeen = parseInt(price_teen);
      if (isNaN(parsedPriceTeen) || parsedPriceTeen <= 0) {
        return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: 'Некорректная подростковая цена' });
      }
      // For banana, price_teen should not be provided or should be 0/null
      if ((type || currentItem.type).toLowerCase() === 'banana' && parsedPriceTeen !== 0 && parsedPriceTeen !== null) {
        return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: 'Подростковый билет запрещён для banana' });
      }
      updates.push('price_teen = ?');
      params.push(parsedPriceTeen);
    }
    
    if (weekdays_mask !== undefined) {
      // Validate weekdays_mask (must not be 0)
      const parsedWeekdaysMask = parseInt(weekdays_mask);
      if (isNaN(parsedWeekdaysMask) || parsedWeekdaysMask === 0) {
        return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: 'Дни недели не могут быть пустыми' });
      }
      updates.push('weekdays_mask = ?');
      params.push(parsedWeekdaysMask);
    }
    
    if (boat_id !== undefined) {
      if (boat_id !== null) {
        // If boat_id is provided, validate that the boat exists
        const parsedBoatId = parseInt(boat_id);
        if (isNaN(parsedBoatId)) {
          return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: 'Некорректный ID лодки' });
        }
        const boat = db.prepare('SELECT id, type FROM boats WHERE id = ?').get(parsedBoatId);
        if (!boat) {
          return res.status(404).json({ ok: false, code: 'NOT_FOUND', message: 'Boat not found' });
        }
        // If boat exists, ensure type matches boat type
        if (boat.type !== (type || currentItem.type).toLowerCase()) {
          return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: 'Type must match boat type' });
        }
      }
      updates.push('boat_id = ?');
      params.push(boat_id !== null ? parseInt(boat_id) : null);
    }
    
    if (is_active !== undefined) {
      // Convert active to integer
      const isActive = is_active === true || is_active === 1 || is_active === '1' || is_active === 'true' ? 1 : 0;
      updates.push('is_active = ?');
      params.push(isActive);
    }
    
    // Add updated_at
    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(itemId);
    
    if (updates.length === 0) {
      return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: 'No fields to update' });
    }
    
    const updateQuery = `UPDATE schedule_template_items SET ${updates.join(', ')} WHERE id = ?`;
    const result = db.prepare(updateQuery).run(params);
    
    if (result.changes === 0) {
      return res.status(404).json({ ok: false, code: 'NOT_FOUND', message: 'Template item not found' });
    }
    
    // Get the updated item
    const updatedItem = db.prepare(`
      SELECT 
        sti.id, sti.name, sti.boat_id, sti.boat_type, sti.type, sti.departure_time, 
        sti.duration_minutes, sti.capacity, sti.price_adult, sti.price_child, sti.price_teen, 
        sti.weekdays_mask, sti.is_active, sti.created_at, sti.updated_at,
        b.name as boat_name
      FROM schedule_template_items sti
      LEFT JOIN boats b ON sti.boat_id = b.id
      WHERE sti.id = ?
    `).get(itemId);
    
    // Add formatted weekdays
    updatedItem.weekdays_formatted = getDayNamesFromMask(updatedItem.weekdays_mask);
    
    res.json({ ok: true, item: updatedItem });
  } catch (error) {
    console.error('[SCHEDULE_TEMPLATE_ITEMS_500] route=/api/selling/schedule-template-items/:id method=PATCH id=' + req.params.id + ' message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', message: 'Ошибка сервера' });
  }
});

// Delete a schedule template item
router.delete('/schedule-template-items/:id', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const itemId = parseInt(req.params.id);
    
    if (isNaN(itemId)) {
      return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: 'Invalid item ID' });
    }
    
    // Check if item exists
    const item = db.prepare('SELECT id FROM schedule_template_items WHERE id = ?').get(itemId);
    if (!item) {
      return res.status(404).json({ ok: false, code: 'NOT_FOUND', message: 'Template item not found' });
    }
    
    // Check if deleteFutureTrips parameter is true
    const deleteFutureTrips = req.query.deleteFutureTrips === 'true';
    
    // Check for any bad trips (with invalid prices/capacity) that depend on this template
    const badTrips = db.prepare(
      'SELECT COUNT(*) as count FROM generated_slots WHERE schedule_template_id = ? AND (price_adult <= 0 OR capacity <= 0 OR duration_minutes <= 0)'
    ).get(itemId);
    
    if (badTrips.count > 0) {
      return res.status(409).json({ 
        ok: false, 
        code: 'CONFLICT', 
        message: 'Нельзя удалить шаблон: есть рейсы без сохранённых цен/параметров. Сначала выполните восстановление.' 
      });
    }
    
    if (deleteFutureTrips) {
      // Delete future trips generated from this template
      // Only delete trips with dates from today onwards
      const today = new Date().toISOString().split('T')[0];
      const deleteStmt = db.prepare('DELETE FROM generated_slots WHERE schedule_template_id = ? AND trip_date >= ?');
      const deleteResult = deleteStmt.run(itemId, today);
      
      console.log(`[SCHEDULE_TEMPLATE_DELETE] Deleted ${deleteResult.changes} future trips for template ${itemId}`);
    } else {
      // If not deleting future trips, check if any sales exist for trips from this template
      const activeTickets = db.prepare(
        `SELECT COUNT(*) as count 
         FROM generated_slots gs 
         JOIN tickets t ON gs.id = t.boat_slot_id 
         WHERE gs.schedule_template_id = ? 
         AND t.status IN ('ACTIVE', 'USED')`
      ).get(itemId);
      
      if (activeTickets.count > 0) {
        return res.status(409).json({ 
          ok: false, 
          code: 'CONFLICT', 
          message: 'Нельзя удалить шаблон: есть проданные билеты на рейсы из этого шаблона.' 
        });
      }
    }
    
    // Delete the template item
    const stmt = db.prepare('DELETE FROM schedule_template_items WHERE id = ?');
    const result = stmt.run(itemId);
    
    if (result.changes === 0) {
      return res.status(404).json({ ok: false, code: 'NOT_FOUND', message: 'Template item not found' });
    }
    
    res.json({ 
      ok: true, 
      message: 'Template item deleted', 
      id: itemId,
      deletedFutureTrips: deleteFutureTrips,
      futureTripsDeleted: deleteFutureTrips ? deleteResult.changes : 0
    });
  } catch (error) {
    console.error('[SCHEDULE_TEMPLATE_ITEMS_500] route=/api/selling/schedule-template-items/:id method=DELETE id=' + req.params.id + ' message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', message: 'Ошибка сервера' });
  }
});

// Generate slots from schedule template items for a date range
router.post('/schedule-template-items/generate', authenticateToken, canDispatchManageSlots, (req, res) => {
  try {
    const { date_from, date_to } = req.body;
    
    if (!date_from || !date_to) {
      return res.status(400).json({ 
        ok: false, 
        code: 'VALIDATION_ERROR', 
        message: 'date_from and date_to are required',
        details: {
          missing_fields: [
            !date_from && 'date_from',
            !date_to && 'date_to'
          ].filter(Boolean)
        }
      });
    }
    
    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date_from) || !dateRegex.test(date_to)) {
      return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: 'Invalid date format. Use YYYY-MM-DD' });
    }
    
    // Validate that date_from is not after date_to
    const fromDate = new Date(date_from);
    const toDate = new Date(date_to);
    if (fromDate > toDate) {
      return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: 'date_from cannot be after date_to' });
    }
    
    // Log database path on first request
    if (!hasLoggedScheduleTemplateDbPath) {
      const dbPath = getDatabaseFilePath();
      console.log('[DB_PATH_SCHEDULE_TEMPLATE] ' + dbPath);
      hasLoggedScheduleTemplateDbPath = true;
    }
    
    // Get all active schedule template items with boat active status
    const items = db.prepare(`
      SELECT sti.*, b.is_active as boat_is_active
      FROM schedule_template_items sti
      LEFT JOIN boats b ON sti.boat_id = b.id
      WHERE sti.is_active = 1
    `).all();
    
    if (items.length === 0) {
      return res.json({ ok: true, message: 'No active template items found', generated: 0, skipped: 0 });
    }
    
    // Calculate the number of days between the dates
    const oneDay = 24 * 60 * 60 * 1000; // hours*minutes*seconds*milliseconds
    const diffDays = Math.round(Math.abs((toDate - fromDate) / oneDay)) + 1;
    
    // Process each day in the range
    const generatedSlots = [];
    const skippedSlots = [];
    
    // Loop through each day
    for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
      // Get the day of week (0=Sunday, 1=Monday, ..., 6=Saturday)
      // Convert to our format (1=Monday, 2=Tuesday, ..., 7=Sunday)
      let dayOfWeek = d.getDay();
      if (dayOfWeek === 0) dayOfWeek = 7; // Sunday is 7 in our system
      
      // Convert to bit position (Monday=1, Tuesday=2, ..., Sunday=64)
      const dayBit = Math.pow(2, dayOfWeek - 1);
      
      // Find items that match this day of week
      const matchingItems = items.filter(item => (item.weekdays_mask & dayBit) !== 0);
      
      for (const item of matchingItems) {
        // Check if a slot already exists for this date and time for the same boat
        // Use Moscow timezone for date calculation
        const tripDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(d); // Format as YYYY-MM-DD in Moscow timezone
        const existingSlot = db.prepare(`
          SELECT id, schedule_template_id FROM generated_slots 
          WHERE trip_date = ? AND time = ? AND boat_id = ?
        `).get(tripDate, item.departure_time, item.boat_id);
        
        if (existingSlot) {
          // Determine the reason for skipping
          let reason = 'already_exists';
          if (existingSlot.schedule_template_id === item.id) {
            reason = 'exists_same_template';
          } else if (existingSlot.schedule_template_id === null || existingSlot.schedule_template_id === 0) {
            reason = 'exists_manual_trip'; // Could be a manually created trip
          } else {
            reason = 'exists_other_template'; // Trip created from different template
          }
          
          // Skip if slot already exists
          skippedSlots.push({
            date: tripDate,
            time: item.departure_time,
            boat_id: item.boat_id,
            template_item_id: item.id,
            existing_template_id: existingSlot.schedule_template_id,
            reason: reason
          });
          continue;
        }
        
        // Check if the boat is active before creating the slot
        if (!item.boat_is_active || item.boat_is_active === 0) {
          // Skip creating the slot if the boat is inactive
          skippedSlots.push({
            date: tripDate,
            time: item.departure_time,
            boat_id: item.boat_id,
            template_item_id: item.id,
            reason: 'boat_inactive'
          });
          continue;
        }
        
        // Create a new generated slot based on the template item
        try {
          const insertResult = db.prepare(`
            INSERT INTO generated_slots (
              schedule_template_id, trip_date, boat_id, time, capacity, seats_left, 
              duration_minutes, is_active, price_adult, price_child, price_teen,
              seller_cutoff_minutes, dispatcher_cutoff_minutes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            item.id, // Use the item ID as schedule_template_id
            tripDate,
            item.boat_id,
            item.departure_time,
            item.capacity,
            item.capacity, // seats_left starts as capacity
            item.duration_minutes,
            1, // is_active = 1 by default
            item.price_adult,
            item.price_child,
            item.price_teen,
            item.seller_cutoff_minutes || null,  // Copy seller cutoff from template
            item.dispatcher_cutoff_minutes || null  // Copy dispatcher cutoff from template
          );
          
          // Get the created slot
          const newSlot = db.prepare(`
            SELECT 
              gs.id, gs.schedule_template_id, gs.trip_date, gs.boat_id, gs.time, gs.capacity, gs.seats_left,
              gs.duration_minutes, gs.is_active, gs.price_adult, gs.price_child, gs.price_teen,
              b.name as boat_name, b.type as boat_type
            FROM generated_slots gs
            JOIN boats b ON gs.boat_id = b.id
            WHERE gs.id = ?
          `).get(insertResult.lastInsertRowid);
          
          generatedSlots.push(newSlot);
        } catch (insertError) {
          // Check if this is a unique constraint violation
          if (insertError.message.includes('UNIQUE constraint failed') || insertError.message.includes('idx_generated_slots_unique')) {
            // Check if a slot already exists with the same criteria
            // Use Moscow timezone for date calculation
            const tripDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(d); // Format as YYYY-MM-DD in Moscow timezone
            const existingSlot = db.prepare(`
              SELECT id, schedule_template_id FROM generated_slots 
              WHERE trip_date = ? AND time = ? AND boat_id = ?
            `).get(tripDate, item.departure_time, item.boat_id);
            
            if (existingSlot) {
              // Determine the reason for skipping
              let reason = 'already_exists';
              if (existingSlot.schedule_template_id === item.id) {
                reason = 'exists_same_template';
              } else if (existingSlot.schedule_template_id === null || existingSlot.schedule_template_id === 0) {
                reason = 'exists_manual_trip'; // Could be a manually created trip
              } else {
                reason = 'exists_other_template'; // Trip created from different template
              }
              
              // Add to skipped slots
              skippedSlots.push({
                date: tripDate,
                time: item.departure_time,
                boat_id: item.boat_id,
                template_item_id: item.id,
                existing_template_id: existingSlot.schedule_template_id,
                reason: reason
              });
            }
          } else {
            // Re-throw if it's not a unique constraint violation
            throw insertError;
          }
        }
      }
    }
    
    // Count skip reasons
    const skipReasons = {};
    for (const skipped of skippedSlots) {
      const reason = skipped.reason;
      skipReasons[reason] = (skipReasons[reason] || 0) + 1;
    }
    
    res.json({
      ok: true,
      message: `Generated ${generatedSlots.length} slots, skipped ${skippedSlots.length} slots`,
      generated: generatedSlots.length,
      skipped: skippedSlots.length,
      skip_reasons: {
        already_exists: skipReasons.already_exists || 0,
        exists_same_template: skipReasons.exists_same_template || 0,
        exists_manual_trip: skipReasons.exists_manual_trip || 0,
        exists_other_template: skipReasons.exists_other_template || 0,
        boat_inactive: skipReasons.boat_inactive || 0
      },
      generated_slots: generatedSlots,
      skipped_slots: skippedSlots
    });
  } catch (error) {
    console.error('[SCHEDULE_TEMPLATE_ITEMS_500] route=/api/selling/schedule-template-items/generate method=POST message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', message: 'Ошибка сервера' });
  }
});

// Delete trips for deleted boats
router.delete('/trips-for-deleted-boats', authenticateToken, isAdmin, (req, res) => {
  try {
    // Find generated slots that belong to boats that no longer exist
    const slotsWithDeletedBoats = db.prepare(`
      SELECT gs.id, gs.boat_id, gs.trip_date, gs.time, gs.is_active
      FROM generated_slots gs
      LEFT JOIN boats b ON gs.boat_id = b.id
      WHERE b.id IS NULL
    `).all();
    
    // Find manual slots that belong to boats that no longer exist
    const manualSlotsWithDeletedBoats = db.prepare(`
      SELECT bs.id, bs.boat_id, bs.time, bs.is_active
      FROM boat_slots bs
      LEFT JOIN boats b ON bs.boat_id = b.id
      WHERE b.id IS NULL
    `).all();
    
    const totalSlotsToDelete = slotsWithDeletedBoats.length + manualSlotsWithDeletedBoats.length;
    
    if (totalSlotsToDelete === 0) {
      return res.json({ 
        ok: true, 
        message: 'No trips found for deleted boats',
        deleted: 0,
        deleted_generated: 0,
        deleted_manual: 0
      });
    }
    
    // Delete generated slots for deleted boats
    const deletedGeneratedResult = db.prepare(`
      DELETE FROM generated_slots 
      WHERE boat_id NOT IN (SELECT id FROM boats)
    `).run();
    
    // Delete manual slots for deleted boats
    const deletedManualResult = db.prepare(`
      DELETE FROM boat_slots 
      WHERE boat_id NOT IN (SELECT id FROM boats)
    `).run();
    
    res.json({
      ok: true,
      message: `Deleted ${totalSlotsToDelete} trips for deleted boats (${deletedGeneratedResult.changes} generated, ${deletedManualResult.changes} manual)`,
      deleted: totalSlotsToDelete,
      deleted_generated: deletedGeneratedResult.changes,
      deleted_manual: deletedManualResult.changes
    });
    
  } catch (error) {
    console.error('[DELETE_TRIPS_FOR_DELETED_BOATS_500] route=/api/selling/trips-for-deleted-boats method=DELETE message=' + error.message + ' stack=' + error.stack);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', message: 'Ошибка сервера' });
  }
});

export default router;